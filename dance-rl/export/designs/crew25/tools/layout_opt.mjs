// Layout optimiser for the L4 "club" crews (n = 13 / 25 ...): loose scatter, staggered depth, odd / even dancers on
// either side of the centre, the lead front-centre off-axis. Scores a slot set by the real camera fit (Crew.jsx
// fitCameraAt, copied) and a coarse raster occlusion estimate (each dancer = torso / legs column + head + an arm bar),
// then anneals. node layout_opt.mjs mode(desktop|phone) n seed iters elLo elHi [W D]
import { PerspectiveCamera, Vector3 } from '/Users/aravraja/arav-portfolio/node_modules/three/build/three.module.js';
const [mode, nArg, seedArg, itArg, elLoA, elHiA, WA, DA] = process.argv.slice(2);
const n = Number(nArg), phone = mode === 'phone';
const VW = phone ? 390 : 1920, VH = phone ? 844 : 1080, TOP = phone ? 146 : 112, BOT = phone ? 118 : 150;
const ARM = phone ? 0.6 : 0.75, WANDER = 0.3, FOV = 30;
const elLo = Number(elLoA), elHi = Number(elHiA);
let seed = Number(seedArg) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cam = new PerspectiveCamera();
const tv = new Vector3();
function fitAt(boxes, el) {
  const pts = [];
  let cx = 0, cz = 0;
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
// screen-space proxies per dancer (camera from fit): column (torso + legs) +-0.24 m, 0..1.55 m; head r 0.13 at 1.68;
// arms bar +-0.62 m at 1.15..1.4 m; all at height scale hgt
const RS = 3; // raster cell, px
function occlusion(slots, F, hgt) {
  fitAt(slots, F.el); // sets cam
  const W = Math.ceil(VW / RS), H = Math.ceil(VH / RS);
  const order = slots.map((s, i) => i).sort((a, b) => slots[a][1] - slots[b][1]); // back (small z) first
  const id = new Int16Array(W * H).fill(-1);
  const area = new Float64Array(slots.length), hpx = new Float64Array(slots.length);
  const proj = (x, y, z) => { tv.set(x, y, z).project(cam); return [((tv.x * 0.5 + 0.5) * VW + F.dx) / RS, ((0.5 - tv.y * 0.5) * VH + F.dy) / RS]; };
  const rect = (i, x0, x1, y0, y1) => { let a = 0; for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) { id[y * W + x] = i; a++; } return a; };
  const shapes = [];
  for (const i of order) {
    const [x, z] = slots[i], h = hgt[i];
    const [fx, fy] = proj(x, 0, z), [, hy] = proj(x, 1.8 * h, z);
    const ppm = (fy - hy) / (1.8 * h);
    hpx[i] = (fy - hy) * RS;
    const s = [[fx - 0.24 * h * ppm, fx + 0.24 * h * ppm, fy - 1.55 * h * ppm, fy], [fx - 0.13 * h * ppm, fx + 0.13 * h * ppm, fy - 1.81 * h * ppm, fy - 1.55 * h * ppm], [fx - 0.62 * h * ppm, fx + 0.62 * h * ppm, fy - 1.42 * h * ppm, fy - 1.15 * h * ppm]];
    shapes[i] = s;
    for (const r of s) area[i] += rect(i, ...r);
  }
  // visible cells per dancer (overlapping own shapes counted once both ways: use own-coverage counts)
  const vis = new Float64Array(slots.length);
  for (let k = 0; k < id.length; k++) if (id[k] >= 0) vis[id[k]]++;
  const own = new Float64Array(slots.length);
  // own coverage without others (union of own rects)
  for (let i = 0; i < slots.length; i++) { const m = new Set(); for (const [x0, x1, y0, y1] of shapes[i]) for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) m.add(y * W + x); own[i] = m.size; }
  const occ = Array.from(own, (a, i) => 1 - vis[i] / Math.max(1, a));
  return { occ, hpx: Array.from(hpx) };
}
const hgt = Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0.97));
const DMIN = phone ? 1.0 : 1.15; // slot centres
function score(sl, full = false) {
  const F = fit(sl);
  const { occ, hpx } = occlusion(sl, F, hgt);
  const minH = Math.min(...hpx), worst = Math.max(...occ);
  let pen = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(sl[i][0] - sl[j][0], sl[i][1] - sl[j][1]);
    if (d < DMIN) pen += (DMIN - d) * 400;
    if (Math.abs(sl[i][0] - sl[j][0]) < 0.12) pen += 6; // no shared x lines
    if (Math.abs(sl[i][1] - sl[j][1]) < 0.08) pen += 4; // or z lines
  }
  // lead: front-most, a little left of centre
  const zmax = Math.max(...sl.slice(1).map((s) => s[1]));
  if (sl[0][1] < zmax + 0.15) pen += (zmax + 0.15 - sl[0][1]) * 300;
  const cx = sl.reduce((a, s) => a + s[0], 0) / n;
  const lx = sl[0][0] - cx; if (lx > -0.2) pen += (lx + 0.2) * 200; if (lx < -0.7) pen += (-0.7 - lx) * 200;
  // sides: half the others each side of the crew's centre
  const right = sl.slice(1).filter((s) => s[0] - cx > 0.12).length, left = sl.slice(1).filter((s) => s[0] - cx < -0.12).length;
  pen += (Math.abs(right - (n - 1) / 2) + Math.abs(left - (n - 1) / 2)) * 40;
  // irregular gaps: nearest-neighbour distance spread (clusters and loners), coefficient of variation >= 0.18
  const nn = sl.map((s, i) => Math.min(...sl.map((t, j) => (i === j ? 1e9 : Math.hypot(s[0] - t[0], s[1] - t[1])))));
  const mu = nn.reduce((a, b) => a + b, 0) / n, cv = Math.sqrt(nn.reduce((a, b) => a + (b - mu) ** 2, 0) / n) / mu;
  if (cv < 0.18) pen += (0.18 - cv) * 300;
  const occPen = occ.reduce((a, o) => a + Math.max(0, o - 0.08) ** 2 * 400 + Math.max(0, o - OCC_T) * 600, 0);
  const J = -minH - 0.3 * (hpx.reduce((a, b) => a + b, 0) / n) + pen + occPen;
  return full ? { J, minH, worst, occ, hpx, F, pen, cv, nn } : J;
}
const OCC_T = Number(process.env.OCC_T || 0.12);
// init: jittered staggered bands inside W x D
const W0 = Number(WA || (phone ? 2.8 : 10)), D0 = Number(DA || (phone ? 9 : 5));
function init() {
  const sl = [[-0.4, D0 / 2 + 0.5, 0, 1]];
  const bands = phone ? Math.round(Math.sqrt(n * D0 / W0)) : Math.max(3, Math.round(Math.sqrt(n * D0 / W0) + 0.5));
  const per = Math.ceil((n - 1) / bands);
  let k = 0;
  for (let b = 0; b < bands && k < n - 1; b++) {
    const z = D0 / 2 - (b + 0.5) * (D0 / bands);
    const m = Math.min(per, n - 1 - k);
    for (let j = 0; j < m; j++, k++) {
      const x = ((j + 0.5) / m - 0.5) * W0 + ((b % 3) - 1) * (W0 / m) / 3 + (rnd() - 0.5) * 0.5;
      sl.push([x, z + (rnd() - 0.5) * 0.7, 0, 1]);
    }
  }
  return sl;
}
if (process.env.SLOTS) { const sl = JSON.parse(process.env.SLOTS).map((s) => [s[0], s[1], 0, 1]); const r = score(sl, true); console.log(JSON.stringify({ minH: r.minH, worst: r.worst, occ: r.occ.map((o) => +o.toFixed(3)), el: r.F.el, pen: r.pen })); process.exit(0); }
let cur = init(), cj = score(cur), best = cur.map((s) => [...s]), bj = cj;
const IT = Number(itArg);
for (let it = 0; it < IT; it++) {
  const T = 30 * (1 - it / IT) + 0.5;
  const nx = cur.map((s) => [...s]);
  const i = Math.floor(rnd() * n), st = 0.45 * (1 - it / IT) + 0.05;
  if (rnd() < 0.15 && n > 2) { // move a dancer to a random free spot
    nx[i][0] = (rnd() - 0.5) * W0 * 1.1; nx[i][1] = (rnd() - 0.5) * D0 * 1.1;
  } else { nx[i][0] += (rnd() - 0.5) * 2 * st; nx[i][1] += (rnd() - 0.5) * 2 * st; }
  const j = score(nx);
  if (j < cj || rnd() < Math.exp((cj - j) / T)) { cur = nx; cj = j; if (j < bj) { bj = j; best = nx.map((s) => [...s]); } }
}
const r = score(best, true);
console.log(JSON.stringify({ mode, n, J: +r.J.toFixed(1), minH: +r.minH.toFixed(1), meanH: +(r.hpx.reduce((a, b) => a + b, 0) / n).toFixed(1), worst: +r.worst.toFixed(3), el: r.F.el, pen: +r.pen.toFixed(1), cv: +r.cv.toFixed(3), wfill: +r.F.wfill.toFixed(3), hfill: +r.F.hfill.toFixed(3) }));
console.log('SLOTS', JSON.stringify(best.map((s) => [+s[0].toFixed(3), +s[1].toFixed(3)])));
