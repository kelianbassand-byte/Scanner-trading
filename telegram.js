// ============================================================
//  ALERTES TELEGRAM
//
//  Pour configurer :
//   1. Sur Telegram, cherche @BotFather -> /newbot -> recupere le TOKEN
//   2. Ecris un message a ton nouveau bot
//   3. Ouvre dans un navigateur :
//      https://api.telegram.org/bot<TON_TOKEN>/getUpdates
//      -> tu y trouveras ton "chat":{"id": ...} = ton chatId
//   4. Mets TOKEN et chatId dans config.js (ou en variables d'env)
// ============================================================

// fetch est integre nativement dans Node 18+, pas besoin de l'importer.

export async function sendTelegram(config, message) {
  const { token, chatId } = config.telegram;
  if (!token || token === "TON_TOKEN_ICI") {
    console.log("[Telegram non configure] Message qui aurait ete envoye :\n" + message);
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("Erreur Telegram:", res.status, txt);
    }
  } catch (e) {
    console.error("Echec envoi Telegram:", e.message);
  }
}

// Met en forme un signal en joli message.
export function formatSignal(assetName, timeframe, signal) {
  const dir = signal.direction === "bullish" ? "🟢 ACHAT (OB haussier)" : "🔴 VENTE (OB baissier)";
  const starsLine = [
    signal.stars.imbalance ? "✅" : "❌",
    signal.stars.tendance ? "✅" : "❌",
    signal.stars.nonMitige ? "✅" : "❌",
    signal.stars.liquidite ? "✅" : "❌",
    signal.stars.sessionVolatile ? "✅" : "❌",
  ];

  return (
    `<b>⚡ SIGNAL ${assetName} — ${timeframe}</b>\n` +
    `${dir}\n` +
    `<b>Score: ${signal.totalScore}/100</b> (${signal.starCount}/5 etoiles + RSI)\n\n` +
    `Zone OB: ${round(signal.bottom)} → ${round(signal.top)}\n\n` +
    `<b>Les 5 etoiles:</b>\n` +
    `${starsLine[0]} Imbalance\n` +
    `${starsLine[1]} Tendance (${signal.trend})\n` +
    `${starsLine[2]} Non mitige\n` +
    `${starsLine[3]} Prise de liquidite\n` +
    `${starsLine[4]} Session volatile\n\n` +
    `<b>RSI:</b> ${signal.rsiValue ?? "?"} (${signal.rsiBias}, zone ${signal.rsiZone}) — bonus +${signal.rsiBonus}\n` +
    (signal.rsiNotes.length ? signal.rsiNotes.map((n) => "• " + n).join("\n") + "\n" : "") +
    `\n<b>📍 Niveaux de trade</b>\n` +
    `Entree : ${round(signal.entry)}\n` +
    `🛑 Stop Loss : ${round(signal.stopLoss)}\n` +
    `🎯 TP1 (1x) : ${round(signal.takeProfits.tp1)}\n` +
    `🎯 TP2 (2x) : ${round(signal.takeProfits.tp2)}\n` +
    `🎯 TP3 (3x) : ${round(signal.takeProfits.tp3)}\n` +
    `Risque : ${round(signal.risk)} points\n` +
    `\n<i>Ceci est une aide a la decision, pas un ordre. Verifie sur ton graphique et ne risque que ce que tu peux te permettre de perdre.</i>`
  );
}

// Met en forme une alerte Order Block V / V inverse.
export function formatOrderBlockV(assetName, timeframe, ob) {
  const dir =
    ob.direction === "bullish"
      ? "🟢 ACHAT (Order Block haussier — creux en V)"
      : "🔴 VENTE (Order Block baissier — pic en V inverse)";
  return (
    `📦 <b>ORDER BLOCK ${assetName} — ${timeframe}</b>\n` +
    `${dir}\n` +
    `✅ Dans le sens de la tendance de fond\n\n` +
    `Zone OB : ${round(ob.zoneBottom)} → ${round(ob.zoneTop)}\n\n` +
    `<b>📍 Niveaux</b>\n` +
    `Entree : ${round(ob.entry)}\n` +
    `🛑 SL : ${round(ob.stopLoss)}\n` +
    `🎯 TP1 : ${round(ob.takeProfits.tp1)} | TP2 : ${round(ob.takeProfits.tp2)} | TP3 : ${round(ob.takeProfits.tp3)}\n\n` +
    `<i>Le V est confirme. Aide a la decision, pas un ordre — verifie sur ton graphique.</i>`
  );
}

