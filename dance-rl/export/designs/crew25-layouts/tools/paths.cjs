// export every dancer's root path (MuJoCo x, y at 10 Hz from the drop, crew mode) + rt.k from the lab -> paths.json
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(`http://localhost:${process.env.PORT || 5191}/dance-lab?crew=L4&sweep=0&panel=0&t=41.04`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__crew && window.__crew.motion, null, { timeout: 90000 });
  const r = await p.evaluate(() => { const c = window.__crew, m = c.motion; const P = [];
    for (let i = 0; i < 25; i++) { const a = []; for (let t = 8.37; t < 141.5; t += 0.1) { const q = m.sample(i, t, c.travel); a.push([+q[0].toFixed(4), +q[1].toFixed(4)]); } P.push(a); }
    return { paths: P, k: c.rts.map((r) => r.k), h: c.looks.map((l) => l.height) }; });
  fs.writeFileSync(__dirname + '/paths.json', JSON.stringify(r));
  console.log(r.paths.length, r.paths[0].length, r.k.slice(0, 4));
  await b.close();
})();
