// ============================================================
//  ORDER BLOCKS — methode "5 etoiles" (d'apres les videos Casper)
//
//  Definition d'un order block (OB) :
//   - OB HAUSSIER (bullish) = la DERNIERE bougie baissiere avant un
//     violent rally haussier. Zone d'achat / support potentiel.
//   - OB BAISSIER (bearish) = la DERNIERE bougie haussiere avant un
//     violent mouvement baissier. Zone de vente / resistance potentiel.
//
//  Les 5 ETOILES (criteres de qualite) :
//   1. IMBALANCE : a la creation de l'OB, le haut de la 1ere bougie ne
//      touche pas le bas de la 3eme bougie (gap d'inefficience).
//   2. TENDANCE : l'OB va dans le sens de la tendance globale.
//      (OB haussier seulement si marche haussier, et inverse)
//   3. NON MITIGE : le prix n'est jamais revenu toucher l'OB depuis sa
//      creation. (un OB deja touche perd en probabilite)
//   4. PRISE DE LIQUIDITE : juste avant l'OB, le marche est venu chasser
//      un plus-bas/plus-haut precedent (balayage de stops).
//   5. SESSION VOLATILE : l'OB s'est forme pendant la session
//      europeenne ou americaine (et non la session asiatique calme).
//
//  Chaque etoile vaut 20 points -> score sur 100.
// ============================================================

import { computeRSI, rsiBias, detectDivergence } from "./rsi.js";

// candle = { time, open, high, low, close, volume }

// ---- 1. Detecter une impulsion (mouvement violent) ----
// On regarde si la bougie a l'indice i est le DEBUT d'une impulsion.
// Une impulsion = corps nettement plus grand que la moyenne recente,
// dans une seule direction.
function avgBody(candles, end, window = 20) {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, end - window); i < end; i++) {
    sum += Math.abs(candles[i].close - candles[i].open);
    count++;
  }
  return count ? sum / count : 0;
}

// ---- ETOILE 1 : imbalance ----
// On verifie le gap entre bougie (idx) et bougie (idx+2).
function hasImbalance(candles, obIndex, direction) {
  const c1 = candles[obIndex + 1]; // 1ere bougie d'impulsion
  const c3 = candles[obIndex + 3]; // 3eme bougie
  if (!c1 || !c3) return false;
  if (direction === "bullish") {
    // haut de c1 ne touche pas le bas de c3 (gap haussier)
    return c1.high < c3.low;
  } else {
    // bas de c1 ne touche pas le haut de c3 (gap baissier)
    return c1.low > c3.high;
  }
}

// ---- ETOILE 2 : tendance ----
// Tendance simple via la pente d'une moyenne mobile + structure.
function getTrend(candles, period = 50) {
  const n = candles.length;
  if (n < period + 5) return "indetermine";
  const maNow = sma(candles, n - 1, period);
  const maPrev = sma(candles, n - 6, period);
  if (maNow > maPrev) return "haussier";
  if (maNow < maPrev) return "baissier";
  return "indetermine";
}
function sma(candles, end, period) {
  let sum = 0;
  for (let i = end - period + 1; i <= end; i++) sum += candles[i].close;
  return sum / period;
}

// ---- ETOILE 3 : non mitige ----
// Depuis la creation de l'OB jusqu'a maintenant, le prix est-il revenu
// dans la zone de l'OB ? Si oui -> mitige (on retire l'etoile).
function isUnmitigated(candles, ob) {
  for (let i = ob.index + 4; i < candles.length; i++) {
    const c = candles[i];
    // chevauchement entre la bougie et la zone de l'OB
    if (c.low <= ob.top && c.high >= ob.bottom) {
      return false; // touche => mitige
    }
  }
  return true;
}

// ---- ETOILE 4 : prise de liquidite ----
// Avant l'OB, est-ce que le marche est venu balayer un extreme precedent ?
// Pour un OB haussier: une meche est allee SOUS un plus-bas recent puis est remontee.
function tookLiquidity(candles, obIndex, direction, lookback = 15) {
  const start = Math.max(0, obIndex - lookback);
  if (direction === "bullish") {
    // plus-bas de reference dans la fenetre AVANT la zone proche de l'OB
    let refLow = Infinity;
    for (let i = start; i < obIndex - 2; i++) refLow = Math.min(refLow, candles[i].low);
    // une des 3 bougies juste avant l'OB est-elle allee sous ce plus-bas ?
    for (let i = obIndex - 2; i <= obIndex; i++) {
      if (candles[i] && candles[i].low < refLow) return true;
    }
  } else {
    let refHigh = -Infinity;
    for (let i = start; i < obIndex - 2; i++) refHigh = Math.max(refHigh, candles[i].high);
    for (let i = obIndex - 2; i <= obIndex; i++) {
      if (candles[i] && candles[i].high > refHigh) return true;
    }
  }
  return false;
}

