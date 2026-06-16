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
import { sendTelegram, formatSignal, formatTriangle } from "./telegram.js";

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

  const obs = findOrderBlocks(candles, config.detection);

  // On filtre: pertinents + score suffisant, puis on prend le meilleur
  const candidates = obs
    .filter((o) => isRelevant(o, lastPrice))
    .filter((o) => o.totalScore >= config.detection.minScoreToAlert)
    .sort((a, b) => b.totalScore - a.totalScore);

  if (candidates.length === 0) {
    console.log(`  ${asset.name} ${timeframe}: aucun signal (prix ${lastPrice})`);
    return;
  }

  const best = candidates[0];
  const key = `${asset.name}|${timeframe}|${best.index}`;
  if (alreadyAlerted(key)) {
    console.log(`  ${asset.name} ${timeframe}: signal deja alerte (cooldown)`);
    return;
  }

  const message = formatSignal(asset.name, timeframe, best);
  await sendTelegram(config, message);
  alertMemory.set(key, Date.now());
  console.log(`  >>> ALERTE OB ${asset.name} ${timeframe} score ${best.totalScore}`);
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
