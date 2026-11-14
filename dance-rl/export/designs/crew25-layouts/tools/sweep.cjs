// node sweep.cjs CREW W H DPR candidates.json times -> per candidate: occlusion (worst over times; per-dancer worst),
// heights. candidates: [{ id, slots: [[x,z,yaw,s]...], elevation }]
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [crew, w, h, dpr, cf, ts] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7] || '12.6,41.04,68.5,100.3'];
const phone = w < 600;
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  await p.goto(`http://localhost:${process.env.PORT || 5191}/dance-lab?crew=${crew}&sweep=0&panel=0&t=41.04`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__lab && window.__crew && window.__crew.motion && window.__labThree, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => window.__lab && window.__crew && window.__crew.motion && window.__labThree, null, { timeout: 90000 });
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/occl.js', 'utf8') });
  const C = JSON.parse(fs.readFileSync(cf, 'utf8'));
  for (const c of C) {
    const r = await p.evaluate(async ({ crew, c, ts }) => {
      const u = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /src\/dance\/layouts\.js/.test(n)).pop();
      const M = await import(u);
      const L = M.LAYOUTS[crew];
      L.slots = (portrait, n) => c.slots.slice(0, n);
      if (c.elevation) L.elevation = c.elevation;
      if (!window.__lab) return { err: 'nolab', keys: Object.keys(window).filter((k) => k.startsWith('__')) };
      window.__lab.setCrew('L4'); await new Promise((r) => setTimeout(r, 400));
      window.__lab.setCrew(crew); await new Promise((r) => setTimeout(r, 600));
      const out = { cam: window.__crewCam, at: {} };
      for (const t of ts) { window.__lab.freeze(t); await new Promise((r) => setTimeout(r, 120)); out.at[t] = await window.__occl(0.5); }
      return out;
    }, { crew, c, ts: ts.split(',').map(Number) });
    if (r.err) { console.log(JSON.stringify(r)); continue; }
    const at = Object.values(r.at), n = at[0].occ.length;
    const perD = [...Array(n).keys()].map((i) => Math.max(...at.map((a) => a.occ[i])));
    const z = c.slots.map((s) => s[1]), order = [...Array(n).keys()].sort((a, b) => z[a] - z[b]);
    console.log(JSON.stringify({ id: c.id, el: r.cam.elevation, hfill: +r.cam.hfill.toFixed(2), wfill: +r.cam.wfill.toFixed(2), worst: +Math.max(...perD).toFixed(3),
      worstFront: +Math.max(...order.slice(Math.round(n * 0.4)).map((i) => perD[i])).toFixed(3), meanOcc: +(perD.reduce((a, b) => a + b, 0) / n).toFixed(3),
      over25: perD.filter((o) => o > 0.25).length, minH: Math.min(...at.map((a) => a.minH)), meanH41: r.at['41.04'] ? r.at['41.04'].meanH : null, minH41: r.at['41.04'] ? r.at['41.04'].minH : null }));
  }
  await b.close();
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
