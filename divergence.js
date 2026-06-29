// ============================================================
//  DIVERGENCES RSI + confirmation MACD ZERO LAG
//
//  Methode des videos (Faustin) :
//   - Une divergence = le prix part dans un sens, l'oscillateur
//     dans l'autre (anomalie de marche).
//     * Divergence baissiere : prix fait un plus-haut, RSI fait
//       un plus-bas -> signal de VENTE.
//     * Divergence haussiere : prix fait un plus-bas, RSI fait
//       un plus-haut -> signal d'ACHAT.
//   - ON NE TRADE JAMAIS la divergence seule. Il faut une
//     VALIDATION : cassure de structure + bougie "de A a Z".
//
//  Ici la confirmation se fait avec le MACD ZERO LAG :
//   - MACD Zero Lag baissier (ligne sous signal) -> confirme une
//     divergence baissiere.
//   - MACD Zero Lag haussier (ligne au-dessus signal) -> confirme
//     une divergence haussiere.
//
//  Le MACD Zero Lag reduit le retard du MACD classique en utilisant
//  des EMA "deslagguees" (technique d'Ehlers : on corrige chaque EMA
//  par l'ecart avec sa propre version retardee).
//
//  Concu pour 15 min et plus.
// ============================================================

import { computeRSI } from "./rsi.js";
import { hasSolidBody, buildStructuralLevels } from "./confirm.js";

// --- EMA simple ---
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// --- EMA "Zero Lag" (deslaggee) ---
// ZLEMA = EMA( serie + (serie - serie_retardee) ), ce qui anticipe
// le retard naturel de l'EMA. lag = (period-1)/2.
function zeroLagEMA(values, period) {
  const lag = Math.floor((period - 1) / 2);
  const adjusted = values.map((v, i) => {
    const old = i - lag >= 0 ? values[i - lag] : values[0];
    return v + (v - old); // serie "deslagguee"
  });
  return ema(adjusted, period);
}

// --- MACD Zero Lag ---
// Comme le MACD classique mais avec des EMA Zero Lag.
// Retourne { macd[], signal[], hist[] }.
export function computeMacdZeroLag(closes, fast = 12, slow = 26, signalP = 9) {
  const emaFast = zeroLagEMA(closes, fast);
  const emaSlow = zeroLagEMA(closes, slow);
  const macd = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  // Ligne de signal : Zero Lag EMA de la ligne MACD
  const macdVals = macd.map((v) => (v == null ? 0 : v));
  const signal = zeroLagEMA(macdVals, signalP);
  const hist = macd.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i] : null
  );
  return { macd, signal, hist };
}

// --- Trouve les N derniers pivots (hauts ou bas) d'une serie ---
function lastNPivots(values, type, n, left = 2, right = 2) {
  const pivots = [];
  for (let i = left; i < values.length - right; i++) {
    let ok = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (type === "high" && values[j] >= values[i]) ok = false;
      if (type === "low" && values[j] <= values[i]) ok = false;
    }
    if (ok) pivots.push({ index: i, value: values[i] });
  }
  return pivots.slice(-n); // les n plus recents
}

// Verifie qu'une suite de valeurs est strictement croissante.
function strictlyIncreasing(arr) {
  for (let k = 1; k < arr.length; k++) if (arr[k] <= arr[k - 1]) return false;
  return true;
}
// Verifie qu'une suite de valeurs est strictement decroissante.
function strictlyDecreasing(arr) {
  for (let k = 1; k < arr.length; k++) if (arr[k] >= arr[k - 1]) return false;
  return true;
}

// --- Detecte une divergence RSI confirmee par le MACD Zero Lag ---
// Retourne un objet signal ou null.
export function findRsiDivergence(candles, opts) {
  const {
    rsiPeriod = 14,
    tradeLevels,
    minTp1Distance,
    minPoints = 3, // nombre de points de contact requis (prix + RSI)
  } = opts || {};

  if (candles.length < 50) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rsi = computeRSI(closes, rsiPeriod);
  const { macd, signal } = computeMacdZeroLag(closes);

  const lastPrice = closes[closes.length - 1];
  const i = closes.length - 1;
  const macdNow = macd[i];
  const sigNow = signal[i];
  if (macdNow == null || sigNow == null) return null;

  // --- Divergence BAISSIERE : prix fait des plus-hauts montants,
  //     RSI fait des plus-hauts descendants, sur minPoints points ---
  const priceHighs = lastNPivots(highs, "high", minPoints);
  const rsiAtHighs = priceHighs.map((p) => rsi[p.index]);
  if (priceHighs.length === minPoints && rsiAtHighs.every((v) => v != null)) {
    const priceUp = strictlyIncreasing(priceHighs.map((p) => p.value));
    const rsiDown = strictlyDecreasing(rsiAtHighs);
    const macdConfirms = macdNow < sigNow; // MACD ZL baissier
    const lastC = candles[candles.length - 1];
    const candleConfirms = lastC.close < lastC.open && hasSolidBody(lastC, 0.5);
    if (priceUp && rsiDown && macdConfirms && candleConfirms) {
      return buildDivergence({
        direction: "bearish",
        entry: lastPrice,
        pivotIndex: priceHighs[priceHighs.length - 1].index,
        extreme: priceHighs[priceHighs.length - 1].value,
        rsiNow: rsi[i],
        candles,
        tradeLevels,
        minTp1Distance,
      });
    }
  }

  // --- Divergence HAUSSIERE : prix fait des plus-bas descendants,
  //     RSI fait des plus-bas montants, sur minPoints points ---
  const priceLows = lastNPivots(lows, "low", minPoints);
  const rsiAtLows = priceLows.map((p) => rsi[p.index]);
  if (priceLows.length === minPoints && rsiAtLows.every((v) => v != null)) {
    const priceDown = strictlyDecreasing(priceLows.map((p) => p.value));
    const rsiUp = strictlyIncreasing(rsiAtLows);
    const macdConfirms = macdNow > sigNow; // MACD ZL haussier
    const lastCb = candles[candles.length - 1];
    const candleConfirms = lastCb.close > lastCb.open && hasSolidBody(lastCb, 0.5);
    if (priceDown && rsiUp && macdConfirms && candleConfirms) {
      return buildDivergence({
        direction: "bullish",
        entry: lastPrice,
        pivotIndex: priceLows[priceLows.length - 1].index,
        extreme: priceLows[priceLows.length - 1].value,
        rsiNow: rsi[i],
        candles,
        tradeLevels,
        minTp1Distance,
      });
    }
  }

  return null;
}

function buildDivergence(p) {
  const entry = p.entry;
  // SL "comme Faustin" : sous le dernier plus-bas / au-dessus du dernier
  // plus-haut recent. Annule si trop loin (>3%).
  const levels = buildStructuralLevels(p.direction, entry, p.candles, { maxRiskPct: 3, lookback: 20, minTp1Distance: p.minTp1Distance });
  if (!levels) return null;
  const { stopLoss, risk, takeProfits } = levels;

  return {
    technique: "rsi_divergence",
    direction: p.direction,
    index: p.pivotIndex,
    entry,
    stopLoss,
    risk,
    takeProfits,
    rsiNow: p.rsiNow,
  };
}
