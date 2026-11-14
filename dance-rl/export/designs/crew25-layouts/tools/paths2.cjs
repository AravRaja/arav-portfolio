// every dancer's hips path in its own slot frame (stage metres, from __crew.track: the real rig + retargeter, 10 Hz,
// drop -> 141.5 s, crew mode), so a slot's root path = slot + Ry(yaw) * local -> paths_local.json
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--use-angle=metal'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(`http://localhost:5191/dance-lab?crew=L4&sweep=0&panel=0&t=41.04`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => window.__crew && window.__crew.motion, null, { timeout: 90000 });
  const r = await p.evaluate(() => { const c = window.__crew, tr = c.track(8.37, 141.5, 10);
    return tr.map((d, i) => { const [x, z, yaw] = c.slots[i]; const cs = Math.cos(yaw * Math.PI / 180), sn = Math.sin(yaw * Math.PI / 180);
      return d.root.map(([wx, , wz]) => { const dx = wx - x, dz = wz - z; return [+(cs * dx - sn * dz).toFixed(4), +(sn * dx + cs * dz).toFixed(4)]; }); }); });
  fs.writeFileSync(__dirname + '/paths_local.json', JSON.stringify(r));
  console.log(r.length, r[0].length, r[1][300]);
  await b.close();
})();
