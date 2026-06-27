// ============================================================
//  SELF-TEST — verifie la logique sans appeler les API
//  Lancer: npm test
// ============================================================

import { computeRSI } from "./rsi.js";
import { computeMacdZeroLag } from "./divergence.js";
import { findTriangles } from "./triangles.js";
import { buildStructuralLevels } from "./confirm.js";
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

// Test 3 : SL/TP structurels + filtre TP1
const cd = [];
[64000,64200,64500,64800,65100,65800,65600,65300,65000,64700,64500,64600,64700,64800,64900,65000]
  .forEach((p, i) => cd.push(c(i, 0, 0, p + 20, p - 20)));
const lvls = buildStructuralLevels("bullish", 65000, cd, { maxRiskPct: 5, lookback: 20, minTp1Distance: 300 });
check("SL/TP structurels calcules", lvls && lvls.takeProfits.tp1 > 65000);
check("TP1 > TP2 ordre buy", lvls && lvls.takeProfits.tp1 < lvls.takeProfits.tp2);
// TP1 trop proche -> annule
const lvls2 = buildStructuralLevels("bullish", 65000, cd, { maxRiskPct: 5, lookback: 20, minTp1Distance: 100000 });
check("Trade annule si TP1 trop proche", lvls2 === null);

// Test 4 : Triangle - 2 niveaux (meche vs cloture)
function makeTriangle(lastCandle) {
  const candles = []; let t = 0; let p = 90;
  for (let i = 0; i < 80; i++) { candles.push(c(t, p, p + 0.2, p + 0.4, p - 0.3)); p += 0.2; t++; }
  const tops = [120, 118, 116]; const bots = [100, 102, 104]; let cur = 100;
  for (let k = 0; k < 3; k++) {
    candles.push(c(t, cur, tops[k] - 3, tops[k] - 2, cur - 1)); t++;
    candles.push(c(t, tops[k] - 3, tops[k] - 1, tops[k], tops[k] - 4)); t++;
    candles.push(c(t, tops[k] - 1, tops[k] - 5, tops[k] - 1, tops[k] - 6)); t++;
    candles.push(c(t, tops[k] - 5, bots[k] + 3, tops[k] - 5, bots[k] + 2)); t++;
    candles.push(c(t, bots[k] + 3, bots[k] + 1, bots[k] + 4, bots[k])); t++;
    candles.push(c(t, bots[k] + 1, bots[k] + 5, bots[k] + 6, bots[k] + 1)); t++;
    cur = bots[k] + 5;
  }
  candles.push(lastCandle(t)); return candles;
}
// Corps ENTIER au-dessus de 120 (open 122, close 128) = "close"
const triClose = findTriangles(makeTriangle((t) => c(t, 122, 128, 129, 121)), {});
check("Triangle cassure CLOTURE detectee", triClose && triClose.breakLevel === "close");
// Meche seule au-dessus (cloture dedans) = "wick"
const triWick = findTriangles(makeTriangle((t) => c(t, 110, 114, 126, 109)), {});
check("Triangle cassure MECHE detectee", triWick && triWick.breakLevel === "wick");

// Test 5 : suivi de trade TP1 -> break-even, SL ferme
const asset = { name: "TESTBTC" };
const sig = (tech, entry) => ({ technique: tech, direction: "bullish", index: 1, entry,
  stopLoss: entry * 0.995, takeProfits: { tp1: entry * 1.0075, tp2: entry * 1.015, tp3: entry * 1.03 } });
const trade = openTrade(asset, "1h", sig("triangle", 100));
checkTrade(trade, { high: 100.8, low: 99.9, open: 0, close: 0, time: 0 }, true);
check("TP1 touche remonte le SL a l'entree", trade.slMovedToEntry === true && trade.stopLoss === 100);
check("anti-doublon triangle meme actif/TF", hasOpenTrade("TESTBTC", "1h", "triangle") === true);
check("autre TF autorise", hasOpenTrade("TESTBTC", "4h", "triangle") === false);

// Test 6 : Range - reintegration apres faux breakout
import { findRangeReintegration } from "./range.js";
const rgCandles = []; let rt = 0;
const rgBase = [[100,109],[109,101],[101,110],[110,100],[100,109],[109,101],[101,110],[110,100]];
for (let rep = 0; rep < 4; rep++) { for (const [o, cl] of rgBase) { rgCandles.push(c(rt, o, cl, Math.max(o,cl)+0.4, Math.min(o,cl)-0.4)); rt++; } }
rgCandles.push(c(rt, 101, 99, 101, 98.5)); rt++; // faux breakout bas
rgCandles.push(c(rt, 99.5, 108, 108.5, 99.2)); rt++; // reintegration forte
const rg = findRangeReintegration(rgCandles, { window: 40, emaPeriod: 20 });
check("Range reintegration ACHAT detectee", rg && rg.direction === "bullish");

console.log(`\nResultat: ${pass} OK, ${fail} FAIL`);
console.log("Test termine.");
if (fail > 0) process.exit(1);
