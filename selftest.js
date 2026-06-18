// ============================================================
//  SELF-TEST — verifie la logique sans appeler les API
//  Lancer: npm test
// ============================================================

import { computeRSI } from "./rsi.js";
import { computeMacdZeroLag } from "./divergence.js";
import { findOrderBlockVShape } from "./orderblocks_v.js";
import { openTrade, hasOpenTrade, updateTradesFor, checkTrade } from "./trades.js";

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}
function c(t, o, cl, h, l) { return { time: t, open: o, close: cl, high: h, low: l, volume: 100 }; }

// Test 1 : RSI
const upOnly = Array.from({ length: 30 }, (_, i) => 100 + i);
const rsiUp = computeRSI(upOnly, 14);
check("RSI hausse continue proche 100", rsiUp[rsiUp.length - 1] > 95);

// Test 2 : MACD Zero Lag
const wave = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.3) * 5 + i * 0.1);
const macd = computeMacdZeroLag(wave);
check("MACD Zero Lag renvoie des valeurs", macd.macd[macd.macd.length - 1] != null);

// Test 3 : Order Block V haussier
const candles = []; let t = 0; const step = 900000; let p = 100;
for (let i = 0; i < 40; i++) { candles.push(c(t, p, p + 0.5, p + 0.7, p - 0.3)); p += 0.5; t += step; }
let d = 120;
for (let i = 0; i < 4; i++) { candles.push(c(t, d, d - 2, d + 0.3, d - 2.2)); d -= 2; t += step; }
let u = d;
for (let i = 0; i < 5; i++) { candles.push(c(t, u, u + 2.5, u + 2.7, u - 0.3)); u += 2.5; t += step; }
const ob = findOrderBlockVShape(candles, { tradeLevels: { slPct: 0.5, tp1Pct: 0.75, tp2Pct: 1.5, tp3Pct: 3 } });
check("Order Block V haussier detecte", ob && ob.direction === "bullish");
check("OB-V dans le sens de la tendance", ob && ob.trendOk === true);
check("OB-V a une zone et des TP", ob && ob.zoneTop > ob.zoneBottom && ob.takeProfits.tp1 > ob.entry);

// Test 4 : anti-doublon par technique
const asset = { name: "TESTBTC" };
const sig = (tech, entry) => ({ technique: tech, direction: "bullish", index: 1, entry,
  stopLoss: entry * 0.995, takeProfits: { tp1: entry * 1.0075, tp2: entry * 1.015, tp3: entry * 1.03 } });
openTrade(asset, "15m", sig("ob_vshape", 65000));
check("OB-V bloque un 2e OB-V meme actif/TF", hasOpenTrade("TESTBTC", "15m", "ob_vshape") === true);
check("autre technique autorisee meme actif/TF", hasOpenTrade("TESTBTC", "15m", "rsi_divergence") === false);
check("autre TF autorise", hasOpenTrade("TESTBTC", "1h", "ob_vshape") === false);

// Test 5 : suivi TP1 -> SL au break-even
const trade = openTrade(asset, "4h", sig("ob_vshape", 100));
checkTrade(trade, { high: 100.8, low: 99.9, open: 0, close: 0, time: 0 }, true);
check("TP1 touche remonte le SL a l'entree", trade.slMovedToEntry === true && trade.stopLoss === 100);

// Test 6 : SL ferme le trade
updateTradesFor("TESTBTC", "15m", { high: 65010, low: 64600, open: 0, close: 0, time: 0 }, true);
check("OB-V referme apres SL touche", hasOpenTrade("TESTBTC", "15m", "ob_vshape") === false);

console.log(`\nResultat: ${pass} OK, ${fail} FAIL`);
console.log("Test termine.");
if (fail > 0) process.exit(1);
