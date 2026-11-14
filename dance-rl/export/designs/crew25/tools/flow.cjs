// Real page flow (dev server), muted: hold space until the bar is full, let go on the drop's hit point (so the drop lands
// right away), stage. Logs the real timing (release, drop, first visible frame, fall-in weights at that moment), then
// pins the song clock + performance.now() and renders frozen frames.
//   node flow.cjs W H DPR OUT [clip]
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [w, h, dpr, out, mode] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6] || ''];
const phone = w < 600;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  p.setDefaultTimeout(120000);
  const errs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/AudioContext|Context Lost/.test(m.text())) { errs.push(m.text().slice(0, 300)); console.log('[console]', m.type(), m.text().slice(0, 300)); } });
  p.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message); });
  await p.goto(process.env.BASE || 'http://localhost:5191/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  if (phone) await p.touchscreen.tap(w / 2, h / 2); else await p.mouse.click(w / 2, h / 2);
  await p.waitForTimeout(800);
  await p.evaluate(async () => {
    const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /audio\/holdSync\.js/.test(n));
    const { holdSync } = await import(u);
    const pu = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /audio\/soundProfile\.js/.test(n));
    const sp = pu ? await import(pu) : null;
    window.__P = sp ? sp.getProfile() : null;
    window.__hs = holdSync; window.__origST = holdSync.songTime; window.__realNow = performance.now.bind(performance);
    // real-time log: release (keyup), drop crossing, first visible frame
    const L = window.__log = { rel: null, drop: null, vis: null };
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' && L.rel === null) L.rel = { at: performance.now(), song: holdSync.songTime() }; }, true);
    const tick = () => {
      const t = holdSync.songTime();
      if (L.drop === null && t !== null && t >= 8.37) L.drop = { at: performance.now(), song: t };
      const el = document.querySelector('.dance-stage');
      if (L.vis === null && el && el.classList.contains('is-visible')) {
        const c = window.__crew, m = c && c.motion;
        const cl = window.__clockLog && window.__clockLog[window.__clockLog.length - 1];
        const ct = cl ? cl[1] : t, from = cl ? cl[2] : 8.37;
        L.vis = { at: performance.now(), song: t, crewT: ct, from, early: window.__danceClock?.early.current ? { ...window.__danceClock.early.current } : null, opacity: getComputedStyle(el).opacity,
          fallIn: m ? c.rts.map((_, i) => +m.fallIn(i, ct, from).toFixed(4)) : null,
          marks: performance.getEntriesByType('mark').filter((k) => k.name.startsWith('dance-stage')).map((k) => [k.name, +k.startTime.toFixed(1)]) };
      }
      const dc = window.__danceClock;
      if (dc && !dc.patched) {
        dc.patched = true; const orig = dc.clock.read.bind(dc.clock); window.__clockLog = [];
        dc.clock.read = () => { const o = orig(); if (window.__clockLog && window.__clockLog.length < 400) window.__clockLog.push([+performance.now().toFixed(2), +o.t.toFixed(5), o.from == null ? null : +o.from.toFixed(5), holdSync.songTime()]); return o; };
      }
      if (L.vis === null || L.drop === null || performance.now() - L.drop.at < 1200) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // hold until full (~3 s natural; it waits looping once armed), then let go just before the hit point
  await p.keyboard.down('Space');
  await p.waitForTimeout(4200);
  const P = await p.evaluate(() => window.__P);
  const bar = P.loopEnd - P.loopStart, hitPos = P.loopStart + ((((P.dropHit - P.loopStart) % bar) + bar) % bar);
  const off = process.env.AFTER_HIT; // off-beat: let go this long after the hit point (the drop waits for the next bar)
  const target = off ? hitPos + Number(off) : hitPos - P.syncLead - 0.03; // heard loop position to let go at
  for (;;) {
    const pos = await p.evaluate(() => window.__hs.songTime());
    let d = target - pos; while (d < 0) d += bar;
    if (d < 0.25) { await p.waitForTimeout(Math.max(0, d * 1000 - 8)); break; }
    await p.waitForTimeout(Math.min(1500, (d - 0.2) * 1000));
  }
  await p.keyboard.up('Space');
  await p.waitForSelector('.dance-stage.is-visible', { timeout: 30000 });
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => {
    const L = window.__log, c = window.__crew;
    return { log: L, profile: window.__P, seed: c && c.planSeed, schedule: c && c.schedule, count: c && c.rts.length,
      releaseToDrop: L.drop && L.rel ? +((L.drop.at - L.rel.at) / 1000).toFixed(3) : null,
      releaseToVisible: L.vis && L.rel ? +((L.vis.at - L.rel.at) / 1000).toFixed(3) : null,
      visibleSongAfterDrop: L.vis ? +(L.vis.crewT - 8.37).toFixed(3) : null, clockLog: window.__clockLog, hitPos: null };
  });
  console.log(JSON.stringify(info));
  if (mode === 'timing') { fs.writeFileSync(`${out}/info.json`, JSON.stringify({ ...info, errors: errs }, null, 1)); await b.close(); return; }
  // ---- frozen from here: song clock + wall clock pinned
  await p.evaluate(() => {
    window.__T = 0; window.__W = window.__realNow();
    window.__hs.songTime = () => window.__T;
    performance.now = () => window.__W;
    // joint speed (deg/s) of every dancer at song time t, exactly as the frame loop poses it (move, fall-in mix with the
    // breathing idle pose); rms + max over the 21 hinges, by central difference over one 60 Hz frame
    window.__speeds = (t, wall) => {
      const c = window.__crew, m = c.motion, rig = m.rigs[0], n = c.rts.length;
      const idle = new Float64Array(28);
      const pose = (i, tt, ww) => {
        const q = Float64Array.from(m.sample(i, tt, c.travel));
        const f = m.fallIn(i, tt, window.__from);
        if (f < 1) m.mix(q, rig.idlePose(ww + i * 0.41, false, idle), 1 - f);
        return q;
      };
      const dt = 1 / 60, R = 180 / Math.PI;
      return Array.from({ length: n }, (_, i) => {
        const a = pose(i, t - dt / 2, wall - dt / 2), b2 = pose(i, t + dt / 2, wall + dt / 2);
        let ss = 0, mx = 0;
        for (let k = 7; k < 28; k++) { const v = Math.abs(b2[k] - a[k]) / dt * R; ss += v * v; mx = Math.max(mx, v); }
        const ia = rig.idlePose(wall - dt / 2 + i * 0.41, false, new Float64Array(28)), ib = rig.idlePose(wall + dt / 2 + i * 0.41, false, new Float64Array(28));
        let si = 0; for (let k = 7; k < 28; k++) { const v = Math.abs(ib[k] - ia[k]) / dt * R; si += v * v; }
        return { i, fallIn: +m.fallIn(i, t, window.__from).toFixed(3), rms: +Math.sqrt(ss / 21).toFixed(1), max: +mx.toFixed(1), idleRms: +Math.sqrt(si / 21).toFixed(2), move: c.assign(t)[i].move };
      });
    };
  });
  const toST = (t) => (t >= 8.37 ? t : hitPos - (8.37 - t)); // the crew's song time -> what holdSync reports
  const shot = async (t, path, opts = {}) => {
    const r = await p.evaluate(([t, o]) => {
      window.__T = t; window.__W = o.wall != null ? o.wall : window.__W + 1000 / 30;
      const R = window.__simReveal;
      if (o.reveal !== undefined && R) { R.sweep = 'done'; R.r = o.reveal; }
      const el = document.querySelector('.dance-stage');
      if (o.opacity !== undefined) { el.style.transition = 'none'; el.style.opacity = String(o.opacity); }
      const cv = document.querySelector('.dance-stage-canvas canvas');
      if (o.scale !== undefined && cv) { cv.style.transition = 'none'; cv.style.transform = `scale(${o.scale})`; }
      return window.__W;
    }, [toST(t), opts]);
    await p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    await p.screenshot(path ? { path, ...(opts.clip ? { clip: opts.clip } : {}) } : {});
    return r;
  };
  const tv = info.log.vis.crewT;
  await p.evaluate((f) => { window.__from = f; }, info.log.vis.from);
  // joint-speed trace (rms over the hinges, deg/s) of dancers 0 and 1 from the first visible frame to drop + 0.8 s
  info.trace = await p.evaluate(([a, b]) => {
    const out = [];
    for (let t = a; t <= b; t += 1 / 60) { const s = window.__speeds(t, 100 + t); out.push([+t.toFixed(4), s[0].rms, s[1].rms, s[0].fallIn, s[1].fallIn]); }
    return out;
  }, [tv, 8.37 + 0.8]);
  const first = [];
  for (const [k, dtv] of [[0, 0], [1, 0.25], [2, 0.5]]) {
    const t = tv + dtv;
    const wall = await shot(t, `${out}/first_${k}.png`, { reveal: null });
    const sp = await p.evaluate(([t, wall]) => window.__speeds(t, wall / 1000), [t, wall]);
    first.push({ t: +t.toFixed(4), dt: dtv, speeds: sp });
  }
  info.first = first;
  // the reveal at 50%, frozen at 41.04 s (no stats block), and the caption crop
  await shot(41.04, `${out}/reveal_50_41.04s.png`, { reveal: 0.5 });
  await shot(41.04, `${out}/still_41.04s.png`, { reveal: null });
  info.unisonAt = await p.evaluate(() => { const c = window.__crew; const out = {}; for (const t of [8.2, 8.37, 8.5, 9.0, 10.0]) { const a = c.assign(t); out[t] = [...new Set(a.map((x) => `${x.u}${x.mir ? 'M' : ''}`))]; } return out; });
  const cap = await p.evaluate(() => { const r = document.querySelector('.dancer-caption').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: document.querySelector('.dancer-caption').textContent, vw: innerWidth, centreOffset: +((r.x + r.width / 2) - innerWidth / 2).toFixed(2), statsEls: document.querySelectorAll('.sim-reveal-stats').length, tagEls: document.querySelectorAll('.dancer-caption-tag').length, simTags: document.querySelectorAll('.sim-reveal-tag').length, simLabel: document.querySelector('.sim-reveal-label')?.textContent }; });
  info.caption = cap;
  const pad = 14;
  await p.screenshot({ path: `${out}/caption_crop.png`, clip: { x: Math.max(0, cap.x - pad * 3), y: cap.y - pad, width: Math.min(w, cap.w + pad * 6), height: cap.h + pad * 2 } });
  if (mode === 'clip') {
    // 6 s from the release, 30 fps. The stage's fade / scale-in are replayed from the real first-visible time (CSS ease
    // 0.5 s / cubic-bezier(0.2, 0.8, 0.2, 1) 0.6 s), and the auto-sweep is armed 0.9 s after it, as on the page.
    const t0 = info.log.vis.crewT - info.releaseToVisible; // the crew's song time at the release (pre-drop: loop-mapped)
    const W0 = await p.evaluate(() => window.__W);
    const bez = (x1, y1, x2, y2) => (x) => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; const bx = 3 * x1 * m * (1 - m) ** 2 + 3 * x2 * m * m * (1 - m) + m ** 3; if (bx < x) lo = m; else hi = m; } const m = (lo + hi) / 2; return 3 * y1 * m * (1 - m) ** 2 + 3 * y2 * m * m * (1 - m) + m ** 3; };
    const ease = bez(0.25, 0.1, 0.25, 1), easeS = bez(0.2, 0.8, 0.2, 1);
    const tvis = info.log.vis.crewT;
    await p.evaluate(([W0, tvis, t0]) => { const R = window.__simReveal; R.r = null; R.sweep = 'armed'; R.sweepT0 = W0 + (tvis - t0) * 1000 + 900; }, [W0, tvis, t0]);
    fs.mkdirSync(`${out}/clip`, { recursive: true });
    for (let k = 0; k < 360; k++) {
      const t = t0 + k / 30, a = t - tvis;
      const op = a < 0 ? 0 : a >= 0.5 ? 1 : ease(a / 0.5), sc = a < 0 ? 0.965 : a >= 0.6 ? 1 : 0.965 + 0.035 * easeS(a / 0.6);
      await shot(t, `${out}/clip/f${String(k).padStart(4, '0')}.png`, { wall: W0 + (t - t0) * 1000, opacity: op, scale: sc });
    }
    info.clip = { t0: +t0.toFixed(4), t1: +(t0 + 12).toFixed(4) };
  }
  info.errors = errs;
  fs.writeFileSync(`${out}/info.json`, JSON.stringify(info, null, 1));
  console.log('done', JSON.stringify(info.first.map((f) => [f.t, Math.min(...f.speeds.map((s) => s.rms)), Math.min(...f.speeds.map((s) => s.fallIn))])));
  await b.close();
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