// ---- ETOILE 5 : session volatile ----
// Session europeenne (~07h-16h UTC) ou americaine (~13h-21h UTC).
// Session asiatique calme ~22h-06h UTC -> pas d'etoile.
function isVolatileSession(timeMs) {
  const h = new Date(timeMs).getUTCHours();
  const european = h >= 7 && h < 16;
  const american = h >= 13 && h < 21;
  return european || american;
}

// ---- Detection principale ----
// Parcourt les bougies, trouve les OB, et evalue les 5 etoiles.
export function findOrderBlocks(candles, opts) {
  const {
    impulseBodyMultiple = 1.8,
    rsiPeriod = 14,
  } = opts || {};

  const rsi = computeRSI(candles.map((c) => c.close), rsiPeriod);
  const trend = getTrend(candles);
  const results = [];

  // On s'arrete avant les 4 dernieres bougies (besoin de bougies apres l'OB)
  for (let i = 2; i < candles.length - 4; i++) {
    const ob = candles[i];
    const body = Math.abs(ob.close - ob.open);
    const reference = avgBody(candles, i);
    const next = candles[i + 1];
    if (!next || reference === 0) continue;

    const nextBody = Math.abs(next.close - next.open);
    const isImpulse = nextBody >= reference * impulseBodyMultiple;
    if (!isImpulse) continue;

    // OB haussier = bougie baissiere (close<open) suivie d'une impulsion haussiere
    let direction = null;
    if (ob.close < ob.open && next.close > next.open) direction = "bullish";
    else if (ob.close > ob.open && next.close < next.open) direction = "bearish";
    if (!direction) continue;

    const zone = {
      index: i,
      direction,
      time: ob.time,
      top: Math.max(ob.open, ob.close, ob.high),
      bottom: Math.min(ob.open, ob.close, ob.low),
    };

    // --- Evaluation des 5 etoiles ---
    const stars = {
      imbalance: hasImbalance(candles, i, direction),
      tendance:
        (direction === "bullish" && trend === "haussier") ||
        (direction === "bearish" && trend === "baissier"),
      nonMitige: isUnmitigated(candles, zone),
      liquidite: tookLiquidity(candles, i, direction),
      sessionVolatile: isVolatileSession(ob.time),
    };

    const starCount = Object.values(stars).filter(Boolean).length;
    const baseScore = starCount * 20; // sur 100

    // --- RSI en BONUS (selon ta demande: OB d'abord, RSI en bonus) ---
    const lastRsi = rsi[rsi.length - 1];
    const bias = rsiBias(lastRsi);
    const divergence = detectDivergence(
      candles.map((c) => c.close),
      rsi
    );

    let rsiBonus = 0;
    const rsiNotes = [];
    // Bonus si le RSI confirme la direction de l'OB
    if (direction === "bullish" && bias === "haussier") {
      rsiBonus += 5;
      rsiNotes.push("RSI>50 confirme le biais haussier (+5)");
    }
    if (direction === "bearish" && bias === "baissier") {
      rsiBonus += 5;
      rsiNotes.push("RSI<50 confirme le biais baissier (+5)");
    }
    // Bonus si divergence dans le bon sens
    if (direction === "bullish" && divergence === "bullish") {
      rsiBonus += 5;
      rsiNotes.push("Divergence haussiere (+5)");
    }
    if (direction === "bearish" && divergence === "bearish") {
      rsiBonus += 5;
      rsiNotes.push("Divergence baissiere (+5)");
    }

    const totalScore = Math.min(100, baseScore + rsiBonus);

    results.push({
      ...zone,
      stars,
      starCount,
      baseScore,
      rsiValue: lastRsi != null ? Math.round(lastRsi * 10) / 10 : null,
      rsiBias: bias,
      rsiBonus,
      rsiNotes,
      totalScore,
      trend,
    });
  }

  return results;
}
