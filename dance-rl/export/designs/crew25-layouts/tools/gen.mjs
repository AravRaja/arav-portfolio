// Layout variants V1-V5 for the 25 (desktop) / 13 (phone) crew: a parametric template per variant + seeded jitter,
// slot relaxation (min centre distance), dancer assignment (odd right / even left, mirror pairs at mirrored spots,
// no neighbours in the same template + top colour, no neighbours on the same offset+mirror), facings, then the
// root-path spacing check over the whole song (paths.json: crew mode, 10 Hz) with a repair loop that pushes the
// closest pair's slots apart until every pair stays >= GAP.
//   node gen.mjs V1..V5 desktop|phone [seed]   -> JSON line + TABLE line
import fs from 'fs';
const R = '/Users/aravraja/arav-portfolio';
const [variant, mode, seedArg] = process.argv.slice(2);
const phone = mode === 'phone', n = phone ? 13 : 25;
const { generateCrew } = await import(R + '/src/dance/looks.js');
const looks = generateCrew(7, 25).slice(0, n);
const P = JSON.parse(fs.readFileSync(new URL('./paths.json', import.meta.url)));
const LP = JSON.parse(fs.readFileSync(new URL('./paths_local.json', import.meta.url))); // the lab's hips track, slot frame
const K = looks.map((l, i) => l.height * P.k[i]);
let seed = Number(seedArg || 11) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const J = (a) => (rnd() - 0.5) * 2 * a;
const GAP = Number(process.env.GAP || 0.78);

