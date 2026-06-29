// ============================================================
//  TRIANGLES & BISEAUX — figures de compression
//  (d'apres la methode swing trading des videos)
//
//  Concept : le prix se "compresse" comme un ressort entre une
//  resistance qui descend et un support qui monte (ou inversement).
//  A la cassure, le prix explose dans un sens.
//
//  Regles cles des videos :
//   - Detecter la compression : les hauts baissent ET les bas montent
//     (ou au moins l'amplitude se reduit nettement).
//   - Attendre une VRAIE bougie de cassure ("bougie de A a Z"),
//     complete et avec du corps — pas un petit doji (piege).
//   - Trader dans le SENS DE LA TENDANCE (filtre moyenne mobile EMA100).
//   - TP = dernier plus haut de la figure (achat) / plus bas (vente).
//   - SL = dans la zone qui reintegrerait la figure (invalidation).
//
//  Concu pour grandes unites de temps (4h, daily).
// ============================================================

// --- Moyenne mobile exponentielle (EMA) ---
// Sert de filtre de tendance, filtre de tendance de fond (EMA 100).
function computeEMA(closes, period) {
  const ema = new Array(closes.length).fill(null);
  if (closes.length < period) return ema;
  const k = 2 / (period + 1);
  // initialisation : moyenne simple des "period" premieres valeurs
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema[period - 1] = prev;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    ema[i] = prev;
  }
  return ema;
}

// --- Trouver les pivots (sommets et creux locaux) ---
// Un sommet = une bougie dont le haut depasse ses voisines.
// Un creux = une bougie dont le bas est sous ses voisines.
function findPivots(candles, left = 2, right = 2) {
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

// --- Detecter une figure de compression ---
// On regarde les derniers pivots : si les sommets descendent et/ou
// les creux montent, et que l'amplitude se reduit, c'est une compression.
export function findTriangles(candles, opts) {
  const {
    emaPeriod = 100,
    minPivots = 3, // au moins 3 sommets + 3 creux pour une figure fiable
    breakoutBodyRatio = 0.5, // la bougie de cassure doit avoir un vrai corps
  } = opts || {};

  const closes = candles.map((c) => c.close);
  const ema = computeEMA(closes, Math.min(emaPeriod, Math.floor(candles.length / 2)));
  const { highs, lows } = findPivots(candles);

  if (highs.length < minPivots || lows.length < minPivots) {
    return null; // pas assez de structure pour dessiner une figure
  }

  // On prend les 3 derniers sommets et creux
  const lastHighs = highs.slice(-3);
  const lastLows = lows.slice(-3);

  // Pente des sommets (resistance) et des creux (support)
  const highSlope = lastHighs[lastHighs.length - 1].price - lastHighs[0].price;
  const lowSlope = lastLows[lastLows.length - 1].price - lastLows[0].price;

  // Amplitude au debut vs a la fin de la figure
  const ampStart = lastHighs[0].price - lastLows[0].price;
  const ampEnd =
    lastHighs[lastHighs.length - 1].price - lastLows[lastLows.length - 1].price;

  // Compression = l'amplitude finale est nettement plus petite qu'au debut
  const isCompressing = ampEnd > 0 && ampEnd < ampStart * 0.7;
  if (!isCompressing) return null;

  // Type de figure (informatif)
  let type;
  if (highSlope < 0 && lowSlope > 0) type = "triangle symetrique";
  else if (highSlope < 0 && Math.abs(lowSlope) < ampStart * 0.1) type = "triangle descendant";
  else if (lowSlope > 0 && Math.abs(highSlope) < ampStart * 0.1) type = "triangle ascendant";
  else if (highSlope < 0 && lowSlope < 0) type = "biseau descendant";
  else if (highSlope > 0 && lowSlope > 0) type = "biseau ascendant";
  else type = "compression";

  // Bornes de la figure
  const figureTop = Math.max(...lastHighs.map((h) => h.price));
  const figureBottom = Math.min(...lastLows.map((l) => l.price));

  // --- Detecter la cassure : 2 niveaux ---
  //  - "wick"  : une MECHE depasse la figure (alerte precoce)
  //  - "close" : le CORPS ENTIER (open ET close) est dehors (confirmation).
  //              Les meches peuvent encore depasser dans la figure, peu importe.
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const hasRealBody = range > 0 && body / range >= breakoutBodyRatio; // pas un doji
  const bodyTop = Math.max(last.open, last.close);
  const bodyBottom = Math.min(last.open, last.close);

  const lastEma = ema[ema.length - 1];
  let breakout = null; // "bullish" | "bearish" | null
  let breakLevel = null; // "wick" | "close"

  // Corps ENTIER au-dessus du haut de la figure (open ET close dehors) = confirmation
  if (bodyBottom > figureTop && hasRealBody) {
    breakout = "bullish";
    breakLevel = "close";
  } else if (bodyTop < figureBottom && hasRealBody) {
    breakout = "bearish";
    breakLevel = "close";
  }
  // Sinon : une simple meche depasse = cassure precoce (corps encore dans/sur la figure)
  else if (last.high > figureTop) {
    breakout = "bullish";
    breakLevel = "wick";
  } else if (last.low < figureBottom) {
    breakout = "bearish";
    breakLevel = "wick";
  }

  if (!breakout) return null; // le prix est encore dans la figure

  // --- Filtre tendance (EMA) ---
  // On ne prend la cassure que dans le sens de la tendance.
  let trendOk = true;
  let trendNote = "";
  if (lastEma != null) {
    if (breakout === "bullish" && last.close < lastEma) {
      trendOk = false;
      trendNote = "cassure haussiere mais prix sous EMA100 (contre-tendance)";
    }
    if (breakout === "bearish" && last.close > lastEma) {
      trendOk = false;
      trendNote = "cassure baissiere mais prix au-dessus EMA100 (contre-tendance)";
    }
  }

  // --- Niveaux de trade ---
  const entry = last.close;
  let stopLoss, takeProfit, risk;
  const figureHeight = figureTop - figureBottom;

  if (breakout === "bullish") {
    // SL : sous le bas de la figure (reintegration = invalidation)
    stopLoss = figureBottom - figureHeight * 0.1;
    // TP : projection = hauteur de la figure ajoutee au point de cassure
    takeProfit = figureTop + figureHeight;
    risk = entry - stopLoss;
  } else {
    stopLoss = figureTop + figureHeight * 0.1;
    takeProfit = figureBottom - figureHeight;
    risk = stopLoss - entry;
  }

  return {
    type,
    breakout, // "bullish" / "bearish"
    breakLevel, // "wick" (meche) / "close" (bougie cloturee dehors)
    figureTop,
    figureBottom,
    entry,
    stopLoss,
    takeProfit,
    risk,
    trendOk,
    trendNote,
    emaValue: lastEma,
  };
}
