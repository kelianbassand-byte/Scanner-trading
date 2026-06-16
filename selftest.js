// ============================================================
//  SELF-TEST — verifie la logique sans appeler les API
//  Lancer: npm test
// ============================================================

import { findOrderBlocks } from "./orderblocks.js";
import { computeRSI } from "./rsi.js";

// --- Test 1 : RSI connu ---
// Serie qui monte tout droit -> RSI doit etre tres haut (proche 100)
const upOnly = Array.from({ length: 30 }, (_, i) => 100 + i);
const rsiUp = computeRSI(upOnly, 14);
console.log("Test RSI (hausse continue), derniere valeur:", rsiUp[rsiUp.length - 1].toFixed(1), "(attendu ~100)");

// --- Test 2 : construction d'un order block haussier propre ---
// On fabrique : tendance haussiere, prise de liquidite, puis OB + impulsion + imbalance.
function makeCandle(time, open, close, highPad = 0.2, lowPad = 0.2) {
  return {
    time,
    open,
    close,
    high: Math.max(open, close) + highPad,
    low: Math.min(open, close) - lowPad,
    volume: 100,
  };
}

const candles = [];
let t = Date.UTC(2025, 0, 1, 14, 0, 0); // 14h UTC = session volatile
const step = 5 * 60 * 1000;

// 60 bougies de fond legerement haussier (pour la tendance + MA50)
let price = 100;
for (let i = 0; i < 60; i++) {
  const o = price;
  price += 0.4; // pente haussiere
  candles.push(makeCandle(t, o, price));
  t += step;
}

// Prise de liquidite : une bougie qui plonge sous les plus-bas recents puis on remonte
const dipOpen = price;
candles.push(makeCandle(t, dipOpen, dipOpen - 3, 0.1, 3.5)); // grosse meche basse
t += step;
price = dipOpen - 1;

// L'ORDER BLOCK haussier = derniere bougie baissiere avant l'impulsion
const obOpen = price;
const obClose = price - 1; // bougie baissiere
candles.push(makeCandle(t, obOpen, obClose));
const obTime = t;
t += step;

// Impulsion haussiere forte (gros corps) qui cree l'imbalance
const impOpen = obClose;
const impClose = impOpen + 8; // tres gros corps haussier
candles.push(makeCandle(t, impOpen, impClose, 0.2, 0.2));
t += step;

// 2eme bougie
candles.push(makeCandle(t, impClose, impClose + 1));
t += step;

// 3eme bougie : son bas doit etre AU-DESSUS du haut de la 1ere bougie d'impulsion
// (pour creer l'imbalance). On la place bien plus haut.
const c3open = impClose + 3;
candles.push(makeCandle(t, c3open, c3open + 1, 0.2, 0.2));
t += step;

// Quelques bougies qui continuent de monter SANS revenir sur l'OB (non mitige)
price = c3open + 1;
for (let i = 0; i < 6; i++) {
  const o = price;
  price += 0.5;
  candles.push(makeCandle(t, o, price));
  t += step;
}

const obs = findOrderBlocks(candles, { impulseBodyMultiple: 1.8, rsiPeriod: 14 });
const bullish = obs.filter((o) => o.direction === "bullish");

console.log("\nTest detection OB haussier:");
console.log("  Nombre d'OB haussiers detectes:", bullish.length);
if (bullish.length) {
  // On cherche celui correspondant a notre OB construit
  const found = bullish.find((o) => Math.abs(o.time - obTime) < step);
  if (found) {
    console.log("  OB cible trouve ✅");
    console.log("  Etoiles:", JSON.stringify(found.stars));
    console.log("  Nombre d'etoiles:", found.starCount, "/5");
    console.log("  RSI:", found.rsiValue, "biais", found.rsiBias);
    console.log("  Score total:", found.totalScore, "/100");
  } else {
    console.log("  ⚠️ OB cible NON trouve a l'index attendu");
  }
}

console.log("\nTest termine.");
