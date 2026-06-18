// ============================================================
//  ORDER BLOCKS — methode V / V inverse (Faustin / UGK)
//
//  Un order block = une zone de support/resistance "optimisee".
//
//  OB HAUSSIER (achat) :
//    le marche BAISSE, forme un creux en V, puis REPART a la hausse.
//    On trace la zone sur la DERNIERE BOUGIE ROUGE (baissiere) avant
//    le retournement, meches incluses. -> zone d'achat.
//
//  OB BAISSIER (vente) :
//    le marche MONTE, forme un pic en V inverse, puis repart a la baisse.
//    On trace la zone sur la DERNIERE BOUGIE VERTE (haussiere) avant
//    le retournement, meches incluses. -> zone de vente.
//
//  Regles cles des videos :
//   - On ne trace QUE quand le V est confirme (le retournement a eu lieu).
//     Pas d'anticipation.
//   - On alerte des que le V est confirme (au retournement).
//   - On trade dans le SENS DE LA TENDANCE DE FOND (filtre EMA).
//   - Pas besoin de multiples points de contact. Un plus-bas / plus-haut
//     net suffit. "Trop beau pour etre vrai" = piege.
//
//  Concu pour 15 min et plus (jamais en dessous).
// ============================================================

// --- Moyenne mobile exponentielle, filtre de tendance de fond ---
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

// Detecte un pivot bas (creux du V) ou pivot haut (pic du V inverse).
// left/right = nombre de bougies de chaque cote qui doivent etre plus
// hautes (pour un creux) ou plus basses (pour un pic).
function isPivotLow(candles, i, left, right) {
  for (let j = i - left; j <= i + right; j++) {
    if (j === i || j < 0 || j >= candles.length) continue;
    if (candles[j].low <= candles[i].low) return false;
  }
  return true;
}
function isPivotHigh(candles, i, left, right) {
  for (let j = i - left; j <= i + right; j++) {
    if (j === i || j < 0 || j >= candles.length) continue;
    if (candles[j].high >= candles[i].high) return false;
  }
  return true;
}

// Cherche le dernier order block V / V inverse confirme.
// Retourne un objet OB ou null.
export function findOrderBlockVShape(candles, opts) {
  const {
    pivotLeft = 3, // bougies de descente avant le creux
    pivotRight = 3, // bougies de remontee apres le creux (confirme le V)
    emaPeriod = 50, // tendance de fond
    tradeLevels,
  } = opts || {};

  if (candles.length < pivotLeft + pivotRight + 5) return null;

  const closes = candles.map((c) => c.close);
  const ema = computeEMA(closes, Math.min(emaPeriod, Math.floor(candles.length / 2)));
  const lastEma = ema[ema.length - 1];
  const lastPrice = closes[closes.length - 1];

  // On cherche le pivot le plus RECENT possible mais deja confirme.
  // Le pivot doit avoir "pivotRight" bougies apres lui (le V est forme).
  const lastPivotIndex = candles.length - 1 - pivotRight;

  // On balaie de la bougie la plus recente confirmee vers le passe proche
  // (on ne veut que les OB recents, pas ceux d'il y a 200 bougies).
  const horizon = Math.min(lastPivotIndex, pivotLeft + pivotRight + 30);

  for (let i = lastPivotIndex; i >= lastPivotIndex - horizon && i > pivotLeft; i--) {
    // --- V classique (creux) -> OB haussier ---
    if (isPivotLow(candles, i, pivotLeft, pivotRight)) {
      // On cherche la derniere bougie ROUGE avant ou au creux.
      let obIndex = -1;
      for (let k = i; k >= Math.max(0, i - pivotLeft); k--) {
        if (candles[k].close < candles[k].open) {
          obIndex = k;
          break;
        }
      }
      if (obIndex === -1) continue;
      const ob = candles[obIndex];

      // Filtre tendance de fond : on n'achete que si le prix est
      // au-dessus de l'EMA (tendance haussiere de fond).
      const trendOk = lastEma == null ? true : lastPrice >= lastEma;

      return buildOB({
        direction: "bullish",
        zoneTop: ob.high, // meches incluses
        zoneBottom: ob.low,
        pivotIndex: i,
        obIndex,
        entry: lastPrice,
        trendOk,
        lastEma,
        candles,
        tradeLevels,
      });
    }

    // --- V inverse (pic) -> OB baissier ---
    if (isPivotHigh(candles, i, pivotLeft, pivotRight)) {
      // Derniere bougie VERTE avant ou au pic.
      let obIndex = -1;
      for (let k = i; k >= Math.max(0, i - pivotLeft); k--) {
        if (candles[k].close > candles[k].open) {
          obIndex = k;
          break;
        }
      }
      if (obIndex === -1) continue;
      const ob = candles[obIndex];
      const trendOk = lastEma == null ? true : lastPrice <= lastEma;

      return buildOB({
        direction: "bearish",
        zoneTop: ob.high,
        zoneBottom: ob.low,
        pivotIndex: i,
        obIndex,
        entry: lastPrice,
        trendOk,
        lastEma,
        candles,
        tradeLevels,
      });
    }
  }

  return null;
}

// Construit l'objet OB avec SL / TP (grille en % du prix d'entree).
function buildOB(p) {
  const lv = p.tradeLevels || { slPct: 0.5, tp1Pct: 0.75, tp2Pct: 1.5, tp3Pct: 3.0 };
  const entry = p.entry;
  let stopLoss, risk, takeProfits;

  if (p.direction === "bullish") {
    stopLoss = entry * (1 - lv.slPct / 100);
    risk = entry - stopLoss;
    takeProfits = {
      tp1: entry * (1 + lv.tp1Pct / 100),
      tp2: entry * (1 + lv.tp2Pct / 100),
      tp3: entry * (1 + lv.tp3Pct / 100),
    };
  } else {
    stopLoss = entry * (1 + lv.slPct / 100);
    risk = stopLoss - entry;
    takeProfits = {
      tp1: entry * (1 - lv.tp1Pct / 100),
      tp2: entry * (1 - lv.tp2Pct / 100),
      tp3: entry * (1 - lv.tp3Pct / 100),
    };
  }

  return {
    technique: "ob_vshape",
    direction: p.direction,
    zoneTop: p.zoneTop,
    zoneBottom: p.zoneBottom,
    index: p.pivotIndex, // sert d'identifiant unique du signal
    entry,
    stopLoss,
    risk,
    takeProfits,
    trendOk: p.trendOk,
    emaValue: p.lastEma,
  };
}
