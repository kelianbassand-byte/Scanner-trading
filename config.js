// ============================================================
//  CONFIGURATION
//  Tout ce qui se regle est ici. Pas besoin de toucher au reste.
// ============================================================

export const config = {
  // --- Telegram ---
  // 1) Cree un bot via @BotFather sur Telegram -> il te donne un TOKEN
  // 2) Ecris un message a ton bot, puis recupere ton chatId
  //    (voir README, section Telegram)
  telegram: {
    token: process.env.TELEGRAM_TOKEN || "TON_TOKEN_ICI",
    chatId: process.env.TELEGRAM_CHAT_ID || "TON_CHAT_ID_ICI",
  },

  // --- Twelve Data (pour l'OR / XAUUSD) ---
  // Inscription gratuite sur https://twelvedata.com -> cle API gratuite
  twelveData: {
    apiKey: process.env.TWELVEDATA_KEY || "TA_CLE_TWELVEDATA",
  },

  // --- Quels actifs scanner ---
  // source: "binance" ou "twelvedata"
  // L'or (XAUUSD) est desactive car les donnees gratuites sont en retard.
  // On garde le Bitcoin seul (Binance = temps reel fiable).
  assets: [
    { name: "BTCUSD", source: "binance", symbol: "BTCUSDT" },
  ],

  // --- Timeframes a scanner (plusieurs a la fois) ---
  // Format Binance: 5m, 15m, 1h | Format TwelveData gere automatiquement
  timeframes: ["5m", "15m", "1h"],

  // --- Combien de bougies on recupere pour l'analyse ---
  candleLimit: 200,

  // --- Frequence du scan complet (en secondes) ---
  scanIntervalSec: 60,

  // --- Reglages de detection ---
  detection: {
    // Mouvement "violent" = bougie d'impulsion dont le corps est au moins
    // X fois la moyenne des corps recents. Plus c'est haut, plus c'est strict.
    impulseBodyMultiple: 1.8,

    // Combien de bougies l'impulsion doit durer au minimum pour compter
    minImpulseCandles: 1,

    // RSI
    rsiPeriod: 14,

    // Score minimum (sur 100) pour declencher une alerte
    minScoreToAlert: 70,

    // On evite de re-alerter le meme order block en boucle
    alertCooldownMin: 60,
  },
};
