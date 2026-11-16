// riktpris.js – riktpriset (Joakim 2026-11-16): priset där varorna faktiskt ligger. De billigaste stegen räknas bort när de
// är en liten klump långt under nästa pris: högst 2 % av allt ute och nästa steg minst 30 % dyrare, eller högst 10 % och
// nästa steg minst dubbelt så dyrt ("10 läder för 2s när resten ligger på 8s"). Används av build.js (sidan) och
// hamta-blizzard.js (timhämtningen), så båda räknar likadant. Gear (inte stapelbart) får inget riktpris: där är billigaste
// priset priset, och skillnader i guld är vanliga.
const RIKT = [[1 / 1.3, 0.02], [0.5, 0.10]];   // [klumpens dyraste högst så här mycket av nästa steg, klumpen högst så stor andel]
function riktOf(steg, total) {
  if (!steg || !steg.length) return null;
  const sum = steg.reduce((a, x) => a + x[1], 0);
  total = Math.max(total || 0, sum, 1);
  let best = 0, cum = 0;
  for (let k = 1; k < steg.length; k++) {
    cum += steg[k - 1][1];
    const share = cum / total;
    if (share > RIKT[RIKT.length - 1][1]) break;
    const ratio = steg[k - 1][0] / steg[k][0];
    if (RIKT.some(([r, sh]) => ratio <= r && share <= sh)) best = k;
  }
  let drop = 0;
  for (let k = 0; k < best; k++) drop += steg[k][1];
  return { price: steg[best][0], drop, low: steg[0][0] };
}
module.exports = { riktOf, RIKT };
