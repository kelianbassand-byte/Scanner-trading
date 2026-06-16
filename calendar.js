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

    // On ne garde que les devises voulues et le fort impact
    if (!currencies.includes(cur)) continue;
    const isHigh = impact.includes("high") || impact === "3" || impact.includes("fort");
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
export function formatCalendar(events) {
  if (events === null) {
    return "<b>📅 Calendrier eco du jour</b>\nImpossible de recuperer le calendrier ce matin (source indisponible). Verifie manuellement sur Forex Factory.";
  }
  if (events.length === 0) {
    return "<b>📅 Calendrier eco du jour</b>\nAucune news a fort impact prevue aujourd'hui. Journee plus calme cote fondamental.";
  }
  let msg = "<b>📅 Calendrier eco du jour — fort impact</b>\n\n";
  for (const ev of events) {
    const h = ev.time
      ? ev.time.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        })
      : "??:??";
    msg += `🔴 ${h} — ${ev.currency} — ${ev.name}\n`;
  }
  msg +=
    "\n<i>Regle : pas de trade dans les ~15 min avant/apres ces horaires. Le marche devient imprevisible (sweeps artificiels, spreads larges).</i>";
  return msg;
}
