// ============================================================
//  CONFIRMATION — bougie complete avec corps net (pas un doji)
//
//  Utilise par les 4 techniques avant d'alerter : on exige que la
//  derniere bougie cloturee ait un VRAI corps (la "bougie de A a Z"
//  des videos), et qu'elle cloture du bon cote du niveau.
//
//  Un doji (corps minuscule) = indecision -> on n'alerte pas.
// ============================================================

// La bougie a-t-elle un corps net ? (corps >= ratio du range total)
export function hasSolidBody(candle, minBodyRatio = 0.5) {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range <= 0) return false;
  return body / range >= minBodyRatio;
}

// Bougie haussiere nette qui cloture AU-DESSUS d'un niveau.
export function confirmsAbove(candle, level, minBodyRatio = 0.5) {
  return (
    candle.close > level &&
    candle.close > candle.open && // bougie verte
    hasSolidBody(candle, minBodyRatio)
  );
}

// Bougie baissiere nette qui cloture EN-DESSOUS d'un niveau.
export function confirmsBelow(candle, level, minBodyRatio = 0.5) {
  return (
    candle.close < level &&
    candle.close < candle.open && // bougie rouge
    hasSolidBody(candle, minBodyRatio)
  );
}

// ============================================================
//  SL "comme Faustin" : base sur le dernier pivot de structure
//
//  Achat -> SL sous le dernier PLUS-BAS recent.
//  Vente -> SL au-dessus du dernier PLUS-HAUT recent.
//  Si la distance entre l'entree et ce SL depasse maxRiskPct,
//  le trade est ANNULE (SL trop loin = pas de niveau coherent).
// ============================================================

// Cherche le dernier plus-bas recent (pivot bas) dans les "lookback" bougies.
// Robuste aux plateaux : on autorise des voisins de meme niveau (double-bottom),
// on exige juste qu'aucun voisin ne soit STRICTEMENT plus bas.
export function lastSwingLow(candles, lookback = 20, left = 2, right = 2) {
  const n = candles.length;
  const start = Math.max(left, n - lookback);
  let found = null;
  for (let i = n - 1 - right; i >= start; i--) {
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i || j < 0 || j >= n) continue;
      if (candles[j].low < candles[i].low) isLow = false; // strictement plus bas
    }
    if (isLow) {
      found = candles[i].low;
      break; // le plus recent
    }
  }
  return found;
}

// Cherche le dernier plus-haut recent (pivot haut). Robuste aux plateaux.
export function lastSwingHigh(candles, lookback = 20, left = 2, right = 2) {
  const n = candles.length;
  const start = Math.max(left, n - lookback);
  let found = null;
  for (let i = n - 1 - right; i >= start; i--) {
    let isHigh = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i || j < 0 || j >= n) continue;
      if (candles[j].high > candles[i].high) isHigh = false; // strictement plus haut
    }
    if (isHigh) {
      found = candles[i].high;
      break;
    }
  }
  return found;
}

// Construit SL + 3 TP (X1/X2/X3) a partir du pivot de structure.
// Retourne null si pas de pivot trouve OU si le SL est trop loin (> maxRiskPct).
// direction: "bullish" | "bearish". entry: prix d'entree. candles: bougies.
export function buildStructuralLevels(direction, entry, candles, opts = {}) {
  const { maxRiskPct = 3, lookback = 20, marginPct = 0.1 } = opts;
  const margin = entry * (marginPct / 100); // petite marge sous/sur le pivot

  let stopLoss;
  if (direction === "bullish") {
    const low = lastSwingLow(candles, lookback);
    if (low == null) return null; // pas de plus-bas -> on ne prend pas le trade
    stopLoss = low - margin;
    if (stopLoss >= entry) return null; // incoherent
  } else {
    const high = lastSwingHigh(candles, lookback);
    if (high == null) return null;
    stopLoss = high + margin;
    if (stopLoss <= entry) return null;
  }

  const risk = Math.abs(entry - stopLoss);
  const riskPct = (risk / entry) * 100;
  // Regle de Faustin : si le SL est trop loin, on ANNULE le trade.
  if (riskPct > maxRiskPct) return null;

  // --- TP bases sur la STRUCTURE (le dernier pivot oppose recent) ---
  // Buy  : H = dernier plus-haut recent (resistance visee).
  //   TP1 = mi-chemin entre entree et H
  //   TP2 = juste en dessous de H
  //   TP3 = un peu au-dessus de H (en cas de cassure)
  // Sell : symetrique avec B = dernier plus-bas recent.
  const beyondPct = opts.tpBeyondPct != null ? opts.tpBeyondPct : 0.15; // "un peu au-dela"
  let takeProfits;

  if (direction === "bullish") {
    const high = lastSwingHigh(candles, lookback);
    // Si pas de plus-haut coherent au-dessus de l'entree, on retombe sur X1/X2/X3.
    if (high == null || high <= entry) {
      takeProfits = { tp1: entry + risk, tp2: entry + risk * 2, tp3: entry + risk * 3 };
    } else {
      const span = high - entry; // distance entree -> plus-haut
      const beyond = high * (beyondPct / 100);
      takeProfits = {
        tp1: entry + span / 2, // mi-chemin
        tp2: high - span * 0.1, // juste en dessous du plus-haut (90% du chemin)
        tp3: high + beyond, // un peu au-dessus
      };
    }
  } else {
    const low = lastSwingLow(candles, lookback);
    if (low == null || low >= entry) {
      takeProfits = { tp1: entry - risk, tp2: entry - risk * 2, tp3: entry - risk * 3 };
    } else {
      const span = entry - low; // distance entree -> plus-bas
      const beyond = low * (beyondPct / 100);
      takeProfits = {
        tp1: entry - span / 2, // mi-chemin (vers le bas)
        tp2: low + span * 0.1, // juste au-dessus du plus-bas
        tp3: low - beyond, // un peu en dessous
      };
    }
  }

  return { stopLoss, risk, takeProfits };
}
