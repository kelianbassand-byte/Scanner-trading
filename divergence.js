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
import { hasSolidBody } from "./confirm.js";

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

// --- Trouve les 2 derniers pivots (hauts ou bas) d'une serie ---
function lastTwoPivots(values, type, left = 2, right = 2) {
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
  return pivots.slice(-2); // les deux plus recents
}

// --- Detecte une divergence RSI confirmee par le MACD Zero Lag ---
// Retourne un objet signal ou null.
export function findRsiDivergence(candles, opts) {
  const {
    rsiPeriod = 14,
    tradeLevels,
  } = opts || {};

  if (candles.length < 40) return null;

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

  // --- Divergence BAISSIERE : prix plus-haut, RSI plus-bas ---
  const priceHighs = lastTwoPivots(highs, "high");
  const rsiAtPriceHighs = priceHighs.map((p) => rsi[p.index]).filter((v) => v != null);
  if (priceHighs.length === 2 && rsiAtPriceHighs.length === 2) {
    const priceUp = priceHighs[1].value > priceHighs[0].value;
    const rsiDown = rsiAtPriceHighs[1] < rsiAtPriceHighs[0];
    const macdConfirms = macdNow < sigNow; // MACD ZL baissier
    const lastC = candles[candles.length - 1];
    const candleConfirms = lastC.close < lastC.open && hasSolidBody(lastC, 0.5);
    if (priceUp && rsiDown && macdConfirms && candleConfirms) {
      return buildDivergence({
        direction: "bearish",
        entry: lastPrice,
        pivotIndex: priceHighs[1].index,
        extreme: priceHighs[1].value, // dernier plus-haut -> base du SL
        rsiNow: rsi[i],
        tradeLevels,
      });
    }
  }

  // --- Divergence HAUSSIERE : prix plus-bas, RSI plus-haut ---
  const priceLows = lastTwoPivots(lows, "low");
  const rsiAtPriceLows = priceLows.map((p) => rsi[p.index]).filter((v) => v != null);
  if (priceLows.length === 2 && rsiAtPriceLows.length === 2) {
    const priceDown = priceLows[1].value < priceLows[0].value;
    const rsiUp = rsiAtPriceLows[1] > rsiAtPriceLows[0];
    const macdConfirms = macdNow > sigNow; // MACD ZL haussier
    const lastCb = candles[candles.length - 1];
    const candleConfirms = lastCb.close > lastCb.open && hasSolidBody(lastCb, 0.5);
    if (priceDown && rsiUp && macdConfirms && candleConfirms) {
      return buildDivergence({
        direction: "bullish",
        entry: lastPrice,
        pivotIndex: priceLows[1].index,
        extreme: priceLows[1].value, // dernier plus-bas -> base du SL
        rsiNow: rsi[i],
        tradeLevels,
      });
    }
  }

  return null;
}

function buildDivergence(p) {
  const entry = p.entry;
  // SL au-dela du dernier extreme qui a forme la divergence (structure).
  // Petite marge de 0,1% pour le bruit/spread.
  const margin = entry * 0.001;
  let stopLoss, risk, takeProfits;

  if (p.direction === "bullish") {
    // SL sous le dernier plus-bas
    stopLoss = (p.extreme != null ? p.extreme : entry * 0.995) - margin;
    risk = entry - stopLoss;
    takeProfits = {
      tp1: entry + risk * 1,
      tp2: entry + risk * 2,
      tp3: entry + risk * 3,
    };
  } else {
    // SL au-dessus du dernier plus-haut
    stopLoss = (p.extreme != null ? p.extreme : entry * 1.005) + margin;
    risk = stopLoss - entry;
    takeProfits = {
      tp1: entry - risk * 1,
      tp2: entry - risk * 2,
      tp3: entry - risk * 3,
    };
  }

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
