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

// Ordre des timeframes du plus petit au plus grand (pour choisir "la plus grande").
const TF_ORDER = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "6h": 360, "1d": 1440 };
function tfRank(tf) { return TF_ORDER[tf] || 0; }

// Scanne un actif sur TOUS ses timeframes, puis regroupe par technique :
// si une meme technique donne un signal du meme sens sur plusieurs UT,
// on ne garde que la PLUS GRANDE unite (1 seule notif + 1 seul trade).
async function scanAsset(asset) {
  // 1) Recuperer les bougies de chaque timeframe (une seule fois).
  //    On prend l'UNION des timeframes utilises par les techniques.
  const allTfs = Array.from(
    new Set([...config.timeframes, ...config.triangleTimeframes, ...config.trendlineTimeframes])
  );
  const dataByTf = {};
  for (const tf of allTfs) {
    try {
      const candles = await fetchCandles(asset, tf, config.candleLimit, config);
      if (candles && candles.length >= 60) dataByTf[tf] = candles;
      else console.log(`  ${asset.name} ${tf}: pas assez de donnees`);
    } catch (e) {
      console.error(`  ${asset.name} ${tf}: erreur -> ${e.message}`);
    }
  }

  // 2) Suivi des trades deja ouverts, sur chaque timeframe disponible.
  const moveSl = config.tradeLevels?.moveSlToEntryAtTp1;
  for (const tf of Object.keys(dataByTf)) {
    const lastCandle = dataByTf[tf][dataByTf[tf].length - 1];
    const updates = updateTradesFor(asset.name, tf, lastCandle, moveSl);
    for (const { trade, events } of updates) {
      for (const ev of events) {
        await sendTelegram(config, formatTradeEvent(trade, ev));
        console.log(`  >>> ${ev} ${asset.name} ${tf} ${trade.technique} (suivi)`);
      }
    }
  }

  // 3) Contexte news (avertissement uniquement, pas d'appel API ici).
  const activeNews = newsWindowActive(todayEvents, new Date(), config.news.windowMinutes);
  const lv = config.tradeLevels;

  // 4) Pour chaque technique, collecter les signaux sur tous les TF.
  //    On stocke { tf, signal } et on triera par taille de TF.
  const collected = { ob_vshape: [], rsi_divergence: [], triangle: [], trendline: [] };

  for (const tf of Object.keys(dataByTf)) {
    const candles = dataByTf[tf];

    // -- Order Block V/V (timeframes standard 15m/1h/4h) --
    if (config.timeframes.includes(tf)) {
      const ob = findOrderBlockVShape(candles, { tradeLevels: lv });
      if (ob && ob.trendOk) collected.ob_vshape.push({ tf, signal: ob });

      // -- Divergence RSI + MACD Zero Lag (memes timeframes) --
      const div = findRsiDivergence(candles, { rsiPeriod: config.detection.rsiPeriod, tradeLevels: lv });
      if (div) collected.rsi_divergence.push({ tf, signal: div });
    }

    // -- Triangle (seulement 4h/6h/journalier) --
    if (config.triangleTimeframes.includes(tf)) {
      const tri = findTriangles(candles, {});
      if (tri && tri.trendOk) {
        const triDir = tri.breakout === "bullish" ? "bullish" : "bearish";
        const triTP =
          triDir === "bullish"
            ? { tp1: tri.entry + tri.risk, tp2: tri.entry + tri.risk * 2, tp3: tri.entry + tri.risk * 3 }
            : { tp1: tri.entry - tri.risk, tp2: tri.entry - tri.risk * 2, tp3: tri.entry - tri.risk * 3 };
        const triSignal = {
          technique: "triangle", direction: triDir, index: candles[candles.length - 1].time,
          entry: tri.entry, stopLoss: tri.stopLoss, takeProfits: triTP, _tri: tri,
        };
        collected.triangle.push({ tf, signal: triSignal });
      }
    }

    // -- Ligne de tendance (seulement 1h/4h) --
    if (config.trendlineTimeframes.includes(tf)) {
      const tl = findTrendlineBreak(candles, { tradeLevels: lv });
      if (tl) collected.trendline.push({ tf, signal: tl });
    }
  }

  // 5) Pour chaque technique : regrouper par SENS, garder la plus grande UT.
  await emitGrouped(asset, collected.ob_vshape, "ob_vshape", activeNews,
    (a, tf, s) => formatOrderBlockV(a, tf, s));
  await emitGrouped(asset, collected.rsi_divergence, "rsi_divergence", activeNews,
    (a, tf, s) => formatDivergence(a, tf, s));
  await emitGrouped(asset, collected.triangle, "triangle", activeNews,
    (a, tf, s) => formatTriangle(a, tf, s._tri));
  await emitGrouped(asset, collected.trendline, "trendline", activeNews,
    (a, tf, s) => formatTrendline(a, tf, s));
}

// Prend la liste des signaux d'une technique (sur plusieurs TF), et pour
// chaque sens (haussier/baissier) ne garde QUE la plus grande unite de temps.
async function emitGrouped(asset, list, technique, activeNews, formatFn) {
  if (!list || list.length === 0) {
    console.log(`  ${asset.name} (${technique}): aucun signal`);
    return;
  }
  // Grouper par direction
  const byDir = {};
  for (const item of list) {
    const d = item.signal.direction;
    if (!byDir[d] || tfRank(item.tf) > tfRank(byDir[d].tf)) byDir[d] = item;
  }

  for (const dir of Object.keys(byDir)) {
    const { tf, signal } = byDir[dir];

    // Anti-doublon : trade deja ouvert sur cette technique a CE timeframe ?
    if (hasOpenTrade(asset.name, tf, technique)) {
      console.log(`  ${asset.name} ${tf} (${technique}): trade en cours, on attend le SL`);
      continue;
    }
    const key = `${technique}|${asset.name}|${tf}|${dir}|${signal.index}`;
    if (alreadyAlerted(key)) {
      console.log(`  ${asset.name} ${tf} (${technique}): deja alerte`);
      continue;
    }

    // Combien de timeframes confirmaient ce meme signal ?
    const confirms = list.filter((x) => x.signal.direction === dir).map((x) => x.tf);
    let msg = formatFn(asset.name, tf, signal);
    if (confirms.length > 1) {
      msg += `\n\n<i>Signal confirme sur ${confirms.length} unites (${confirms.join(", ")}). Notif sur la plus grande : ${tf}.</i>`;
    }
    await sendTelegram(config, withNewsWarning(msg, activeNews));
    alertMemory.set(key, Date.now());
    openTrade(asset, tf, signal);
    console.log(`  >>> ALERTE ${technique} ${asset.name} ${tf} ${dir}${confirms.length > 1 ? " (regroupe " + confirms.length + " UT)" : ""}`);
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
    try {
      await scanAsset(asset);
    } catch (e) {
      console.error(`  ${asset.name}: erreur -> ${e.message}`);
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
