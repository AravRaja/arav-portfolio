// node measure.cjs CREW W H DPR OUTPNG(with %t or -) t1,t2,... [jsonOut]   env CHK=1: root-gap + neighbour check over the song
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [crew, w, h, dpr, out, ts, jout] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7] || '41.04', process.argv[8]];
const phone = w < 600;
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  const errs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/AudioContext|Context Lost|GPU stall/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${process.env.PORT || 5191}/dance-lab?crew=${crew}&sweep=0&panel=0&t=${ts.split(',')[0]}${process.env.Q || ''}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__lab && window.__crew && window.__crew.motion && window.__labThree, null, { timeout: 90000 });
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/occl.js', 'utf8') });
  const res = { crew, w, h, dpr, at: {} };
  res.cam = await p.evaluate(() => window.__crewCam);
  res.frame = await p.evaluate(() => { const hd = document.querySelector('.lab-intro') || document.querySelector('header'); const sp = document.querySelector('.lab-space');
    return { headerBottom: Math.max(...[...document.querySelectorAll('header, .lab-intro')].map((e) => e.getBoundingClientRect().bottom)), spaceTop: sp ? sp.getBoundingClientRect().top : null }; });
  for (const t of ts.split(',').map(Number)) {
    await p.evaluate((t) => window.__lab.freeze(t), t);
    await p.waitForTimeout(300);
    if (process.env.OCC !== '0') {
      const a = await p.evaluate(() => window.__occl(1));
      const bb = a.bbox.filter((b) => b[0] < 1e8);
      a.frameTop = Math.min(...bb.map((b) => b[2])); a.frameBottom = Math.max(...bb.map((b) => b[3])); a.frameL = Math.min(...bb.map((b) => b[0])); a.frameR = Math.max(...bb.map((b) => b[1]));
      res.at[t] = a;
    }
    if (out && out !== '-') await p.screenshot({ path: out.replace('%t', t.toFixed(2)) });
  }
  if (process.env.CHK) res.chk = await p.evaluate(fs.readFileSync(__dirname + '/chk.js', 'utf8'));
  res.errors = errs;
  if (jout) fs.writeFileSync(jout, JSON.stringify(res, null, 1));
  const sum = Object.fromEntries(Object.entries(res.at).map(([t, a]) => [t, { worst: a.worst, wi: a.worstIdx, minH: a.minH, meanH: a.meanH, top: a.frameTop, bot: a.frameBottom, l: a.frameL, r: a.frameR }]));
  console.log(JSON.stringify({ crew, w, h, cam: res.cam && { el: res.cam.elevation, dist: +res.cam.dist.toFixed(2), wfill: +res.cam.wfill.toFixed(2), hfill: +res.cam.hfill.toFixed(2) }, frame: res.frame, sum, chk: res.chk, errors: errs }));
  await b.close();
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
