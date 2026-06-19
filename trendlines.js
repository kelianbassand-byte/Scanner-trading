// ============================================================
//  LIGNES DE TENDANCE & CANAUX (methode Faustin / UGK)
//
//  Une ligne de tendance = support/resistance DYNAMIQUE (oblique).
//   - Validee par au moins 2 points de contact.
//   - On trade idealement le 3e contact ; au-dela de 4-5, ca casse
//     souvent (le 6e/7e ne tient plus).
//   - On trade dans le SENS DE LA TENDANCE de fond.
//   - Encore plus puissant si la ligne coincide avec une zone
//     horizontale (polarite) — non gere ici, c'est interpretatif.
//
//  ICI : on alerte a la CASSURE de la ligne (breakout), validee par
//  une vraie bougie (corps net, pas un doji).
//
//  Faustin conseille 1h minimum (2h/daily ideal). 15m trop fragile.
//  -> on l'utilise donc en 1h et 4h seulement (voir config).
// ============================================================

import { buildStructuralLevels } from "./confirm.js";

// --- Pivots hauts et bas (sommets/creux locaux) ---
function findPivots(candles, left = 3, right = 3) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

// --- EMA pour la tendance de fond ---
function computeEMA(closes, period) {
  const ema = new Array(closes.length).fill(null);
  if (closes.length < period) return ema;
  const k = 2 / (period + 1);
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema[period - 1] = prev;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    ema[i] = prev;
  }
  return ema;
}

// A partir de 2 pivots, calcule la droite (prix attendu a un index donne).
function lineValueAt(p1, p2, index) {
  const slope = (p2.price - p1.price) / (p2.index - p1.index);
  return p1.price + slope * (index - p1.index);
}

// Compte combien de pivots "touchent" la ligne (tolerance = % du prix).
function countTouches(pivots, p1, p2, tolerance) {
  let touches = 0;
  for (const pv of pivots) {
    if (pv.index < p1.index || pv.index > p2.index) continue;
    const expected = lineValueAt(p1, p2, pv.index);
    if (Math.abs(pv.price - expected) / expected <= tolerance) touches++;
  }
  return touches;
}

// --- Detecte la cassure d'une ligne de tendance ---
// Retourne un objet signal ou null.
export function findTrendlineBreak(candles, opts) {
  const {
    pivotLeft = 3,
    pivotRight = 3,
    tolerance = 0.0015, // 0,15% : marge pour considerer qu'un pivot touche la ligne
    minTouches = 2, // au moins 2 points de contact pour valider la ligne
    breakoutBodyRatio = 0.5, // la bougie de cassure doit avoir un vrai corps
    emaPeriod = 50,
    tradeLevels,
  } = opts || {};

  if (candles.length < 40) return null;

  const closes = candles.map((c) => c.close);
  const ema = computeEMA(closes, Math.min(emaPeriod, Math.floor(candles.length / 2)));
  const lastEma = ema[ema.length - 1];
  const { highs, lows } = findPivots(candles, pivotLeft, pivotRight);

  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const hasRealBody = range > 0 && body / range >= breakoutBodyRatio;
  if (!hasRealBody) return null; // pas de cassure sur un doji

  // ---- Ligne de RESISTANCE (sur les pivots hauts) : cassure haussiere ----
  // On prend les 2 derniers pivots hauts pour definir la ligne.
  if (highs.length >= 2) {
    const p1 = highs[highs.length - 2];
    const p2 = highs[highs.length - 1];
    const touches = countTouches(highs, p1, p2, tolerance);
    if (touches >= minTouches) {
      const expectedNow = lineValueAt(p1, p2, candles.length - 1);
      // Cassure haussiere : la cloture passe nettement AU-DESSUS de la ligne
      if (last.close > expectedNow * (1 + tolerance)) {
        const trendOk = lastEma == null ? true : last.close >= lastEma;
        if (trendOk) {
          return build({
            direction: "bullish",
            kind: "cassure resistance",
            line: { p1, p2 },
            entry: last.close,
            lineLevel: expectedNow, // niveau de la ligne -> base du SL (reintegration)
            touches,
            candles,
            tradeLevels,
          });
        }
      }
    }
  }

  // ---- Ligne de SUPPORT (sur les pivots bas) : cassure baissiere ----
  if (lows.length >= 2) {
    const p1 = lows[lows.length - 2];
    const p2 = lows[lows.length - 1];
    const touches = countTouches(lows, p1, p2, tolerance);
    if (touches >= minTouches) {
      const expectedNow = lineValueAt(p1, p2, candles.length - 1);
      // Cassure baissiere : la cloture passe nettement EN-DESSOUS de la ligne
      if (last.close < expectedNow * (1 - tolerance)) {
        const trendOk = lastEma == null ? true : last.close <= lastEma;
        if (trendOk) {
          return build({
            direction: "bearish",
            kind: "cassure support",
            line: { p1, p2 },
            entry: last.close,
            lineLevel: expectedNow, // niveau de la ligne -> base du SL (reintegration)
            touches,
            candles,
            tradeLevels,
          });
        }
      }
    }
  }

  return null;
}

function build(p) {
  const entry = p.entry;
  // SL "comme Faustin" : sous le dernier plus-bas / au-dessus du dernier
  // plus-haut recent. Annule si trop loin (>3%).
  const levels = buildStructuralLevels(p.direction, entry, p.candles, { maxRiskPct: 3, lookback: 20 });
  if (!levels) return null;
  const { stopLoss, risk, takeProfits } = levels;

  return {
    technique: "trendline",
    direction: p.direction,
    kind: p.kind,
    touches: p.touches,
    index: p.line.p2.index, // identifiant du signal
    entry,
    stopLoss,
    risk,
    takeProfits,
  };
}
