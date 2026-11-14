// Greedy local refine against the real ID-render occlusion in the lab (headless, muted).
// node refine.cjs CREW W H DPR start.json out.json iters   (start.json: { slots, elevation, capBack, capFront, backFrac })
// Moves the most-occluded dancers (or a random one) a little / turns them; a move is kept if the cost drops and every
// root path stays >= GAP from every other over the whole song (paths.json), odd right / even left, lead within 1.6 m.
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [crew, w, h, dpr, sf, of, itA] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7], Number(process.argv[8] || 60)];
const phone = w < 600;
const TS = (process.env.TS || '10.6,25.3,41.04,55.2,68.5,85.4,100.3,121.7').split(',').map(Number);
const GAP = Number(process.env.GAP || 0.78), MOVE = Number(process.env.MOVE || 1);
const P = JSON.parse(fs.readFileSync(__dirname + '/paths.json'));
const st = JSON.parse(fs.readFileSync(sf));
let slots = st.slots.map((s) => [...s]);
const n = slots.length;
const LP = JSON.parse(fs.readFileSync(__dirname + '/paths_local.json')); // the lab's hips track, slot frame
const K = P.h.slice(0, n).map((hh, i) => hh * P.k[i]);
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function minGap(S) { const pos = S.map(([x, z, yaw], i) => { const c = Math.cos((yaw * Math.PI) / 180), s = Math.sin((yaw * Math.PI) / 180);
  return LP[i].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]); });
  let g = Infinity; for (let k = 0; k < pos[0].length; k += 1) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const dx = pos[i][k][0] - pos[j][k][0], dz = pos[i][k][1] - pos[j][k][1]; const d = dx * dx + dz * dz; if (d < g) g = d; }
  return Math.sqrt(g); }
const valid = (S) => S.every((s, i) => i === 0 || (i % 2 ? s[0] > 0.1 : s[0] < -0.1)) && Math.min(...S.slice(1).map((s) => Math.hypot(s[0] - S[0][0], s[1] - S[0][1]))) <= 1.6 && S.every((s) => Math.abs(s[2]) <= 35);
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  await p.goto(`http://localhost:${process.env.PORT || 5191}/dance-lab?crew=${crew}&sweep=0&panel=0&t=41.04`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => window.__lab && window.__crew && window.__crew.motion && window.__labThree, null, { timeout: 90000 });
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/occl.js', 'utf8') });
  const evalS = async (S) => {
    const r = await p.evaluate(async ({ crew, S, el, ts }) => {
      const u = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /src\/dance\/layouts\.js/.test(n)).pop();
      const M = await import(u); const L = M.LAYOUTS[crew];
      L.slots = (portrait, n) => S.slice(0, n); L.elevation = el;
      window.__lab.setCrew('L4'); await new Promise((r) => setTimeout(r, 200));
      window.__lab.setCrew(crew); await new Promise((r) => setTimeout(r, 350));
      const occ = [], hh = [];
      for (const t of ts) { window.__lab.freeze(t); await new Promise((r) => setTimeout(r, 60)); const a = await window.__occl(0.5); occ.push(a.occ); hh.push(a.heightPx); }
      return { occ, hh, cam: window.__crewCam };
    }, { crew, S, el: st.elevation, ts: TS });
    const perD = [...Array(n).keys()].map((i) => Math.max(...r.occ.map((o) => o[i])));
    const order = [...Array(n).keys()].sort((a, b) => S[a][1] - S[b][1]); const back = new Set(order.slice(0, Math.round(n * (st.backFrac ?? 0.4))));
    const cap = (i) => (back.has(i) ? st.capBack ?? 0.25 : st.capFront ?? 0.2);
    const meanH = r.hh.flat().reduce((a, b) => a + b, 0) / (n * TS.length);
    const cost = perD.reduce((a, o, i) => a + 100 * Math.max(0, o - cap(i)) ** 2 + 0.6 * o, 0) - (st.sizeW ?? 0.02) * meanH;
    return { cost, perD, worst: Math.max(...perD), meanOcc: perD.reduce((a, b) => a + b, 0) / n, meanH, cam: r.cam };
  };
  let cur = await evalS(slots), g0 = minGap(slots), gCur = g0;
  console.log('start', JSON.stringify({ cost: +cur.cost.toFixed(2), worst: +cur.worst.toFixed(3), meanOcc: +cur.meanOcc.toFixed(3), meanH: +cur.meanH.toFixed(1), gap: +g0.toFixed(3), el: cur.cam.elevation }));
  for (let it = 0; it < itA; it++) {
    const ranked = [...Array(n).keys()].sort((a, b) => cur.perD[b] - cur.perD[a]);
    const i = rnd() < 0.75 ? ranked[Math.floor(rnd() * 5)] : Math.floor(rnd() * n);
    const S = slots.map((s) => [...s]);
    const m = rnd();
    if (m < 0.45) S[i][0] = +(S[i][0] + (rnd() - 0.5) * 0.5 * MOVE).toFixed(3);
    else if (m < 0.75) S[i][1] = +(S[i][1] + (rnd() - 0.5) * 0.45 * MOVE).toFixed(3);
    else if (i) S[i][2] = Math.max(-35, Math.min(35, Math.round(S[i][2] + (rnd() - 0.5) * 30)));
    if (i === 0 && m >= 0.75) continue;
    if (!valid(S)) continue;
    const g = minGap(S); if (g < GAP && g < gCur - 1e-9) continue;
    const r = await evalS(S);
    if (r.cost < cur.cost) { slots = S; cur = r; gCur = g; fs.writeFileSync(of, JSON.stringify({ ...st, slots, result: { worst: cur.worst, meanOcc: cur.meanOcc, meanH: cur.meanH, perD: cur.perD } })); console.log(it, 'keep', i, JSON.stringify({ cost: +r.cost.toFixed(2), worst: +r.worst.toFixed(3), meanOcc: +r.meanOcc.toFixed(3), meanH: +r.meanH.toFixed(1), gap: +g.toFixed(3) })); }
  }
  fs.writeFileSync(of, JSON.stringify({ ...st, slots, result: { worst: cur.worst, meanOcc: cur.meanOcc, meanH: cur.meanH, perD: cur.perD, gap: minGap(slots) } }));
  console.log('done', JSON.stringify({ worst: +cur.worst.toFixed(3), meanOcc: +cur.meanOcc.toFixed(3), meanH: +cur.meanH.toFixed(1), gap: +minGap(slots).toFixed(3) }));
  await b.close();
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
