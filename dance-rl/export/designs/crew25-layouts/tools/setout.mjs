// node setout.mjs V MODE refined.json  -> out/V-MODE.txt (TABLE) + cams.json elevation
import fs from 'fs';
const [v, mode, f] = process.argv.slice(2);
const r = JSON.parse(fs.readFileSync(f, 'utf8'));
fs.writeFileSync(new URL(`./out/${v}-${mode}.txt`, import.meta.url), `${JSON.stringify({ src: f, result: r.result && { worst: r.result.worst, meanOcc: r.result.meanOcc, meanH: r.result.meanH } })}\nTABLE ${JSON.stringify(r.slots)}\n`);
const C = JSON.parse(fs.readFileSync(new URL('./cams.json', import.meta.url)));
if (mode === 'desktop') C[v].elevation[0] = r.elevation[0]; else C[v].elevation[1] = r.elevation[1];
fs.writeFileSync(new URL('./cams.json', import.meta.url), JSON.stringify(C, null, 1));
