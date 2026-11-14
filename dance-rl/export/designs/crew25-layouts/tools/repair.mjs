// node repair.mjs V MODE [target]: push the closest pair's slots apart until every pair of hips paths (paths_local.json,
// the lab's own track) stays >= target over the whole song; rewrites out/V-MODE.txt
import fs from 'fs';
const [v, mode, tA] = process.argv.slice(2);
const target = Number(tA || 0.76);
const f = new URL(`./out/${v}-${mode}.txt`, import.meta.url);
const lines = fs.readFileSync(f, 'utf8').split('\n');
let S = JSON.parse(lines.find((l) => l.startsWith('TABLE')).slice(6));
const LP = JSON.parse(fs.readFileSync(new URL('./paths_local.json', import.meta.url)));
const n = S.length;
const gap = (S) => { const pos = S.map(([x, z, yaw], i) => { const c = Math.cos(yaw * Math.PI / 180), s = Math.sin(yaw * Math.PI / 180); return LP[i].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]); });
  let g = Infinity, at = null; for (let k = 0; k < pos[0].length; k++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = Math.hypot(pos[i][k][0] - pos[j][k][0], pos[i][k][1] - pos[j][k][1]); if (d < g) { g = d; at = [i, j, k]; } } return { g, at }; };
let m = gap(S); const g0 = m.g; let it = 0;
const side = (k, x) => k === 0 || (k % 2 ? x > 0.1 : x < -0.1);
while (m.g < target && it < 400) {
  const [i, j] = m.at; const a = S[i], b = S[j];
  let dx = b[0] - a[0], dz = b[1] - a[1]; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const st = 0.025;
  const leadOK = (T) => Math.min(...T.slice(1).map((s) => Math.hypot(s[0] - T[0][0], s[1] - T[0][1]))) <= 1.6;
  const T = S.map((s) => [...s]);
  if (i !== 0 && side(i, a[0] - dx * st)) { T[i][0] -= dx * st; T[i][1] -= dz * st; }
  if (j !== 0 && side(j, b[0] + dx * st)) { T[j][0] += dx * st; T[j][1] += dz * st; }
  if (!leadOK(T)) { // move only the non-neighbour of the lead
    T[i] = [...S[i]]; if (j !== 0 && side(j, b[0] + dx * 2 * st)) { T[j][0] = b[0] + dx * 2 * st; T[j][1] = b[1] + dz * 2 * st; }
  }
  S = T.map(([x, z, y, s]) => [+x.toFixed(3), +z.toFixed(3), y, s]); m = gap(S); it++;
}
console.log(JSON.stringify({ v, mode, before: +g0.toFixed(3), after: +m.g.toFixed(3), at: [m.at[0], m.at[1], +(8.37 + m.at[2] / 10).toFixed(1)], steps: it }));
fs.writeFileSync(f, lines.map((l) => (l.startsWith('TABLE') ? `TABLE ${JSON.stringify(S)}` : l)).join('\n'));
