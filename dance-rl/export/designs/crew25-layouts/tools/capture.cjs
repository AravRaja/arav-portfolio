// Muted headless captures of the lab (frozen song clock; no audio is played): node capture.cjs CREW OUTDIR
//   stills: <CREW>_desktop_1920x1080_41.04s.png, <CREW>_desktop_unison_68.50s.png, <CREW>_phone13_390x844@2x_41.04s.png
//   CLIP=1: <CREW>_desktop_clip_38.38-46.38s.mp4 (1920x1080, 30 fps frozen frames, audio muxed afterwards from the mp3)
const { chromium } = require('/Users/aravraja/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs'); const { execFileSync } = require('child_process');
const [crew, outDir] = process.argv.slice(2);
const label = process.env.LABEL || crew;
const open = async (b, w, h, dpr) => {
  const phone = w < 600;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  await p.goto(`http://localhost:${process.env.PORT || 5191}/dance-lab?crew=${crew}&sweep=0&panel=0&t=41.04`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => window.__lab && window.__crew && window.__crew.motion && window.__labThree, null, { timeout: 90000 });
  return p;
};
const shot = async (p, t, path) => { await p.evaluate((t) => window.__lab.freeze(t), t); await p.waitForTimeout(350); await p.screenshot({ path }); };
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  if (!process.env.CLIP) {
    let p = await open(b, 1920, 1080, 1);
    await shot(p, 41.04, `${outDir}/${label}_desktop_1920x1080_41.04s.png`);
    await shot(p, 68.5, `${outDir}/${label}_desktop_unison_68.50s.png`);
    await p.close();
    p = await open(b, 390, 844, 2);
    await shot(p, 41.04, `${outDir}/${label}_phone13_390x844@2x_41.04s.png`);
  } else {
    const p = await open(b, 1920, 1080, 1);
    const tmp = fs.mkdtempSync(`${process.env.TMPDIR || '/tmp'}/clip-${crew}-`);
    const t0 = 38.38, fps = 30, N = 8 * fps;
    for (let k = 0; k < N; k++) {
      const t = t0 + k / fps;
      await p.evaluate((t) => window.__lab.freeze(t, t), t);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await p.screenshot({ path: `${tmp}/f${String(k).padStart(4, '0')}.png` });
    }
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${tmp}/f%04d.png`, '-ss', String(t0), '-t', '8', '-i', '/Users/aravraja/arav-portfolio/public/now-get-busy.mp3',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', `${outDir}/${label}_desktop_clip_38.38-46.38s.mp4`]);
    fs.rmSync(tmp, { recursive: true });
  }
  await b.close();
  console.log('ok', crew);
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
