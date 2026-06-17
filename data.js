// ============================================================
//  FOURNISSEURS DE DONNEES
//
//  Bitcoin -> Coinbase (gratuit, public, accepte les serveurs US)
//             Binance est dispo en secours mais bloque les IP US
//             (erreur HTTP 451), donc on utilise Coinbase par defaut.
//
//  Toutes les sources retournent le meme format normalise :
//    { time, open, high, low, close, volume }
// ============================================================

// fetch est integre nativement dans Node 18+, pas besoin de l'importer.

// ---- COINBASE (Bitcoin) ----
// Doc: https://api.exchange.coinbase.com/products/BTC-USD/candles
// Format renvoye : [time(sec), low, high, open, close, volume]
// Granularites possibles (en secondes) : 60, 300, 900, 3600, 21600, 86400
// = 1m, 5m, 15m, 1h, 6h, 1j. Pas de 4h -> on mappe 4h vers 6h.
const CB_GRANULARITY = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 21600, // Coinbase n'a pas de 4h : on prend le 6h (proche, ok en swing)
  "6h": 21600,
  "1d": 86400,
};

export async function fetchCoinbase(productId, interval, limit) {
  const gran = CB_GRANULARITY[interval];
  if (!gran) throw new Error(`Coinbase: timeframe non supporte ${interval}`);

  // Coinbase renvoie au max 300 bougies, les plus recentes en premier.
  const url = `https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${gran}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ob-scanner/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Coinbase ${productId} ${interval}: HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Coinbase ${productId}: reponse inattendue`);

  // On normalise et on remet dans l'ordre chronologique (ancien -> recent)
  const candles = raw
    .map((k) => ({
      time: k[0] * 1000, // secondes -> millisecondes
      low: parseFloat(k[1]),
      high: parseFloat(k[2]),
      open: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }))
    .sort((a, b) => a.time - b.time);

  // On respecte la limite demandee (en gardant les plus recentes)
  return limit && candles.length > limit ? candles.slice(-limit) : candles;
}

// ---- BINANCE (secours, bloque sur serveurs US -> HTTP 451) ----
export async function fetchBinance(symbol, interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${symbol} ${interval}: HTTP ${res.status}`);
  const raw = await res.json();
  return raw.map((k) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ---- TWELVE DATA (autres actifs, cle requise) ----
const TD_INTERVAL = { "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day" };

export async function fetchTwelveData(symbol, interval, limit, apiKey) {
  const tdInterval = TD_INTERVAL[interval] || interval;
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${tdInterval}&outputsize=${limit}&apikey=${apiKey}&order=ASC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData ${symbol} ${interval}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "error") throw new Error(`TwelveData: ${data.message}`);
  if (!data.values) return [];
  return data.values.map((v) => ({
    time: new Date(v.datetime).getTime(),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume || 0),
  }));
}

// ---- Dispatcher ----
export async function fetchCandles(asset, interval, limit, config) {
  if (asset.source === "coinbase") {
    return fetchCoinbase(asset.symbol, interval, limit);
  }
  if (asset.source === "binance") {
    return fetchBinance(asset.symbol, interval, limit);
  }
  if (asset.source === "twelvedata") {
    return fetchTwelveData(asset.symbol, interval, limit, config.twelveData.apiKey);
  }
  throw new Error(`Source inconnue: ${asset.source}`);
}