// ---------- templates: [x, z] list, index 0 = the lead; extra per-variant options
function rows(spec, { sx, sz, z0, jx = 0.1, jz = 0.12, lead = 0.3, shear = 0 }) {
  // spec: [[count, shift(in units of sx)], ...] front row first; row 0 must hold the lead at its centre
  const out = [];
  spec.forEach(([m, sh, sxr = sx], r) => {
    const z = z0 - r * sz;
    for (let k = 0; k < m; k++) {
      let x = (k - (m - 1) / 2 + sh) * sxr;
      if (Math.abs(x) < 0.05 && !(r === 0)) x = (out.length % 2 ? 0.22 : -0.22);
      const isLead = r === 0 && Math.abs(x) < 0.05;
      out.push({ x: x + (isLead ? 0 : J(jx)) + shear * r * Math.sign(x), z: z + (isLead ? lead : J(jz)), lead: isLead });
    }
  });
  const li = out.findIndex((p) => p.lead);
  const L = out.splice(li, 1)[0];
  return [L, ...out];
}
const T = {
  V1: {
    // tight club: irregular clumps, dense, lead at the front edge of the crowd (inside it, not out alone)
    desktop: () => clumps(25, { W: 8.4, D: 5.2, dmin: 1.08, lead: [-0.35, 2.35] }),
    phone: () => clumps(13, { W: 2.9, D: 7.4, dmin: 1.0, lead: [-0.2, 3.45] }),
    fov: 30, el: [13, [26, 34]], dmin: [1.08, 1.0],
  },
  V2: {
    desktop: () => rows([[5, 0], [6, 0], [7, 0], [7, 0.5]], { sx: 1.32, sz: 1.2, z0: 1.8, lead: 0.35 }),
    phone: () => rows([[3, 0], [2, 0], [3, 0], [2, 0], [3, 0]], { sx: 1.08, sz: 1.3, z0: 2.6, lead: 0.4, jx: 0.06 }),
    fov: 30, el: [15, [26, 34]], dmin: [1.15, 1.0],
  },
  V3: {
    desktop: () => rows([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [5, 0.5], [5, 0]], { sx: 1.38, sz: 0.98, z0: 3.0, lead: 0, jx: 0.08, jz: 0.08 }),
    phone: () => rows([[1, 0], [2, 0], [3, 0], [4, 0], [3, 0]], { sx: 0.98, sz: 1.5, z0: 3.0, lead: 0, jx: 0.05, jz: 0.08 }),
    fov: 30, el: [15, [26, 34]], dmin: [1.15, 0.98],
  },
  V4: { desktop: () => arc(25, { R1: 2.7, R2: 3.85, a: 112, c: 1.1, lead: 1.35, inner: 5 }), phone: () => arc(13, { R1: 1.05, R2: 2.0, a: 92, c: 1.0, lead: 1.15, sy: 2.4, inner: 4, oa: 58 }),
    fov: 30, el: [16, [28, 36]], dmin: [1.0, 0.98], face: 0.35 },
  V5: { desktop: () => flanks(25), phone: () => flanks(13), fov: 30, el: [14, [26, 34]], dmin: [1.12, 0.98], mirrorW: 8 },
};
function clumps(m, { W, D, dmin, lead }) {
  // anneal: hard min distance, soft pull to the 2nd-nearest at ~1.18 dmin (clumps), soft ellipse, a few gaps
  let p = [{ x: lead[0], z: lead[1], lead: true }];
  for (let i = 1; i < m; i++) p.push({ x: J(W / 2), z: J(D / 2) - 0.2 });
  const E = (q) => { let e = 0;
    for (let i = 0; i < m; i++) {
      const ds = [];
      for (let j = 0; j < m; j++) if (j !== i) { const d = Math.hypot(q[i].x - q[j].x, q[i].z - q[j].z); ds.push(d); if (j > i && d < dmin) e += (dmin - d) * 400; if (j > i && Math.abs(q[i].x - q[j].x) < 0.3 && q[i].z - q[j].z > 0 && q[i].z - q[j].z < 2.4) e += 6 * (0.3 - Math.abs(q[i].x - q[j].x)) * 10; }
      ds.sort((a, b) => a - b);
      e += 4 * Math.max(0, ds[1] - 1.2 * dmin) ** 2 * 10;
      const r = (q[i].x / (W / 2)) ** 2 + (q[i].z / (D / 2)) ** 2; if (r > 1) e += (r - 1) * 200;
      if (i > 0 && q[i].z > q[0].z - 0.25) e += (q[i].z - q[0].z + 0.25) * 300; // the lead is the front-most
    }
    return e; };
  let e = E(p);
  for (let it = 0; it < 60000; it++) {
    const i = 1 + Math.floor(rnd() * (m - 1)), st = 0.6 * (1 - it / 60000) + 0.03;
    const q = p.map((o) => ({ ...o })); q[i].x += J(st); q[i].z += J(st);
    const f = E(q), Tt = 5 * (1 - it / 60000) + 0.01;
    if (f < e || rnd() < Math.exp((e - f) / Tt)) { p = q; e = f; }
  }
  return p;
}
function arc(m, { R1, R2, a, c, lead, sy = 1, inner: innerA, oa }) {
  // a horseshoe two deep, open towards the camera (+z); angle 0 = the back of the arc; the lead inside it, near the back
  const per = (m - 1) / 2, inner = innerA ?? Math.ceil(per / 2), outer = per - inner; // per side
  const p = [{ x: 0, z: c - R1 * sy + lead, lead: true }];
  const put = (R, th) => { for (const s of [1, -1]) p.push({ x: s * R * Math.sin(th) + J(0.05), z: c - R * sy * Math.cos(th) + J(0.06) }); };
  const st1 = (a - 10) / Math.max(1, inner - 0.5), st2 = ((oa ?? a + 4) - 6) / Math.max(1, outer - 0.5);
  for (let k = 0; k < inner; k++) put(R1, ((10 + k * st1) * Math.PI) / 180);
  for (let k = 0; k < outer; k++) put(R2, ((6 + (k + 0.5) * st2 * 0.98) * Math.PI) / 180);
  return p;
}
function flanks(m) {
  // two diagonal blocks, wider towards the front ("\\ /" seen from the camera), a centre lane with the lead at its front
  // and 2 (phone) / 4 (desktop) featured dancers behind it; flank spots mirror each other
  const ph = m < 20, p = [{ x: 0, z: ph ? 2.4 : 1.7, lead: true }];
  if (ph) p.push({ x: 0.5, z: 1.25 }, { x: -0.5, z: 1.25 });
  else p.push({ x: 0.8, z: 0.55 }, { x: -0.8, z: 0.55 });
  const spots = [];
  if (ph) for (let r = 0; r < 5; r++) spots.push([1.0 + r * 0.09 + (r % 2) * 0.12, -3.6 + r * 1.3]);
  else { for (let r = 0; r < 5; r++) for (let k = 0; k < 2; k++) spots.push([2.0 + r * 0.38 + k * 1.25 + (r % 2) * 0.3, -3.4 + r * 1.3 + k * 0.3]); spots.push([2.3, -4.6]); }
  for (const [x, z] of spots) { const jx = J(0.06), jz = J(0.07); p.push({ x: x + jx, z: z + jz }, { x: -(x + jx), z: z + jz }); }
  return p;
}

