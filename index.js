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
import { findRsiDivergence } from "./divergence.js";
import { findTriangles } from "./triangles.js";
import {
  sendTelegram,
  formatTriangle,
  formatTradeEvent,
  formatDivergence,
} from "./telegram.js";
import {
  fetchEconomicCalendar,
  newsWindowActive,
  formatCalendar,
} from "./calendar.js";
import { fetchUsHeadlines, formatHeadlines } from "./headlines.js";
import { openTrade, updateTradesFor, hasOpenTrade } from "./trades.js";
import { buildStructuralLevels } from "./confirm.js";

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
    // Gros titres USA (contexte geopolitique/macro)
    const headlines = await fetchUsHeadlines(6);
    await sendTelegram(config, formatHeadlines(headlines));
    morningSentDay = today;
    console.log(`  >>> Calendrier + gros titres du matin envoyes (${today})`);
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
  const collected = { rsi_divergence: [] };

  for (const tf of Object.keys(dataByTf)) {
    const candles = dataByTf[tf];

    // -- Divergence RSI + MACD Zero Lag --
    if (config.timeframes.includes(tf)) {
      const div = findRsiDivergence(candles, { rsiPeriod: config.detection.rsiPeriod, tradeLevels: lv, minTp1Distance: asset.minTp1Distance });
      if (div) collected.rsi_divergence.push({ tf, signal: div });
    }

    // -- Triangle (2 notifs : meche puis cloture) --
    if (config.triangleTimeframes.includes(tf)) {
      const tri = findTriangles(candles, {});
      if (tri && tri.trendOk) {
        await emitTriangle(asset, tf, tri, candles, activeNews);
      } else {
        console.log(`  ${asset.name} ${tf} (triangle): aucune cassure`);
      }
    }
  }

  // Divergence : regroupement multi-timeframe (1 notif sur la plus grande UT).
  await emitGrouped(asset, collected.rsi_divergence, "rsi_divergence", activeNews,
    (a, tf, s) => formatDivergence(a, tf, s));
}

// Gere les 2 notifications du triangle :
//  - "wick"  : une meche depasse -> alerte precoce (pas de trade ouvert)
//  - "close" : bougie cloturee dehors -> confirmation + trade suivi
async function emitTriangle(asset, tf, tri, candles, activeNews) {
  const lastTime = candles[candles.length - 1].time;
  // Cle distincte par niveau, pour envoyer les 2 notifs (pas de doublon).
  const key = `TRI|${asset.name}|${tf}|${tri.breakout}|${tri.breakLevel}|${lastTime}`;
  if (alreadyAlerted(key)) {
    console.log(`  ${asset.name} ${tf} (triangle ${tri.breakLevel}): deja alerte`);
    return;
  }

  await sendTelegram(config, withNewsWarning(formatTriangle(asset.name, tf, tri), activeNews));
  alertMemory.set(key, Date.now());
  console.log(`  >>> TRIANGLE ${asset.name} ${tf} ${tri.breakout} (${tri.breakLevel})`);

  // On n'ouvre un trade de suivi que sur la cassure CONFIRMEE (cloture dehors),
  // et seulement si pas deja un trade triangle en cours sur cet actif/TF.
  if (tri.breakLevel === "close" && !hasOpenTrade(asset.name, tf, "triangle")) {
    const triDir = tri.breakout === "bullish" ? "bullish" : "bearish";
    const lvls = buildStructuralLevels(triDir, tri.entry, candles, {
      maxRiskPct: 3, lookback: 20, minTp1Distance: asset.minTp1Distance,
    });
    if (lvls) {
      openTrade(asset, tf, {
        technique: "triangle", direction: triDir, index: lastTime,
        entry: tri.entry, stopLoss: lvls.stopLoss, takeProfits: lvls.takeProfits,
      });
    }
  }
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
  console.log(`Triangles: ${config.triangleTimeframes.join(", ")}`);
  console.log(`Techniques: Divergence RSI+MACD ZeroLag, Triangles (meche + cloture)`);
  console.log(`Scan toutes les ${config.scanIntervalSec}s\n`);

  // --- TEST CALENDRIER ---
  // Si la variable TEST_CALENDAR=1, on teste le calendrier tout de suite
  // (sans attendre 8h) et on envoie le resultat sur Telegram.
  // ATTENTION : consomme la requete quotidienne gratuite. A retirer apres test.
  if (process.env.TEST_CALENDAR === "1") {
    console.log(">>> MODE TEST CALENDRIER : requete immediate...");
    try {
      const events = await fetchEconomicCalendar(config);
      const n = events === null ? "ECHEC" : events.length;
      console.log(`>>> Calendrier test : ${n} news recuperees`);
      await sendTelegram(config, formatCalendar(events));
      const headlines = await fetchUsHeadlines(6);
      const h = headlines === null ? "ECHEC" : headlines.length;
      console.log(`>>> Gros titres test : ${h} titres recuperes`);
      await sendTelegram(config, formatHeadlines(headlines));
      console.log(">>> Messages calendrier + titres envoyes sur Telegram");
    } catch (e) {
      console.error(`>>> Test calendrier erreur : ${e.message}`);
    }
  }

  await scanAll();
  setInterval(scanAll, config.scanIntervalSec * 1000);
}

main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