// Met en forme une alerte de divergence RSI confirmee par MACD Zero Lag.
export function formatDivergence(assetName, timeframe, div) {
  const dir =
    div.direction === "bullish"
      ? "🟢 ACHAT (divergence haussiere)"
      : "🔴 VENTE (divergence baissiere)";
  return (
    `📈 <b>DIVERGENCE RSI ${assetName} — ${timeframe}</b>\n` +
    `${dir}\n` +
    `✅ Confirmee par MACD Zero Lag\n` +
    `RSI actuel : ${div.rsiNow != null ? div.rsiNow.toFixed(1) : "?"}\n\n` +
    `<b>📍 Niveaux</b>\n` +
    `Entree : ${round(div.entry)}\n` +
    `🛑 SL : ${round(div.stopLoss)}\n` +
    `🎯 TP1 : ${round(div.takeProfits.tp1)} | TP2 : ${round(div.takeProfits.tp2)} | TP3 : ${round(div.takeProfits.tp3)}\n\n` +
    `<i>Divergence + confirmation MACD ZL. Aide a la decision — verifie sur ton graphique.</i>`
  );
}

// Met en forme une alerte de cassure de ligne de tendance.
export function formatTrendline(assetName, timeframe, tl) {
  const dir =
    tl.direction === "bullish"
      ? "🟢 ACHAT (cassure haussiere d'une resistance oblique)"
      : "🔴 VENTE (cassure baissiere d'un support oblique)";
  return (
    `📐 <b>LIGNE DE TENDANCE ${assetName} — ${timeframe}</b>\n` +
    `${dir}\n` +
    `Ligne validee par ${tl.touches} points de contact\n` +
    `✅ Dans le sens de la tendance de fond\n\n` +
    `<b>📍 Niveaux</b>\n` +
    `Entree : ${round(tl.entry)}\n` +
    `🛑 SL : ${round(tl.stopLoss)}\n` +
    `🎯 TP1 : ${round(tl.takeProfits.tp1)} | TP2 : ${round(tl.takeProfits.tp2)} | TP3 : ${round(tl.takeProfits.tp3)}\n\n` +
    `<i>Cassure validee par une vraie bougie. Aide a la decision — verifie sur ton graphique.</i>`
  );
}

function round(x) {
  if (x >= 1000) return x.toFixed(1);
  if (x >= 1) return x.toFixed(2);
  return x.toFixed(4);
}

// Notification de suivi de trade (TP1 / TP2 / TP3 / SL touche).
export function formatTradeEvent(trade, event) {
  const sens = trade.direction === "bullish" ? "ACHAT" : "VENTE";
  const head = `${trade.assetName} — ${trade.timeframe} (${sens})`;

  if (event === "TP1") {
    const be = trade.slMovedToEntry
      ? `\n🔒 Stop Loss remonte au point d'entree (${round(trade.entry)}). Trade securise, plus de risque.`
      : "";
    return (
      `🎯 <b>TP1 ATTEINT — ${head}</b>\n` +
      `Prix entree : ${round(trade.entry)}\n` +
      `TP1 : ${round(trade.tp1)} ✅${be}\n\n` +
      `Prochains objectifs : TP2 ${round(trade.tp2)} | TP3 ${round(trade.tp3)}`
    );
  }
  if (event === "TP2") {
    return (
      `🎯🎯 <b>TP2 ATTEINT — ${head}</b>\n` +
      `TP2 : ${round(trade.tp2)} ✅\n\n` +
      `Dernier objectif : TP3 ${round(trade.tp3)}`
    );
  }
  if (event === "TP3") {
    return (
      `🏆 <b>TP3 ATTEINT — ${head}</b>\n` +
      `TP3 : ${round(trade.tp3)} ✅\n` +
      `Trade termine. Beau move !`
    );
  }
  if (event === "SL") {
    const atEntry = trade.slMovedToEntry;
    return (
      `🛑 <b>STOP LOSS TOUCHE — ${head}</b>\n` +
      `SL : ${round(trade.stopLoss)}\n` +
      (atEntry
        ? `Le SL etait au point d'entree : trade ferme a l'equilibre (0 perte).`
        : `Trade ferme en perte. Ca arrive, le capital est protege.`)
    );
  }
  return `Evenement ${event} sur ${head}`;
}

// Met en forme une alerte de cassure de triangle/biseau.
export function formatTriangle(assetName, timeframe, tri) {
  const dir =
    tri.breakout === "bullish"
      ? "🟢 CASSURE HAUSSIERE (achat)"
      : "🔴 CASSURE BAISSIERE (vente)";
  const trendLine = tri.trendOk
    ? "✅ Dans le sens de la tendance (EMA200)"
    : `⚠️ ${tri.trendNote}`;

  return (
    `<b>📐 TRIANGLE/BISEAU ${assetName} — ${timeframe}</b>\n` +
    `${dir}\n` +
    `Figure : ${tri.type}\n` +
    `${trendLine}\n\n` +
    `Zone figure : ${round(tri.figureBottom)} → ${round(tri.figureTop)}\n\n` +
    `<b>📍 Niveaux de trade</b>\n` +
    `Entree : ${round(tri.entry)}\n` +
    `🛑 Stop Loss : ${round(tri.stopLoss)}\n` +
    `🎯 Take Profit : ${round(tri.takeProfit)}\n` +
    `Risque : ${round(tri.risk)} points\n\n` +
    `<i>Cassure validee par une vraie bougie. Aide a la decision, pas un ordre — verifie sur ton graphique.</i>`
  );
}