// ---------- build
const V = T[variant];
let base = V[mode]().map((q) => [q.x, q.z]);
{ const SX = Number(process.env.SX || 1), SZ = Number(process.env.SZ || 1), lz = base[0][1], lx = base[0][0];
  base = base.map(([x, z]) => [lx + (x - lx) * SX, lz + (z - lz) * SZ]);
  // the lead is never out alone: pull it back towards the crowd until its nearest dancer is <= 1.45 m away
  const nn = () => Math.min(...base.slice(1).map(([x, z]) => Math.hypot(x - base[0][0], z - base[0][1])));
  for (let k = 0; k < 200 && nn() > 1.45; k++) base[0][1] -= 0.02;
  // x = 0 is the lead's line: odd dancers right of it, even (mirrored) left
  const lx0 = base[0][0]; base = base.map(([x, z]) => [x - lx0, z]); }
if (base.length !== n) throw new Error(`${variant} ${mode}: ${base.length} spots, want ${n}`);
const dmin = V.dmin[phone ? 1 : 0];
// relax: push spots apart to dmin (lead held)
for (let it = 0; it < 400; it++) {
  let moved = false;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = base[j][0] - base[i][0], dz = base[j][1] - base[i][1], d = Math.hypot(dx, dz);
    if (d < dmin) { const f = (dmin - d) / 2 + 0.002, ux = dx / (d || 1), uz = dz / (d || 1); moved = true;
      if (i !== 0) { base[i][0] -= ux * f; base[i][1] -= uz * f; } else { base[j][0] += ux * f; base[j][1] += uz * f; }
      if (j !== 0) { base[j][0] += ux * f; base[j][1] += uz * f; } }
  }
  if (!moved) break;
}
// centre on x = 0 about the lead (the lead stays at its x)
const leadX = base[0][0];
// sides
const idx = [...Array(n).keys()].slice(1);
let right = idx.filter((i) => base[i][0] > 0), left = idx.filter((i) => base[i][0] <= 0);
const odd = idx.filter((i) => i % 2 === 1), even = idx.filter((i) => i % 2 === 0);
while (right.length > odd.length) { right.sort((a, b) => base[a][0] - base[b][0]); left.push(right.shift()); }
while (left.length > even.length) { left.sort((a, b) => base[b][0] - base[a][0]); right.push(left.shift()); }
// spots that ended up on the wrong side of x = 0 are nudged across
for (const i of right) if (base[i][0] <= 0.15) base[i][0] = 0.15 + rnd() * 0.1;
for (const i of left) if (base[i][0] >= -0.15) base[i][0] = -0.15 - rnd() * 0.1;

const cls = (i) => (i === 0 ? 'L' : `${(Math.ceil(i / 2) - 1) % 4}${i % 2}`);
const key = (i) => `${looks[i].template}:${looks[i].outfit.top}`;
const NB = phone ? 1.45 : 1.75;
const MW = V.mirrorW ?? 2;
function cost(asg) { // asg[i] = spot for dancer i
  let c = 0;
  const Q = asg.map((s) => base[s]);
  const nearest = Q.map((p, i) => Q.map((q, j) => [Math.hypot(p[0] - q[0], p[1] - q[1]), j]).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]).slice(0, 3));
  for (let i = 0; i < n; i++) for (const [d, j] of nearest[i]) {
    if (j < i) continue;
    const nb = d < NB || nearest[i][0][1] === j || nearest[j][0][1] === i;
    if (!nb) continue;
    if (key(i) === key(j)) c += 100;
    if (looks[i].template === looks[j].template && looks[i].outfit.top === looks[j].outfit.top) c += 100;
    if (looks[i].outfit.top === looks[j].outfit.top) c += 6;
    if (cls(i) === cls(j)) c += 25;
    if (looks[i].hairStyle === looks[j].hairStyle) c += 3;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(Q[i][0] - Q[j][0], Q[i][1] - Q[j][1]);
    if (looks[i].template === 'allblack' && looks[j].template === 'allblack' && d < 3) c += 150;
    if (key(i) === key(j) && d < 2.4) c += 30;
  }
  for (let k = 1; 2 * k <= n - 1; k++) { const a = Q[2 * k - 1], b = Q[2 * k]; c += MW * (Math.abs(a[0] - leadX + b[0] - leadX) + Math.abs(a[1] - b[1])); }
  return c;
}
let asg = new Array(n); asg[0] = 0;
{ const r0 = [...right].sort(() => rnd() - 0.5), l0 = [...left].sort(() => rnd() - 0.5); odd.forEach((i, k) => { asg[i] = r0[k]; }); even.forEach((i, k) => { asg[i] = l0[k]; }); }
let cc = cost(asg), best = [...asg], bc = cc;
const IT = 30000;
for (let it = 0; it < IT; it++) {
  const Tt = 20 * (1 - it / IT) + 0.05;
  const grp = rnd() < 0.5 ? odd : even;
  const a = grp[Math.floor(rnd() * grp.length)], b = grp[Math.floor(rnd() * grp.length)];
  if (a === b) continue;
  const nx = [...asg]; [nx[a], nx[b]] = [nx[b], nx[a]];
  const c = cost(nx);
  if (c < cc || rnd() < Math.exp((cc - c) / Tt)) { asg = nx; cc = c; if (c < bc) { bc = c; best = [...nx]; } }
}
asg = best;
// facings: towards the camera (outer dancers turned in a bit more), V4 also part-way towards the arc's centre
const elD = (Array.isArray(V.el[phone ? 1 : 0]) ? V.el[1][0] : V.el[0]) * Math.PI / 180;
const zc = base.reduce((a, s) => a + s[1], 0) / n, camZ = zc + (phone ? 22 : 24) * Math.cos(elD);
let slots = asg.map((s, i) => {
  const [x, z] = base[s];
  let face = (Math.atan2(-(x - leadX), camZ - z) * 180) / Math.PI * 1.35;
  if (V.face) { const fc = (Math.atan2(-(x - leadX), (base[0][1] + 1.2) - z) * 180) / Math.PI; if (z < base[0][1] + 1.2) face = (1 - V.face) * face + V.face * fc; }
  let yaw = face + J(9);
  if (i === 0) yaw = 4;
  yaw = Math.max(-35, Math.min(35, Math.round(yaw)));
  return [x - leadX, z, yaw];
});
// ---------- root paths over the song + repair
function rootPaths(S) { return S.map(([x, z, yaw], i) => { const c = Math.cos((yaw * Math.PI) / 180), s = Math.sin((yaw * Math.PI) / 180);
  return LP[i].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]); }); }
