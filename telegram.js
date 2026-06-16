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

function round(x) {
  if (x >= 1000) return x.toFixed(1);
  if (x >= 1) return x.toFixed(2);
  return x.toFixed(4);
}
