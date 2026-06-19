// ============================================================
//  CONFIRMATION — bougie complete avec corps net (pas un doji)
//
//  Utilise par les 4 techniques avant d'alerter : on exige que la
//  derniere bougie cloturee ait un VRAI corps (la "bougie de A a Z"
//  des videos), et qu'elle cloture du bon cote du niveau.
//
//  Un doji (corps minuscule) = indecision -> on n'alerte pas.
// ============================================================

// La bougie a-t-elle un corps net ? (corps >= ratio du range total)
export function hasSolidBody(candle, minBodyRatio = 0.5) {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range <= 0) return false;
  return body / range >= minBodyRatio;
}

// Bougie haussiere nette qui cloture AU-DESSUS d'un niveau.
export function confirmsAbove(candle, level, minBodyRatio = 0.5) {
  return (
    candle.close > level &&
    candle.close > candle.open && // bougie verte
    hasSolidBody(candle, minBodyRatio)
  );
}

// Bougie baissiere nette qui cloture EN-DESSOUS d'un niveau.
export function confirmsBelow(candle, level, minBodyRatio = 0.5) {
  return (
    candle.close < level &&
    candle.close < candle.open && // bougie rouge
    hasSolidBody(candle, minBodyRatio)
  );
}
