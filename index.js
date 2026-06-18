// ============================================================
//  POINT D'ENTREE — boucle de scan
//
//  Pour chaque actif (BTCUSD, XAUUSD) et chaque timeframe (5m,15m,1h):
//   1. recupere les bougies
//   2. detecte les order blocks + score (5 etoiles + bonus RSI)
//   3. garde le meilleur OB encore PERTINENT (proche du prix, non mitige)
//   4. si score >= seuil et pas deja alerte -> envoie Telegram
//
//  Lancer:  npm start
// ============================================================

import { config } from "./config.js";
import { fetchCandles } from "./data.js";
import { findOrderBlockVShape } from "./orderblocks_v.js";
import { findRsiDivergence } from "./divergence.js";
import { findTriangles } from "./triangles.js";
import { findTrendlineBreak } from "./trendlines.js";
import {
  sendTelegram,
  formatTriangle,
  formatTradeEvent,
  formatOrderBlockV,
  formatDivergence,
  formatTrendline,
} from "./telegram.js";
import {
  fetchEconomicCalendar,
  newsWindowActive,
  formatCalendar,
} from "./calendar.js";
import { openTrade, updateTradesFor, hasOpenTrade } from "./trades.js";

// Cache du calendrier du jour (recupere une fois, reutilise pendant la journee)
let todayEvents = null; // tableau d'events | null si pas encore recupere
let calendarDay = null; // chaine "AAAA-MM-JJ" du jour des events en cache
let morningSentDay = null; // jour ou le calendrier du matin a deja ete envoye

// Donne la date "AAAA-MM-JJ" a Paris (pour gerer le matin et le rafraichissement)
function parisDayString(d = new Date()) {
  return d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

function parisParts(d = new Date()) {
  const s = d.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return { hour: h, minute: m };
}

// S'assure que le calendrier du jour est charge (le recharge si on a change de jour).
async function ensureCalendar() {
  const today = parisDayString();
  if (calendarDay !== today) {
    todayEvents = await fetchEconomicCalendar(config);
    calendarDay = today;
    const n = todayEvents === null ? "?" : todayEvents.length;
    console.log(`  Calendrier eco recharge pour ${today} (${n} news fort impact)`);
  }
}

// Envoie le calendrier du matin une fois par jour, a l'heure prevue.
async function maybeSendMorningCalendar() {
  const today = parisDayString();
  if (morningSentDay === today) return; // deja envoye aujourd'hui
  const { hour, minute } = parisParts();
  const target = config.news.morningHour * 60 + config.news.morningMinute;
  const nowMin = hour * 60 + minute;
  // On envoie a partir de l'heure cible (et dans l'heure qui suit, au cas ou
  // le bot demarre un peu apres 8h).
  if (nowMin >= target && nowMin <= target + 60) {
    await ensureCalendar();
    await sendTelegram(config, formatCalendar(todayEvents));
    morningSentDay = today;
    console.log(`  >>> Calendrier du matin envoye (${today})`);
  }
}

// Memoire anti-doublon : cle = actif|tf|indexOB, valeur = timestamp dernier envoi
const alertMemory = new Map();

function alreadyAlerted(key) {
  const last = alertMemory.get(key);
  if (!last) return false;
  const elapsedMin = (Date.now() - last) / 60000;
  return elapsedMin < config.detection.alertCooldownMin;
}

// ============================================================
//  SCAN d'un actif sur un timeframe : 3 techniques independantes
//   1. Order Block V / V inverse
//   2. Divergence RSI + MACD Zero Lag
//   3. Triangle / biseau
//
//  Anti-doublon : un trade est identifie par actif+timeframe+TECHNIQUE.
//  Tant qu'un trade d'une technique est ouvert (pas de SL touche), on
//  ne relance pas un trade de la MEME technique sur le meme actif/TF.
//  Mais une autre technique peut ouvrir son propre trade en parallele.
// ============================================================

// Applique l'avertissement news a un message si une news est en cours.
function withNewsWarning(message, activeNews) {
  if (!activeNews) return message;
  const h = activeNews.time
    ? activeNews.time.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Paris",
      })
    : "";
  return (
    `⚠️ <b>NEWS A FORT IMPACT EN COURS</b> (${activeNews.currency} ${activeNews.name} ${h})\n` +
    `Le marche est imprevisible : prudence, voire ne prends pas ce trade.\n\n` +
    message
  );
}

