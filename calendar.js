// ============================================================
//  CALENDRIER ECONOMIQUE — news a fort impact
//
//  Source : API jBlanked (donnees Forex Factory), gratuite, JSON.
//  On recupere les news USD a fort impact du jour (Fed, CPI,
//  taux, emploi NFP...) car c'est ce qui fait bouger le Bitcoin.
//
//  Deux usages :
//   1. Calendrier du matin -> envoye sur Telegram a 8h
//   2. Fenetre de news -> sert a AVERTIR et baisser le score
//      des alertes pendant les minutes sensibles.
//
//  Approche volontairement PRUDENTE : on ne devine pas le sens
//  de la news (haussier/baissier). On signale juste le danger.
// ============================================================

// Recupere les news a fort impact du jour pour les devises demandees.
// Retourne un tableau d'objets { time(Date), currency, name, impact }.
export async function fetchEconomicCalendar(config) {
  const currencies = config.news?.currencies || ["USD"];
  const url = "https://www.jblanked.com/news/api/forex-factory/calendar/today/";

  const headers = { "Content-Type": "application/json" };
  // Cle API optionnelle (l'usage gratuit fonctionne sans, avec limite).
  if (config.news?.apiKey) {
    headers["Authorization"] = `Api-Key ${config.news.apiKey}`;
  }

  let raw;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    console.error(`  Calendrier eco: echec recuperation -> ${e.message}`);
    return null; // null = on n'a pas pu recuperer (different de "aucune news")
  }

  if (!Array.isArray(raw)) return [];

  const events = [];
  for (const ev of raw) {
    // Les champs varient selon la source ; on lit defensivement.
    const cur = (ev.Currency || ev.currency || ev.economy || "").toUpperCase();
    const impact = (ev.Strength || ev.impact || ev.Impact || "").toString().toLowerCase();
    const name = ev.Name || ev.name || ev.event || "Evenement";
    const dateStr = ev.Date || ev.date || ev.data || ev.time;

    // On ne garde que les devises voulues et le fort impact.
    // On capte large : "high", "3", "fort", "red" (Forex Factory code couleur),
    // et les libelles textuels eventuels.
    if (!currencies.includes(cur)) continue;
    const isHigh =
      impact.includes("high") ||
      impact.includes("fort") ||
      impact.includes("red") ||
      impact === "3" ||
      impact === "high impact expected";
    if (!isHigh) continue;

    const time = dateStr ? new Date(dateStr) : null;
    events.push({ time, currency: cur, name, impact: "High" });
  }

  // Tri par heure
  events.sort((a, b) => (a.time?.getTime() || 0) - (b.time?.getTime() || 0));
  return events;
}

// Verifie si on est dans la fenetre dangereuse d'une news (avant/apres).
// Retourne la news concernee si on est dans la fenetre, sinon null.
export function newsWindowActive(events, now, windowMinutes) {
  if (!events || events.length === 0) return null;
  const win = (windowMinutes || 15) * 60 * 1000;
  const t = now.getTime();
  for (const ev of events) {
    if (!ev.time) continue;
    const diff = Math.abs(t - ev.time.getTime());
    if (diff <= win) return ev;
  }
  return null;
}

// Met en forme le calendrier du matin pour Telegram.
// --- Traduction FR des evenements economiques courants ---
// On remplace les termes anglais par leur equivalent francais.
// Liste des expressions traduites (de la plus longue a la plus courte
// pour eviter les remplacements partiels).
const TRAD_ECO = [
  ["Federal Funds Rate", "Taux directeur de la Fed"],
  ["Fed Interest Rate Decision", "Decision de taux de la Fed"],
  ["Interest Rate Decision", "Decision de taux"],
  ["FOMC Statement", "Communique du FOMC (Fed)"],
  ["FOMC Meeting Minutes", "Minutes de la reunion du FOMC"],
  ["FOMC Press Conference", "Conference de presse du FOMC"],
  ["FOMC Economic Projections", "Projections economiques du FOMC"],
  ["Press Conference", "Conference de presse"],
  ["Non-Farm Employment Change", "Emploi non-agricole (NFP)"],
  ["Non-Farm Payrolls", "Emploi non-agricole (NFP)"],
  ["Unemployment Rate", "Taux de chomage"],
  ["Unemployment Claims", "Inscriptions au chomage"],
  ["Average Hourly Earnings", "Salaire horaire moyen"],
  ["Core CPI", "Inflation sous-jacente core"],
  ["CPI", "Inflation (CPI)"],
  ["Core PCE Price Index", "Indice PCE core (inflation Fed)"],
  ["PCE Price Index", "Indice des prix PCE"],
  ["Core PPI", "Prix a la production core"],
  ["PPI", "Prix a la production (PPI)"],
  ["Retail Sales", "Ventes au detail"],
  ["Core Retail Sales", "Ventes au detail sous-jacentes"],
  ["GDP", "PIB"],
  ["Gross Domestic Product", "PIB"],
  ["ISM Manufacturing PMI", "PMI manufacturier ISM"],
  ["ISM Services PMI", "PMI des services ISM"],
  ["Manufacturing PMI", "PMI manufacturier"],
  ["Services PMI", "PMI des services"],
  ["Consumer Confidence", "Confiance des consommateurs"],
  ["Consumer Sentiment", "Sentiment des consommateurs"],
  ["Building Permits", "Permis de construire"],
  ["Durable Goods Orders", "Commandes de biens durables"],
  ["Trade Balance", "Balance commerciale"],
  ["Crude Oil Inventories", "Stocks de petrole brut"],
  ["Jobless Claims", "Demandes d'allocation chomage"],
  ["JOLTS Job Openings", "Offres d'emploi (JOLTS)"],
  ["Fed Chair", "President de la Fed"],
  ["Treasury", "Tresor americain"],
  ["m/m", "(mensuel)"],
  ["y/y", "(annuel)"],
  ["q/q", "(trimestriel)"],
];

function traduireEvenement(nom) {
  let out = nom;
  for (const [en, fr] of TRAD_ECO) {
    // remplacement insensible a la casse
    const re = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, fr);
  }
  return out;
}

export function formatCalendar(events) {
  if (events === null) {
    return "<b>📅 Calendrier eco du jour</b>\nImpossible de recuperer le calendrier ce matin (source indisponible). Verifie manuellement sur Forex Factory.";
  }
  if (events.length === 0) {
    return "<b>📅 Calendrier eco du jour</b>\nAucune news a fort impact prevue aujourd'hui. Journee plus calme cote fondamental.";
  }
  let msg = "<b>📅 Calendrier economique du jour — fort impact</b>\n\n";
  for (const ev of events) {
    const h = ev.time
      ? ev.time.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        })
      : "??:??";
    msg += `🔴 ${h} — ${ev.currency} — ${traduireEvenement(ev.name)}\n`;
  }
  msg +=
    "\n<i>Regle : pas de trade dans les ~15 min avant/apres ces horaires. Le marche devient imprevisible.</i>";
  return msg;
}
