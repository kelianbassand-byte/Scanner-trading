// ============================================================
//  RANGE — methode de la REINTEGRATION (Faustin / UGK)
//
//  Un range = marche neutre entre un SUPPORT et une RESISTANCE,
//  chacun teste plusieurs fois. 70% du temps le marche est en range.
//
//  LA METHODE (on ne trade PAS les cassures / breakout) :
//   - On attend un FAUX BREAKOUT : le prix sort du range (une borne
//     est depassee par une meche), PUIS une bougie complete cloture
//     a nouveau DANS le range -> c'est la "reintegration".
//   - La reintegration piege les traders entres sur la cassure.
//   - On entre dans le SENS DE LA TENDANCE DE FOND (filtre EMA).
//     * Faux breakout par le BAS qui reintegre -> signal d'ACHAT
//       (valable si tendance de fond haussiere).
//     * Faux breakout par le HAUT qui reintegre -> signal de VENTE
//       (valable si tendance de fond baissiere).
//   - Confirmation : la bougie de reintegration doit etre complete
//     (corps net), pas un simple doji.
//
//  30 min minimum (ici 1h et 4h, cf config). Jamais en dessous.
// ============================================================

import { hasSolidBody } from "./confirm.js";

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

// Detecte un range : cherche un support et une resistance testes plusieurs
// fois sur les "window" dernieres bougies (hors toute derniere bougie).
// On utilise des PERCENTILES (pas le min/max brut) pour qu'une seule bougie
// aberrante (faux breakout, meche isolee) n'elargisse pas tout le range.
// Retourne { support, resistance } ou null si pas de range clair.
function detectRange(candles, window, tolerance) {
  const n = candles.length;
  const start = Math.max(0, n - 1 - window);
  const slice = candles.slice(start, n - 1); // on exclut la derniere bougie
  if (slice.length < 10) return null;

  // Percentiles : resistance = ~90e percentile des hauts, support = ~10e des bas.
  // Ainsi les meches isolees (au-dela) ne definissent pas la borne.
  const highsSorted = slice.map((c) => c.high).sort((a, b) => a - b);
  const lowsSorted = slice.map((c) => c.low).sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const resistance = pct(highsSorted, 0.9);
  const support = pct(lowsSorted, 0.1);
  const height = resistance - support;
  if (height <= 0) return null;

  // Compter combien de bougies "touchent" chaque borne (a tolerance pres).
  const tol = height * tolerance;
  let touchesRes = 0;
  let touchesSup = 0;
  for (const c of slice) {
    if (Math.abs(c.high - resistance) <= tol) touchesRes++;
    if (Math.abs(c.low - support) <= tol) touchesSup++;
  }
  // Il faut au moins 2 touches de chaque borne pour parler de range.
  if (touchesRes < 2 || touchesSup < 2) return null;

  // Le range ne doit pas etre trop "plat" (bruit).
  const mid = (support + resistance) / 2;
  const heightPct = (height / mid) * 100;
  if (heightPct < 0.3) return null; // trop serre = bruit

  return { support, resistance, height, mid };
}

// Detecte une reintegration apres faux breakout.
export function findRangeReintegration(candles, opts) {
  const {
    window = 40, // nombre de bougies pour delimiter le range
    tolerance = 0.1, // tolerance de "touche" d'une borne (10% de la hauteur)
    emaPeriod = 100, // tendance de fond
    bodyRatio = 0.5, // bougie de reintegration : corps net
  } = opts || {};

  if (candles.length < 30) return null;

  const range = detectRange(candles, window, tolerance);
  if (!range) return null;

  const closes = candles.map((c) => c.close);
  const ema = computeEMA(closes, Math.min(emaPeriod, Math.floor(candles.length / 2)));
  const lastEma = ema[ema.length - 1];

  // Les 2 dernieres bougies : l'avant-derniere doit etre SORTIE du range
  // (faux breakout), la derniere doit REINTEGRER (cloturer dans le range).
  const prev = candles[candles.length - 2];
  const last = candles[candles.length - 1];
  if (!hasSolidBody(last, bodyRatio)) return null; // reintegration molle = ignore

  const lastPrice = last.close;
  const tolAbs = range.height * tolerance;

  // --- Faux breakout par le BAS -> reintegration -> ACHAT ---
  // L'avant-derniere bougie est passee SOUS le support (meche ou corps),
  // la derniere recloture AU-DESSUS du support.
  const brokeBelow = prev.low < range.support - tolAbs * 0.2;
  const reentersUp = last.close > range.support;
  if (brokeBelow && reentersUp) {
    // tendance de fond haussiere requise
    const trendOk = lastEma == null ? true : lastPrice >= lastEma;
    if (trendOk) {
      return {
        technique: "range",
        direction: "bullish",
        support: range.support,
        resistance: range.resistance,
        entry: lastPrice,
        index: candles.length - 1,
      };
    }
  }

  // --- Faux breakout par le HAUT -> reintegration -> VENTE ---
  const brokeAbove = prev.high > range.resistance + tolAbs * 0.2;
  const reentersDown = last.close < range.resistance;
  if (brokeAbove && reentersDown) {
    const trendOk = lastEma == null ? true : lastPrice <= lastEma;
    if (trendOk) {
      return {
        technique: "range",
        direction: "bearish",
        support: range.support,
        resistance: range.resistance,
        entry: lastPrice,
        index: candles.length - 1,
      };
    }
  }

  return null;
}
