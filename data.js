// ============================================================
//  FOURNISSEURS DE DONNEES
//
//  Bitcoin -> Binance (gratuit, public, fiable)
//  Or (XAUUSD) -> Twelve Data (cle gratuite requise)
//
//  IMPORTANT : TradingView ne propose pas d'API publique pour
//  recuperer les bougies dans un programme. On utilise donc ces
//  sources qui donnent les MEMES donnees de marche.
//
//  Les deux retournent le meme format normalise :
//    { time, open, high, low, close, volume }
// ============================================================

// fetch est integre nativement dans Node 18+, pas besoin de l'importer.

// ---- BINANCE (Bitcoin) ----
// Doc: https://api.binance.com/api/v3/klines
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

// ---- TWELVE DATA (Or / XAUUSD) ----
// Convertit nos timeframes (5m,15m,1h) vers le format Twelve Data.
const TD_INTERVAL = { "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day" };

export async function fetchTwelveData(symbol, interval, limit, apiKey) {
  const tdInterval = TD_INTERVAL[interval] || interval;
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${tdInterval}&outputsize=${limit}&apikey=${apiKey}&order=ASC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData ${symbol} ${interval}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "error") {
    throw new Error(`TwelveData: ${data.message}`);
  }
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
  if (asset.source === "binance") {
    return fetchBinance(asset.symbol, interval, limit);
  }
  if (asset.source === "twelvedata") {
    return fetchTwelveData(asset.symbol, interval, limit, config.twelveData.apiKey);
  }
  throw new Error(`Source inconnue: ${asset.source}`);
}
