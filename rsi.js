// ============================================================
//  RSI — Relative Strength Index
//  Calcul classique de Wilder (lissage exponentiel).
//
//  Methode des videos: on N'UTILISE PAS le 70/30 pour entrer/sortir.
//  On utilise la NEUTRALITE a 50 :
//     RSI > 50  -> biais haussier
//     RSI < 50  -> biais baissier
//  Et on s'en sert comme CONFIRMATION / bonus, pas comme signal seul.
// ============================================================

// Calcule la serie complete du RSI a partir des prix de cloture.
// Retourne un tableau de la meme longueur (les premieres valeurs sont null).
export function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;

  let gains = 0;
  let losses = 0;

  // Premiere moyenne = moyenne simple des "period" premieres variations
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = toRsi(avgGain, avgLoss);

  // Ensuite lissage de Wilder
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = toRsi(avgGain, avgLoss);
  }

  return rsi;
}

function toRsi(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Donne le biais selon la methode neutralite 50.
export function rsiBias(rsiValue) {
  if (rsiValue == null) return "indetermine";
  if (rsiValue >= 50) return "haussier";
  return "baissier";
}

// Detecte une divergence simple sur les N dernieres bougies.
// Divergence haussiere (bullish): le prix fait un plus-bas plus bas,
// mais le RSI fait un plus-bas plus haut. (et inverse pour baissiere)
// Renvoie "bullish", "bearish" ou null.
export function detectDivergence(closes, rsi, lookback = 20) {
  const n = closes.length;
  if (n < lookback + 2) return null;

  const slice = closes.slice(n - lookback);
  const rsiSlice = rsi.slice(n - lookback);

  const lowIdx = indexOfMin(slice);
  const highIdx = indexOfMax(slice);

  // On compare le creux/sommet le plus recent au precedent extreme.
  const lastClose = slice[slice.length - 1];
  const lastRsi = rsiSlice[rsiSlice.length - 1];
  if (lastRsi == null) return null;

  // Bullish: prix actuel <= ancien plus bas MAIS rsi actuel > rsi de l'ancien plus bas
  if (lastClose <= slice[lowIdx] * 1.001 && rsiSlice[lowIdx] != null && lastRsi > rsiSlice[lowIdx]) {
    return "bullish";
  }
  // Bearish: prix actuel >= ancien plus haut MAIS rsi actuel < rsi de l'ancien plus haut
  if (lastClose >= slice[highIdx] * 0.999 && rsiSlice[highIdx] != null && lastRsi < rsiSlice[highIdx]) {
    return "bearish";
  }
  return null;
}

function indexOfMin(arr) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[idx]) idx = i;
  return idx;
}
function indexOfMax(arr) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[idx]) idx = i;
  return idx;
}