function minGap(S) { const pos = rootPaths(S); let g = Infinity, at = null; const TT = pos[0].length;
  for (let k = 0; k < TT; k++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = Math.hypot(pos[i][k][0] - pos[j][k][0], pos[i][k][1] - pos[j][k][1]); if (d < g) { g = d; at = [i, j, k]; } }
  return { g, at }; }
let mg = minGap(slots), rep = 0;
while (mg.g < GAP && rep < 300) {
  const [i, j] = mg.at; const a = slots[i], b = slots[j];
  let dx = b[0] - a[0], dz = b[1] - a[1]; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const f = 0.04;
  const sideOK = (k, nx) => k === 0 || (k % 2 ? nx > 0.1 : nx < -0.1);
  if (i !== 0 && sideOK(i, a[0] - dx * f)) { a[0] -= dx * f; a[1] -= dz * f; }
  if (j !== 0 && sideOK(j, b[0] + dx * f)) { b[0] += dx * f; b[1] += dz * f; }
  mg = minGap(slots); rep++;
}
// the lead within 1.5 m of its nearest dancer (the repair may have pushed neighbours off): step towards it
for (let k = 0; k < 60; k++) {
  const ds = slots.slice(1).map((s, j) => [Math.hypot(s[0] - slots[0][0], s[1] - slots[0][1]), j + 1]).sort((a, b) => a[0] - b[0]);
  if (ds[0][0] <= 1.5) break;
  const t = slots[ds[0][1]], d = ds[0][0];
  const S2 = slots.map((s) => [...s]); S2[0][0] += ((t[0] - slots[0][0]) / d) * 0.03; S2[0][1] += ((t[1] - slots[0][1]) / d) * 0.03;
  const g2 = minGap(S2); if (g2.g < GAP) break; slots = S2; mg = g2;
}
slots = slots.map(([x, z, y]) => [+x.toFixed(3), +z.toFixed(3), y, 1]);
let slotMin = Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slotMin = Math.min(slotMin, Math.hypot(slots[i][0] - slots[j][0], slots[i][1] - slots[j][1]));
const leadNN = Math.min(...slots.slice(1).map((s) => Math.hypot(s[0] - slots[0][0], s[1] - slots[0][1])));
console.log(JSON.stringify({ variant, mode, cost: bc, minGap: +mg.g.toFixed(3), at: mg.at && [mg.at[0], mg.at[1], +(8.37 + mg.at[2] * 0.1).toFixed(1)], repairs: rep, slotMin: +slotMin.toFixed(3), leadNN: +leadNN.toFixed(2),
  w: +(Math.max(...slots.map((s) => s[0])) - Math.min(...slots.map((s) => s[0]))).toFixed(2), d: +(Math.max(...slots.map((s) => s[1])) - Math.min(...slots.map((s) => s[1]))).toFixed(2) }));
console.log('TABLE', JSON.stringify(slots));