async function scanOne(asset, timeframe) {
  const candles = await fetchCandles(asset, timeframe, config.candleLimit, config);
  if (!candles || candles.length < 60) {
    console.log(`  ${asset.name} ${timeframe}: pas assez de donnees`);
    return;
  }
  const lastPrice = candles[candles.length - 1].close;
  const lastCandle = candles[candles.length - 1];

  // --- 1) Suivi des trades deja ouverts (toutes techniques) ---
  const moveSl = config.tradeLevels?.moveSlToEntryAtTp1;
  const updates = updateTradesFor(asset.name, timeframe, lastCandle, moveSl);
  for (const { trade, events } of updates) {
    for (const ev of events) {
      await sendTelegram(config, formatTradeEvent(trade, ev));
      console.log(`  >>> ${ev} ${asset.name} ${timeframe} ${trade.technique} (suivi)`);
    }
  }

  // --- Contexte news (avertissement uniquement) ---
  // On NE rappelle PAS l'API ici (limite gratuite = 1 requete/jour).
  // On utilise les events deja recuperes a 8h. S'il est avant 8h ou si
  // la recuperation a echoue, todayEvents peut etre null -> pas d'avertissement.
  const activeNews = newsWindowActive(todayEvents, new Date(), config.news.windowMinutes);

  const lv = config.tradeLevels;

  // ====== TECHNIQUE 1 : ORDER BLOCK V / V inverse ======
  if (!hasOpenTrade(asset.name, timeframe, "ob_vshape")) {
    const ob = findOrderBlockVShape(candles, { tradeLevels: lv });
    if (ob && ob.trendOk) {
      const key = `OBV|${asset.name}|${timeframe}|${ob.index}`;
      if (!alreadyAlerted(key)) {
        await sendTelegram(config, withNewsWarning(formatOrderBlockV(asset.name, timeframe, ob), activeNews));
        alertMemory.set(key, Date.now());
        openTrade(asset, timeframe, ob);
        console.log(`  >>> ALERTE OB-V ${asset.name} ${timeframe} ${ob.direction}`);
      }
    } else {
      console.log(`  ${asset.name} ${timeframe} (OB-V): aucun signal`);
    }
  } else {
    console.log(`  ${asset.name} ${timeframe} (OB-V): trade en cours, on attend le SL`);
  }

  // ====== TECHNIQUE 2 : DIVERGENCE RSI + MACD Zero Lag ======
  if (!hasOpenTrade(asset.name, timeframe, "rsi_divergence")) {
    const div = findRsiDivergence(candles, { rsiPeriod: config.detection.rsiPeriod, tradeLevels: lv });
    if (div) {
      const key = `DIV|${asset.name}|${timeframe}|${div.index}`;
      if (!alreadyAlerted(key)) {
        await sendTelegram(config, withNewsWarning(formatDivergence(asset.name, timeframe, div), activeNews));
        alertMemory.set(key, Date.now());
        openTrade(asset, timeframe, div);
        console.log(`  >>> ALERTE DIV ${asset.name} ${timeframe} ${div.direction}`);
      }
    } else {
      console.log(`  ${asset.name} ${timeframe} (DIV): aucun signal`);
    }
  } else {
    console.log(`  ${asset.name} ${timeframe} (DIV): trade en cours, on attend le SL`);
  }

  // ====== TECHNIQUE 3 : TRIANGLE / BISEAU ======
  if (!hasOpenTrade(asset.name, timeframe, "triangle")) {
    const tri = findTriangles(candles, {});
    if (tri && tri.trendOk) {
      const lastTime = candles[candles.length - 1].time;
      const key = `TRI|${asset.name}|${timeframe}|${lastTime}`;
      if (!alreadyAlerted(key)) {
        await sendTelegram(config, withNewsWarning(formatTriangle(asset.name, timeframe, tri), activeNews));
        alertMemory.set(key, Date.now());
        // On ouvre aussi un trade de suivi pour le triangle.
        // SL = structure de la figure (deja calcule par findTriangles),
        // TP = multiples du risque (X1/X2/X3).
        const triDir = tri.breakout === "bullish" ? "bullish" : "bearish";
        const triTP =
          triDir === "bullish"
            ? { tp1: tri.entry + tri.risk * 1, tp2: tri.entry + tri.risk * 2, tp3: tri.entry + tri.risk * 3 }
            : { tp1: tri.entry - tri.risk * 1, tp2: tri.entry - tri.risk * 2, tp3: tri.entry - tri.risk * 3 };
        const triSignal = {
          technique: "triangle",
          direction: triDir,
          index: lastTime,
          entry: tri.entry,
          stopLoss: tri.stopLoss,
          takeProfits: triTP,
        };
        openTrade(asset, timeframe, triSignal);
        console.log(`  >>> ALERTE TRIANGLE ${asset.name} ${timeframe} ${tri.type} ${tri.breakout}`);
      }
    } else {
      console.log(`  ${asset.name} ${timeframe} (triangle): aucune cassure`);
    }
  } else {
    console.log(`  ${asset.name} ${timeframe} (triangle): trade en cours, on attend le SL`);
  }

  // ====== TECHNIQUE 4 : LIGNES DE TENDANCE (cassure) ======
  // Seulement sur les timeframes conseilles (1h, 4h) — pas en 15m.
  if (config.trendlineTimeframes.includes(timeframe)) {
    if (!hasOpenTrade(asset.name, timeframe, "trendline")) {
      const tl = findTrendlineBreak(candles, { tradeLevels: lv });
      if (tl) {
        const key = `TL|${asset.name}|${timeframe}|${tl.index}|${tl.direction}`;
        if (!alreadyAlerted(key)) {
          await sendTelegram(config, withNewsWarning(formatTrendline(asset.name, timeframe, tl), activeNews));
          alertMemory.set(key, Date.now());
          openTrade(asset, timeframe, tl);
          console.log(`  >>> ALERTE TRENDLINE ${asset.name} ${timeframe} ${tl.direction}`);
        }
      } else {
        console.log(`  ${asset.name} ${timeframe} (trendline): aucune cassure`);
      }
    } else {
      console.log(`  ${asset.name} ${timeframe} (trendline): trade en cours, on attend le SL`);
    }
  }
}


async function scanAll() {
  const stamp = new Date().toISOString();
  console.log(`\n[${stamp}] Scan en cours...`);

  // Calendrier du matin (envoye une fois par jour vers 8h heure de Paris)
  try {
    await maybeSendMorningCalendar();
  } catch (e) {
    console.error(`  Calendrier matin: erreur -> ${e.message}`);
  }

  for (const asset of config.assets) {
    for (const tf of config.timeframes) {
      try {
        await scanOne(asset, tf);
      } catch (e) {
        console.error(`  ${asset.name} ${tf}: erreur -> ${e.message}`);
      }
    }
  }
}

async function main() {
  console.log("=== Scanner trading demarre ===");
  console.log(`Actifs: ${config.assets.map((a) => a.name).join(", ")}`);
  console.log(`Timeframes (15m min): ${config.timeframes.join(", ")}`);
  console.log(`Techniques: Order Block V/V, Divergence RSI+MACD ZeroLag, Triangles, Lignes de tendance (1h/4h)`);
  console.log(`Scan toutes les ${config.scanIntervalSec}s\n`);

  await scanAll();
  setInterval(scanAll, config.scanIntervalSec * 1000);
}

main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
