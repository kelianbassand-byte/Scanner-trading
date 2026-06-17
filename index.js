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
import { findOrderBlocks } from "./orderblocks.js";
import { findTriangles } from "./triangles.js";
import { sendTelegram, formatSignal, formatTriangle, formatTradeEvent } from "./telegram.js";
import {
  fetchEconomicCalendar,
  newsWindowActive,
  formatCalendar,
} from "./calendar.js";
import { openTrade, updateTradesFor } from "./trades.js";

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

// Garde seulement les OB "proches" du prix actuel (pertinents pour trader bientot).
// On considere pertinent un OB dont la zone est a moins de ~3% du dernier prix.
function isRelevant(ob, lastPrice) {
  const mid = (ob.top + ob.bottom) / 2;
  const dist = Math.abs(lastPrice - mid) / lastPrice;
  return dist <= 0.03 && ob.stars.nonMitige;
}

async function scanOne(asset, timeframe) {
  const candles = await fetchCandles(asset, timeframe, config.candleLimit, config);
  if (!candles || candles.length < 60) {
    console.log(`  ${asset.name} ${timeframe}: pas assez de donnees`);
    return;
  }
  const lastPrice = candles[candles.length - 1].close;

  // --- Suivi des trades deja ouverts sur cet actif/timeframe ---
  // On verifie si la derniere bougie a touche un TP ou le SL.
  const lastCandle = candles[candles.length - 1];
  const moveSl = config.tradeLevels?.moveSlToEntryAtTp1;
  const updates = updateTradesFor(asset.name, timeframe, lastCandle, moveSl);
  for (const { trade, events } of updates) {
    for (const ev of events) {
      await sendTelegram(config, formatTradeEvent(trade, ev));
      console.log(`  >>> ${ev} ${asset.name} ${timeframe} (suivi trade)`);
    }
  }

  const obs = findOrderBlocks(candles, { ...config.detection, tradeLevels: config.tradeLevels });

  // --- Contexte news : sommes-nous dans une fenetre dangereuse ? ---
  await ensureCalendar();
  const activeNews = newsWindowActive(todayEvents, new Date(), config.news.windowMinutes);
  const penalty = activeNews ? config.news.scorePenalty : 0;

  // On filtre: pertinents + score suffisant (APRES penalite news), puis le meilleur
  const candidates = obs
    .filter((o) => isRelevant(o, lastPrice))
    .map((o) => ({ ...o, adjustedScore: o.totalScore - penalty }))
    .filter((o) => o.adjustedScore >= config.detection.minScoreToAlert)
    .sort((a, b) => b.adjustedScore - a.adjustedScore);

  if (candidates.length === 0) {
    const why = penalty
      ? `aucun signal (news en cours, score -${penalty})`
      : `aucun signal (prix ${lastPrice})`;
    console.log(`  ${asset.name} ${timeframe}: ${why}`);
    return;
  }

  const best = candidates[0];
  const key = `${asset.name}|${timeframe}|${best.index}`;
  if (alreadyAlerted(key)) {
    console.log(`  ${asset.name} ${timeframe}: signal deja alerte (cooldown)`);
    return;
  }

  let message = formatSignal(asset.name, timeframe, best);
  if (activeNews) {
    const h = activeNews.time
      ? activeNews.time.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        })
      : "";
    message =
      `⚠️ <b>NEWS A FORT IMPACT EN COURS</b> (${activeNews.currency} ${activeNews.name} ${h})\n` +
      `Score reduit de ${penalty}. Le marche est imprevisible : prudence, voire ne prends pas ce trade.\n\n` +
      message;
  }
  await sendTelegram(config, message);
  alertMemory.set(key, Date.now());
  // On ouvre un trade virtuel pour le suivre (TP1/TP2/TP3/SL)
  openTrade(asset, timeframe, best);
  console.log(
    `  >>> ALERTE OB ${asset.name} ${timeframe} score ${best.adjustedScore}${penalty ? " (news -" + penalty + ")" : ""}`
  );
}

// Scan d'un triangle/biseau sur une grande unite de temps.
async function scanTriangle(asset, timeframe) {
  const candles = await fetchCandles(asset, timeframe, config.candleLimit, config);
  if (!candles || candles.length < 60) {
    console.log(`  ${asset.name} ${timeframe} (triangle): pas assez de donnees`);
    return;
  }

  const tri = findTriangles(candles, {});
  if (!tri) {
    console.log(`  ${asset.name} ${timeframe} (triangle): aucune cassure`);
    return;
  }
  // On n'alerte que les cassures dans le sens de la tendance
  if (!tri.trendOk) {
    console.log(`  ${asset.name} ${timeframe} (triangle): cassure contre-tendance, ignoree`);
    return;
  }

  // Anti-doublon : une cassure par bougie de cloture
  const lastTime = candles[candles.length - 1].time;
  const key = `TRI|${asset.name}|${timeframe}|${lastTime}`;
  if (alreadyAlerted(key)) {
    console.log(`  ${asset.name} ${timeframe} (triangle): deja alerte`);
    return;
  }

  const message = formatTriangle(asset.name, timeframe, tri);
  await sendTelegram(config, message);
  alertMemory.set(key, Date.now());
  console.log(`  >>> ALERTE TRIANGLE ${asset.name} ${timeframe} ${tri.type} ${tri.breakout}`);
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
    // Order blocks sur petites unites de temps
    for (const tf of config.timeframes) {
      try {
        await scanOne(asset, tf);
      } catch (e) {
        console.error(`  ${asset.name} ${tf}: erreur -> ${e.message}`);
      }
    }
    // Triangles/biseaux sur grandes unites de temps
    for (const tf of config.triangleTimeframes) {
      try {
        await scanTriangle(asset, tf);
      } catch (e) {
        console.error(`  ${asset.name} ${tf} (triangle): erreur -> ${e.message}`);
      }
    }
  }
}

async function main() {
  console.log("=== OB Scanner demarre ===");
  console.log(`Actifs: ${config.assets.map((a) => a.name).join(", ")}`);
  console.log(`Timeframes order blocks: ${config.timeframes.join(", ")}`);
  console.log(`Timeframes triangles: ${config.triangleTimeframes.join(", ")}`);
  console.log(`Seuil d'alerte OB: ${config.detection.minScoreToAlert}/100`);
  console.log(`Scan toutes les ${config.scanIntervalSec}s\n`);

  await scanAll();
  setInterval(scanAll, config.scanIntervalSec * 1000);
}

main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
