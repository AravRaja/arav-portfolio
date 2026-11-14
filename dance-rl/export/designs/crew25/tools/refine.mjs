// Refine an assigned table (dancer order fixed): anneal slot x / z against a proxy occlusion over the song (dancers at
// their real root positions at sampled times), screen size, path spacing >= GAP, and the look rules.
// node refine.mjs TABLEFILE mode n seed iters elLo elHi > out
import fs from 'fs';
import { PerspectiveCamera, Vector3 } from '/Users/aravraja/arav-portfolio/node_modules/three/build/three.module.js';
const R = '/Users/aravraja/arav-portfolio';
const [file, mode, nArg, seedArg, itArg, elLoA, elHiA] = process.argv.slice(2);
const n = Number(nArg), phone = mode === 'phone';
const { generateCrew } = await import(R + '/src/dance/looks.js');
const looks = generateCrew(7, 25).slice(0, n);
const hgt = looks.map((l) => l.height);
const K = looks.map((l) => l.height * 1.0533);
const tab = JSON.parse(fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('TABLE')).slice(6));
const paths = JSON.parse(fs.readFileSync(new URL('./paths.json', import.meta.url)));
const VW = phone ? 390 : 1920, VH = phone ? 844 : 1080, TOP = phone ? 146 : 112, BOT = phone ? 118 : 150;
const ARM = phone ? 0.6 : 0.75, WANDER = 0.3, FOV = 30, elLo = Number(elLoA), elHi = Number(elHiA);
const GAP = Number(process.env.GAP || 0.78);
let seed = Number(seedArg) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cam = new PerspectiveCamera(), tv = new Vector3();
function fitAt(boxes, el) {
  const pts = []; let cx = 0, cz = 0;
  for (const [x, z] of boxes) { cx += x / boxes.length; cz += z / boxes.length; for (const dx of [-ARM - WANDER, ARM + WANDER]) for (const y of [0, 2.05]) for (const dz of [-0.5 - WANDER, 0.5 + WANDER]) pts.push(new Vector3(x + dx, y, z + dz)); }
  const avail = Math.max(120, VH - TOP - BOT), e = (el * Math.PI) / 180, look = new Vector3(cx, 0.95, cz);
  cam.fov = FOV; cam.near = 0.1; cam.far = 200; cam.aspect = VW / VH; cam.clearViewOffset();
  const bbox = (d) => { cam.position.set(look.x, look.y + d * Math.sin(e), look.z + d * Math.cos(e)); cam.lookAt(look); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of pts) { tv.copy(p).project(cam); const px = (tv.x * 0.5 + 0.5) * VW, py = (0.5 - tv.y * 0.5) * VH; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } return [x0, x1, y0, y1]; };
  let lo = 2, hi = 120;
  for (let k = 0; k < 32; k++) { const d = (lo + hi) / 2; const [x0, x1, y0, y1] = bbox(d); if (x1 - x0 <= 0.94 * VW && y1 - y0 <= avail) hi = d; else lo = d; }
  const [x0, x1, y0, y1] = bbox(hi);
  return { dist: hi, wfill: (x1 - x0) / VW, hfill: (y1 - y0) / avail, el, dx: VW / 2 - (x0 + x1) / 2, dy: TOP + avail / 2 - (y0 + y1) / 2 };
}
function fit(boxes) { let best = null; for (let el = elLo; el <= elHi + 1e-6; el += 1) { const r = fitAt(boxes, el); const s = Math.min(r.wfill / 0.94, r.hfill); if (!best || s > best.s + 0.005) best = { el, s }; } return fitAt(boxes, best.el); }
const RS = 3, GW = Math.ceil(VW / RS), GH = Math.ceil(VH / RS);
const id = new Int16Array(GW * GH);
function occAt(P, F) { // P: [x, z] per dancer (root on the floor), camera already set by fitAt
  id.fill(-1);
  const order = P.map((s, i) => i).sort((a, b) => P[a][1] - P[b][1]);
  const own = new Float64Array(n), vis = new Float64Array(n), hpx = new Float64Array(n);
  const proj = (x, y, z) => { tv.set(x, y, z).project(cam); return [((tv.x * 0.5 + 0.5) * VW + F.dx) / RS, ((0.5 - tv.y * 0.5) * VH + F.dy) / RS]; };
  for (const i of order) {
    const [x, z] = P[i], h = hgt[i];
    const [fx, fy] = proj(x, 0, z), [, hy] = proj(x, 1.8 * h, z);
    const ppm = (fy - hy) / (1.8 * h); hpx[i] = (fy - hy) * RS;
    const S = [[fx - 0.24 * h * ppm, fx + 0.24 * h * ppm, fy - 1.55 * h * ppm, fy], [fx - 0.13 * h * ppm, fx + 0.13 * h * ppm, fy - 1.81 * h * ppm, fy - 1.55 * h * ppm], [fx - 0.66 * h * ppm, fx + 0.66 * h * ppm, fy - 1.45 * h * ppm, fy - 1.12 * h * ppm]];
    const seen = new Set();
    for (const [x0, x1, y0, y1] of S) for (let y = Math.max(0, Math.floor(y0)); y < Math.min(GH, Math.ceil(y1)); y++) for (let xx = Math.max(0, Math.floor(x0)); xx < Math.min(GW, Math.ceil(x1)); xx++) { const k = y * GW + xx; if (!seen.has(k)) { seen.add(k); id[k] = i; } }
    own[i] = seen.size;
  }
  for (let k = 0; k < id.length; k++) if (id[k] >= 0) vis[id[k]]++;
  return { occ: Array.from(own, (a, i) => 1 - vis[i] / Math.max(1, a)), hpx };
}
const TS = []; for (let k = 2; k < paths[0].length; k += Math.floor(paths[0].length / Number(process.env.NT || 36))) TS.push(k);
const rootAt = (sl, i, k) => { const [x, z, yaw] = sl[i]; const c = Math.cos((yaw * Math.PI) / 180), s = Math.sin((yaw * Math.PI) / 180); const [mx, my] = paths[i][k]; const lx = K[i] * my, lz = K[i] * mx; return [x + c * lx + s * lz, z - s * lx + c * lz]; };
function evalT(sl, full = false) {
  const F = fit(sl);
  let worst = 0, pen = 0, minH = 1e9, sumH = 0, occSum = 0;
  const perD = new Float64Array(n);
  for (const k of TS) {
    fitAt(sl, F.el);
    const P = sl.map((_, i) => rootAt(sl, i, k));
    const { occ, hpx } = occAt(P, F);
    for (let i = 0; i < n; i++) { perD[i] = Math.max(perD[i], occ[i]); occSum += occ[i]; }
    for (const h of hpx) { minH = Math.min(minH, h); sumH += h; }
  }
  for (let i = 0; i < n; i++) { worst = Math.max(worst, perD[i]); pen += Math.max(0, perD[i] - KNEE) ** 2 * 600 + Math.max(0, perD[i] - OCC_T) * 800; }
  // spacing over the whole song (10 Hz)
  let gap = 1e9;
  for (let k = 0; k < paths[0].length; k += 2) { const P = sl.map((_, i) => rootAt(sl, i, k)); for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) gap = Math.min(gap, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1])); }
  if (gap < GAP) pen += (GAP - gap) * 3000;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (Math.abs(sl[i][0] - sl[j][0]) < 0.1) pen += 5; if (Math.abs(sl[i][1] - sl[j][1]) < 0.07) pen += 3; }
  const zmax = Math.max(...sl.slice(1).map((s) => s[1])); if (sl[0][1] < zmax + 0.15) pen += (zmax + 0.15 - sl[0][1]) * 300;
  const cx = sl.reduce((a, s) => a + s[0], 0) / n;
  for (let i = 1; i < n; i++) { const side = sl[i][0] - cx; if (i % 2 ? side < 0.1 : side > -0.1) pen += 200; }
  const lx = sl[0][0] - cx; if (lx > -0.15) pen += (lx + 0.15) * 200; if (lx < -0.8) pen += (-0.8 - lx) * 200;
  const meanH = sumH / (TS.length * n);
  const J = -minH - 0.5 * meanH + pen + occSum / TS.length * 20;
  return full ? { J, worst, minH, meanH, gap, perD: Array.from(perD), el: F.el, dist: F.dist, wfill: F.wfill, hfill: F.hfill, pen } : J;
}
const OCC_T = Number(process.env.OCC_T || 0.14), KNEE = Number(process.env.KNEE || 0.1);
let cur = tab.map((r) => [...r]), cj = evalT(cur), best = cur.map((r) => [...r]), bj = cj;
const IT = Number(itArg);
for (let it = 0; it < IT; it++) {
  const T = 12 * (1 - it / IT) + 0.3, st = 0.3 * (1 - it / IT) + 0.04;
  const nx = cur.map((r) => [...r]);
  const i = Math.floor(rnd() * n);
  nx[i][0] = +(nx[i][0] + (rnd() - 0.5) * 2 * st).toFixed(3); nx[i][1] = +(nx[i][1] + (rnd() - 0.5) * 2 * st).toFixed(3);
  if (rnd() < 0.2 && i) nx[i][2] = Math.max(-35, Math.min(35, nx[i][2] + Math.round((rnd() - 0.5) * 12)));
  const j = evalT(nx);
  if (j < cj || rnd() < Math.exp((cj - j) / T)) { cur = nx; cj = j; if (j < bj) { bj = j; best = nx.map((r) => [...r]); } }
}
const r0 = evalT(tab, true), r = evalT(best, true);
const f = (r) => ({ J: +r.J.toFixed(1), worst: +r.worst.toFixed(3), minH: +r.minH.toFixed(1), meanH: +r.meanH.toFixed(1), gap: +r.gap.toFixed(3), el: r.el, dist: +r.dist.toFixed(2), hfill: +r.hfill.toFixed(3), pen: +r.pen.toFixed(1) });
console.log(JSON.stringify({ before: f(r0), after: f(r) }));
console.log('TABLE', JSON.stringify(best));
