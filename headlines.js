// ============================================================
//  GROS TITRES ACTU USA — contexte geopolitique / macro
//
//  Source : saurav.tech/NewsAPI (miroir gratuit de NewsAPI, SANS CLE).
//  On recupere les principaux titres "business" des USA, car c'est
//  la categorie la plus pertinente pour le Bitcoin (Fed, marches,
//  crises, decisions economiques). Le trader juge lui-meme l'impact.
//
//  C'est une AIDE AU CONTEXTE, pas un signal de trading.
//  Le bot ne sait pas si un titre va faire monter ou baisser le BTC.
// ============================================================

// Recupere les gros titres business des USA. Retourne un tableau de
// { title, source } ou null si echec.
export async function fetchUsHeadlines(maxItems = 6) {
  const url = "https://saurav.tech/NewsAPI/top-headlines/category/business/us.json";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ob-scanner/1.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.articles)) return [];

    const titles = [];
    for (const art of data.articles) {
      const title = (art.title || "").trim();
      if (!title) continue;
      const source = art.source && art.source.name ? art.source.name : "";
      titles.push({ title, source });
      if (titles.length >= maxItems) break;
    }
    return titles;
  } catch (e) {
    console.error(`  Gros titres USA: echec -> ${e.message}`);
    return null;
  }
}

// Met en forme les gros titres pour Telegram.
export function formatHeadlines(headlines) {
  if (headlines === null) {
    return "<b>📰 Gros titres USA</b>\nImpossible de recuperer les titres ce matin (source indisponible).";
  }
  if (headlines.length === 0) {
    return "<b>📰 Gros titres USA</b>\nAucun titre recupere ce matin.";
  }
  let msg = "<b>📰 Gros titres USA — contexte du jour</b>\n\n";
  for (const h of headlines) {
    const src = h.source ? ` <i>(${h.source})</i>` : "";
    msg += `• ${h.title}${src}\n`;
  }
  msg +=
    "\n<i>Contexte geopolitique/macro a surveiller (Fed, conflits, crises...). A toi de juger l'impact sur le BTC.</i>";
  return msg;
}
