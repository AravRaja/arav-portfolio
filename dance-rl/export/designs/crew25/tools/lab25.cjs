// node lab25.cjs W H DPR OUTPNG 'query' t1,t2 [jsonOut]
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [w, h, dpr, out, q, ts, jout] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6], process.argv[7] || '41.04', process.argv[8]];
const phone = w < 600;
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  const errs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/AudioContext|Context Lost|GPU stall/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${process.env.PORT || 5191}/dance-lab?crew=L4&sweep=0&panel=0&${q}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__lab && window.__crew && window.__crew.motion && window.__labThree, null, { timeout: 90000 });
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/occl.js', 'utf8') });
  const res = { q, w, h, dpr, errors: errs, at: {} };
  res.cam = await p.evaluate(() => window.__crewCam);
  res.k = await p.evaluate(() => window.__crew.rts.map((r) => +r.k.toFixed(4)));
  res.heights = await p.evaluate(() => window.__crew.looks.map((l) => l.height));
  for (const t of ts.split(',').map(Number)) {
    await p.evaluate((t) => window.__lab.freeze(t), t);
    await p.waitForTimeout(250);
    if (process.env.OCC !== '0') res.at[t] = await p.evaluate((sc) => window.__occl(sc), Number(process.env.SC || 1));
    if (out && out !== '-') await p.screenshot({ path: out.replace('%t', t.toFixed(2)) });
  }
  if (process.env.EVAL) res.eval = await p.evaluate(process.env.EVAL);
  res.errors = errs;
  const js = JSON.stringify(res);
  if (jout) fs.writeFileSync(jout, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ cam: res.cam, k: res.k.slice(0, 3), worst: Object.fromEntries(Object.entries(res.at).map(([t, a]) => [t, [a.worst, a.worstIdx, a.minH, a.meanH]])), errors: errs }));
  await b.close();
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
