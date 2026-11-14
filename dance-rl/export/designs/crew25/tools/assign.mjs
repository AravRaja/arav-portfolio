// Assign dancers (looks + recipes) to optimised slots, add facings, check spacing over the whole song.
// node assign.mjs SLOTFILE mode(desktop|phone) n seed elev dist  -> prints the table
import fs from 'fs';
const R = '/Users/aravraja/arav-portfolio';
const [file, mode, nArg, seedArg, elA, distA] = process.argv.slice(2);
const n = Number(nArg);
const { generateCrew } = await import(R + '/src/dance/looks.js');
const looks = generateCrew(7, 25).slice(0, n);
const txt = fs.readFileSync(file, 'utf8');
const slots = JSON.parse(txt.split('\n').find((l) => l.startsWith('SLOTS')).slice(6));
const paths = JSON.parse(fs.readFileSync(new URL('./paths.json', import.meta.url)));
const K = looks.map((l) => l.height * (l.body === 'f' ? Number(process.env.KF || 1.0533) : Number(process.env.KM || 1.0533)));
let seed = Number(seedArg) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cx = slots.reduce((a, s) => a + s[0], 0) / n;
// centre the crew on x = 0 (the camera looks at the slots' mean anyway)
for (const s of slots) s[0] -= cx;
const lead = slots.reduce((b, s, i) => (s[1] > slots[b][1] ? i : b), 0);
const right = slots.map((s, i) => i).filter((i) => i !== lead && slots[i][0] > 0).sort((a, b) => slots[a][0] - slots[b][0]);
const left = slots.map((s, i) => i).filter((i) => i !== lead && slots[i][0] <= 0);
const odd = looks.map((_, i) => i).filter((i) => i % 2 === 1), even = looks.map((_, i) => i).filter((i) => i > 0 && i % 2 === 0);
// balance sides if needed: move the most central slots across
while (right.length > odd.length) { right.sort((a, b) => slots[a][0] - slots[b][0]); left.push(right.shift()); }
while (left.length > even.length) { left.sort((a, b) => slots[b][0] - slots[a][0]); right.push(left.shift()); }
const cls = (i) => (i === 0 ? 'L' : `${(Math.ceil(i / 2) - 1) % 4}${i % 2}`);
const key = (i) => `${looks[i].template}:${looks[i].outfit.top}`;
const NB = mode === 'phone' ? 1.45 : 1.75;
function cost(asg) { // asg[i] = slot index for dancer i
  let c = 0;
  const P = asg.map((s) => slots[s]);
  const nearest = P.map((p, i) => P.map((q, j) => [Math.hypot(p[0] - q[0], p[1] - q[1]), j]).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]).slice(0, 3));
  for (let i = 0; i < n; i++) for (const [d, j] of nearest[i]) {
    if (j < i) continue;
    const nb = d < NB || nearest[i][0][1] === j || nearest[j][0][1] === i;
    if (!nb) continue;
    if (key(i) === key(j)) c += 100;
    if (cls(i) === cls(j)) c += 25;
    if (looks[i].hairStyle === looks[j].hairStyle) c += 3;
    if (looks[i].outfit.top === looks[j].outfit.top) c += 4;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    if (looks[i].template === 'allblack' && looks[j].template === 'allblack' && d < 3) c += 150;
    if (key(i) === key(j) && d < 2.4) c += 30;
  }
  for (let k = 1; 2 * k <= n - 1; k++) { const a = P[2 * k - 1], b = P[2 * k]; c += 2 * (Math.abs(a[0] + b[0]) + Math.abs(a[1] - b[1])); }
  return c;
}
let asg = new Array(n);
asg[0] = lead;
const r0 = [...right].sort(() => rnd() - 0.5), l0 = [...left].sort(() => rnd() - 0.5);
odd.forEach((i, k) => { asg[i] = r0[k]; }); even.forEach((i, k) => { asg[i] = l0[k]; });
let cc = cost(asg), best = [...asg], bc = cc;
for (let it = 0; it < 40000; it++) {
  const T = 20 * (1 - it / 40000) + 0.05;
  const grp = rnd() < 0.5 ? odd : even;
  const a = grp[Math.floor(rnd() * grp.length)], b = grp[Math.floor(rnd() * grp.length)];
  if (a === b) continue;
  const nx = [...asg]; [nx[a], nx[b]] = [nx[b], nx[a]];
  const c = cost(nx);
  if (c < cc || rnd() < Math.exp((cc - c) / T)) { asg = nx; cc = c; if (c < bc) { bc = c; best = [...nx]; } }
}
asg = best;
// facings: towards the camera, outer dancers turned in a bit more, seeded jitter, within +-35 deg
const el = (Number(elA) * Math.PI) / 180, dist = Number(distA);
const czm = slots.reduce((a, s) => a + s[1], 0) / n;
const camZ = czm + dist * Math.cos(el);
const out = asg.map((s, i) => {
  const [x, z] = slots[s];
  const face = (Math.atan2(-x, camZ - z) * 180) / Math.PI;
  let yaw = face * 1.35 + (rnd() - 0.5) * 22;
  if (i === 0) yaw = 6;
  yaw = Math.max(-35, Math.min(35, Math.round(yaw)));
  return [+x.toFixed(3), +z.toFixed(3), yaw, 1];
});
// spacing over the song: root = slot + Ry(yaw) * K * (mj y, mj x), 10 Hz from the drop
let minGap = Infinity, at = null;
const T = paths[0].length;
const pos = out.map(([x, z, yaw], i) => { const c = Math.cos((yaw * Math.PI) / 180), s = Math.sin((yaw * Math.PI) / 180);
  return paths[i].map(([mx, my]) => { const lx = K[i] * my, lz = K[i] * mx; return [x + c * lx + s * lz, z - s * lx + c * lz]; }); });
for (let k = 0; k < T; k++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const d = Math.hypot(pos[i][k][0] - pos[j][k][0], pos[i][k][1] - pos[j][k][1]);
  if (d < minGap) { minGap = d; at = [i, j, +(8.37 + k * 0.1).toFixed(1)]; }
}
let slotMin = Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slotMin = Math.min(slotMin, Math.hypot(out[i][0] - out[j][0], out[i][1] - out[j][1]));
console.log(JSON.stringify({ cost: bc, minGap: +minGap.toFixed(3), at, slotMin: +slotMin.toFixed(3) }));
console.log('TABLE', JSON.stringify(out));
