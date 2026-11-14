// Production perf run, muted: real flow (load, click, hold space until armed, let go at once), stage.
//   node perf.cjs PROFILE RUNS OUTJSON   PROFILE: desk2x | desk1x | phone | phone4x | phone6x  (+ env UNCAPPED=1)
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [prof, runsA, outF] = process.argv.slice(2);
const P = { desk2x: [1920, 1080, 2, 1], desk1x: [1920, 1080, 1, 1], phone: [390, 844, 3, 1], phone4x: [390, 844, 3, 4], phone6x: [390, 844, 3, 6] }[prof];
const [w, h, dpr, thr] = P; const phone = w < 600;
const BASE = process.env.BASE || 'http://localhost:5192/';
const uncapped = process.env.UNCAPPED === '1';
const init = () => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* */ }
  const G = WebGL2RenderingContext.prototype; window.__gl = { calls: 0, tris: 0 };
  const wrap = (fn, triOf) => { const o = G[fn]; G[fn] = function (...a) { window.__gl.calls++; window.__gl.tris += triOf(a); return o.apply(this, a); }; };
  wrap('drawElements', (a) => (a[0] === 4 ? a[1] / 3 : 0)); wrap('drawArrays', (a) => (a[0] === 4 ? a[2] / 3 : 0));
  wrap('drawElementsInstanced', (a) => (a[0] === 4 ? (a[1] / 3) * a[4] : 0)); wrap('drawArraysInstanced', (a) => (a[0] === 4 ? (a[2] / 3) * a[3] : 0));
  window.__frames = []; // [t, dt, calls, tris]
  let last = null;
  const loop = (t) => { if (last !== null) window.__frames.push([+t.toFixed(2), +(t - last).toFixed(2), window.__gl.calls, Math.round(window.__gl.tris)]); window.__gl.calls = 0; window.__gl.tris = 0; last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__hold = [];
  window.addEventListener('dj-hold-change', (e) => { window.__hold.push([+performance.now().toFixed(0), JSON.stringify(e.detail)]); });
};
const stats = (fr) => { const d = fr.map((f) => f[1]).sort((a, b) => a - b); if (!d.length) return null; const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
  const span = fr.reduce((a, f) => a + f[1], 0); return { frames: d.length, fps: +(1000 * d.length / span).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1], over20: d.filter((x) => x > 20).length,
    drawCalls: [...new Set(fr.map((f) => f[2]))].slice(0, 6), tris: [...new Set(fr.map((f) => f[3]))].slice(0, 4) }; };
(async () => {
  const out = [];
  for (let run = 0; run < Number(runsA || 1); run++) {
    const args = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
    if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
    const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args });
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
    if (process.env.DELAY) await ctx.route('**/dance/finale.bin', (rt) => setTimeout(() => rt.continue(), Number(process.env.DELAY)));
    const p = await ctx.newPage();
    await p.addInitScript(init);
    const errs = [];
    p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/AudioContext|Context Lost|GPU stall/.test(m.text())) errs.push(m.text().slice(0, 200)); });
    p.on('pageerror', (e) => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    if (phone) await p.touchscreen.tap(w / 2, h / 2); else await p.mouse.click(w / 2, h / 2);
    await p.waitForTimeout(800);
    if (thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
    await cdp.send('HeapProfiler.collectGarbage');
    const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const tHold = await p.evaluate(() => performance.now());
    await p.keyboard.down('Space');
    // let go the moment the bar is full (armed): the quickest hold-and-release there is
    await p.waitForFunction(() => window.__hold.some((x) => /"armed":true/.test(x[1])), null, { timeout: 30000, polling: 16 });
    await p.keyboard.up('Space');
    const tRel = await p.evaluate(() => performance.now());
    await p.waitForSelector('.dance-stage.is-visible', { timeout: 40000 });
    const tVis = await p.evaluate(() => performance.now());
    await p.waitForTimeout(3500); // the auto-sweep (0.9 s after the fade-in, ~1.6 s long) is over
    const s0 = await p.evaluate(() => performance.now());
    await p.waitForTimeout(5000);
    const s1 = await p.evaluate(() => performance.now());
    await cdp.send('HeapProfiler.collectGarbage');
    const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const r = await p.evaluate(([tHold, tRel, tVis, s0, s1]) => {
      const F = window.__frames;
      const marks = Object.fromEntries(performance.getEntriesByType('mark').filter((k) => k.name.startsWith('dance-stage')).map((k) => [k.name.replace('dance-stage:', ''), +k.startTime.toFixed(0)]));
      return { tHold, tRel, tVis, marks, lt: window.__lt, hold: window.__hold,
        stage: F.filter((f) => f[0] >= s0 && f[0] <= s1), visCalls: F.filter((f) => f[0] >= tVis - 400 && f[0] <= tVis + 600).map((f) => f[2]), opac: null, dropWin: F.filter((f) => f[0] >= tRel && f[0] <= tRel + 4400), holdWin: F.filter((f) => f[0] >= tHold && f[0] <= tRel) };
    }, [tHold, tRel, tVis, s0, s1]);
    const rel = (t) => (t == null ? null : +(t - r.tHold).toFixed(0));
    const res = {
      profile: prof, run, uncapped, throttle: thr,
      stage: stats(r.stage), dropWindow: stats(r.dropWin), holdWindow: stats(r.holdWin),
      holdMs: +(r.tRel - r.tHold).toFixed(0), releaseToVisibleMs: +(r.tVis - r.tRel).toFixed(0),
      bodiesBuiltAfterHoldMs: rel(r.marks['bodies-built']), kitReadyAfterHoldMs: rel(r.marks['kit-ready']),
      mountAfterReleaseMs: r.marks.mount ? +(r.marks.mount - r.tRel).toFixed(0) : null, firstFrameAfterReleaseMs: r.marks['first-frame'] ? +(r.marks['first-frame'] - r.tRel).toFixed(0) : null,
      longTasksHold: r.lt.filter(([t]) => t >= r.tHold && t <= r.tRel).map(([t, d]) => [t - Math.round(r.tHold), d]),
      longTasksDrop: r.lt.filter(([t]) => t > r.tRel && t <= r.tRel + 4400).map(([t, d]) => [t - Math.round(r.tRel), d]),
      longTasksStage: r.lt.filter(([t]) => t > r.tRel + 4400).map(([t, d]) => [t - Math.round(r.tRel), d]),
      visCalls: r.visCalls.join(','), heapBeforeHoldMB: +(heap0 / 1048576).toFixed(2), heapOnStageMB: +(heap1 / 1048576).toFixed(2), errors: errs,
    };
    out.push(res);
    console.log(JSON.stringify({ run, stage: res.stage, drop: res.dropWindow && { fps: res.dropWindow.fps, max: res.dropWindow.max, over20: res.dropWindow.over20 }, kit: res.kitReadyAfterHoldMs, built: res.bodiesBuiltAfterHoldMs, holdMs: res.holdMs, ff: res.firstFrameAfterReleaseMs, ltH: res.longTasksHold, ltD: res.longTasksDrop, heap: [res.heapBeforeHoldMB, res.heapOnStageMB], relVis: res.releaseToVisibleMs, visCalls: process.env.DELAY ? res.visCalls : undefined, errs }));
    if (thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await b.close();
  }
  if (outF) fs.writeFileSync(outF, JSON.stringify(out, null, 1));
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
