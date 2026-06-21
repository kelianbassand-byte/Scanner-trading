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
  // source: "coinbase" (defaut, marche sur serveurs US), "binance" ou "twelvedata"
  // L'or (XAUUSD) est desactive car les donnees gratuites sont en retard.
  // On garde le Bitcoin seul (Binance = temps reel fiable).
  assets: [
    { name: "BTCUSD", source: "coinbase", symbol: "BTC-USD", minTp1Distance: 300 },
  ],

  // --- Timeframes a scanner (15 min minimum, jamais en dessous) ---
  // Utilises pour order blocks V/V et divergences RSI.
  timeframes: ["15m", "1h", "4h"],

  // --- Timeframes pour les TRIANGLES (gros mouvements seulement) ---
  // 6h et journalier. Note : Coinbase n'a pas de vrai 4h (sa granularite
  // au-dessus de 1h est directement 6h), donc 6h couvre le "4h/6h".
  triangleTimeframes: ["6h", "1d"],

  // --- Timeframes pour les LIGNES DE TENDANCE ---
  // Faustin conseille 1h minimum (2h/daily ideal). 15m trop fragile.
  trendlineTimeframes: ["1h", "4h"],

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

  // --- Grille Stop Loss / Take Profit (en % du prix d'entree) ---
  // Meme logique pour BTC et ETH. SL serre, TP1 souvent touche.
  tradeLevels: {
    slPct: 0.5, // Stop Loss a -0,5%
    tp1Pct: 0.75, // TP1 a +0,75% (~1,5R) — accessible, souvent touche
    tp2Pct: 1.5, // TP2 a +1,5% (~3R)
    tp3Pct: 3.0, // TP3 a +3% (~6R)
    // Quand TP1 est touche, on remonte le SL au point d'entree (break-even).
    moveSlToEntryAtTp1: true,
  },

  // --- Calendrier economique / news ---
  news: {
    // Devises a surveiller. Pour le Bitcoin, le USD est le moteur principal
    // (Fed, CPI, taux, emploi). On peut ajouter "EUR" si besoin.
    currencies: ["USD"],

    // Cle API jBlanked (optionnelle). Laisse vide pour l'usage gratuit.
    apiKey: process.env.NEWS_API_KEY || "",

    // Fenetre de danger autour de chaque news (en minutes, avant ET apres).
    // Pendant cette fenetre : avertissement + score reduit.
    windowMinutes: 15,

    // De combien on baisse le score d'une alerte OB pendant la fenetre de news.
    scorePenalty: 25,

    // Heure d'envoi du calendrier du matin (heure de Paris, format 24h).
    morningHour: 8,
    morningMinute: 0,
  },
};
