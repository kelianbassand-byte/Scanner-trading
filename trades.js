// ============================================================
//  SUIVI DES TRADES — notifications TP1 / TP2 / TP3 / SL
//
//  Quand une alerte order block sort, on "ouvre" un trade virtuel
//  et on le suit a chaque scan :
//   - Tant qu'on est entre l'entree et le SL : SILENCE (pas de notif)
//   - Le marche touche TP1 -> notif + on remonte le SL au point d'entree
//   - Le marche touche TP2 -> notif
//   - Le marche touche TP3 -> notif + trade termine
//   - Le marche touche le SL -> notif + trade termine
//
//  ATTENTION : les trades sont gardes en MEMOIRE. Si Railway
//  redemarre (redeploiement, maintenance), les trades en cours
//  sont oublies. C'est une limite connue.
// ============================================================

// Map des trades ouverts. Cle = identifiant unique du trade.
const openTrades = new Map();

// Cree un trade a partir d'un signal (order block V, divergence, ou triangle).
// La "technique" fait partie de l'identite : on peut avoir 2 trades sur le
// meme actif/timeframe SI ce sont des techniques differentes.
export function openTrade(asset, timeframe, signal) {
  const technique = signal.technique || "ob";
  const id = `${asset.name}|${timeframe}|${technique}|${signal.index}|${signal.entry.toFixed(2)}`;
  if (openTrades.has(id)) return null; // deja suivi

  const trade = {
    id,
    technique,
    assetName: asset.name,
    timeframe,
    direction: signal.direction, // "bullish" / "bearish"
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    originalStopLoss: signal.stopLoss,
    tp1: signal.takeProfits.tp1,
    tp2: signal.takeProfits.tp2,
    tp3: signal.takeProfits.tp3,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    slMovedToEntry: false,
    openedAt: Date.now(),
  };
  openTrades.set(id, trade);
  return trade;
}

// Anti-doublon : y a-t-il deja un trade ouvert sur ce meme
// actif + timeframe + technique ? Si oui, on ne relance pas (on attend le SL).
export function hasOpenTrade(assetName, timeframe, technique) {
  for (const trade of openTrades.values()) {
    if (
      trade.assetName === assetName &&
      trade.timeframe === timeframe &&
      trade.technique === technique
    ) {
      return true;
    }
  }
  return false;
}

// Verifie un trade contre la derniere bougie (prix haut/bas atteint).
// Retourne un tableau d'evenements a notifier : ["TP1","SL",...].
// moveSlToEntry : si true, on remonte le SL a l'entree quand TP1 touche.
export function checkTrade(trade, candle, moveSlToEntry) {
  const events = [];
  const hi = candle.high;
  const lo = candle.low;

  if (trade.direction === "bullish") {
    // SL d'abord (prudence : on suppose le pire si la bougie touche les deux)
    if (lo <= trade.stopLoss) {
      events.push("SL");
      return { events, closed: true };
    }
    if (!trade.tp1Hit && hi >= trade.tp1) {
      trade.tp1Hit = true;
      events.push("TP1");
      if (moveSlToEntry && !trade.slMovedToEntry) {
        trade.stopLoss = trade.entry;
        trade.slMovedToEntry = true;
      }
    }
    if (!trade.tp2Hit && hi >= trade.tp2) {
      trade.tp2Hit = true;
      events.push("TP2");
    }
    if (!trade.tp3Hit && hi >= trade.tp3) {
      trade.tp3Hit = true;
      events.push("TP3");
      return { events, closed: true };
    }
  } else {
    // direction baissiere (vente)
    if (hi >= trade.stopLoss) {
      events.push("SL");
      return { events, closed: true };
    }
    if (!trade.tp1Hit && lo <= trade.tp1) {
      trade.tp1Hit = true;
      events.push("TP1");
      if (moveSlToEntry && !trade.slMovedToEntry) {
        trade.stopLoss = trade.entry;
        trade.slMovedToEntry = true;
      }
    }
    if (!trade.tp2Hit && lo <= trade.tp2) {
      trade.tp2Hit = true;
      events.push("TP2");
    }
    if (!trade.tp3Hit && lo <= trade.tp3) {
      trade.tp3Hit = true;
      events.push("TP3");
      return { events, closed: true };
    }
  }
  return { events, closed: false };
}

// Parcourt tous les trades ouverts d'un actif/timeframe avec la derniere bougie.
// Retourne la liste { trade, events } a notifier, et nettoie les trades fermes.
export function updateTradesFor(assetName, timeframe, candle, moveSlToEntry) {
  const toNotify = [];
  for (const trade of openTrades.values()) {
    if (trade.assetName !== assetName || trade.timeframe !== timeframe) continue;
    const { events, closed } = checkTrade(trade, candle, moveSlToEntry);
    if (events.length > 0) toNotify.push({ trade, events });
    if (closed) openTrades.delete(trade.id);
  }
  return toNotify;
}

export function countOpenTrades() {
  return openTrades.size;
}
