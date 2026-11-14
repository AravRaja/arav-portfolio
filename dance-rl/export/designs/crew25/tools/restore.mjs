import fs from 'fs';
const R = '/Users/aravraja/arav-portfolio';
const { Rig } = await import(R + '/src/dance/rig.js');
const { CrewMotion } = await import(R + '/src/dance/motion.js');
const Live = await import('./motion_live.mjs');
const header = JSON.parse(fs.readFileSync(R + '/public/dance/finale.json'));
const b = fs.readFileSync(R + '/public/dance/finale.bin');
const frames = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const meta = JSON.parse(fs.readFileSync(R + '/public/dance/crew.json'));
const rig = new Rig({ header, frames });
const n = Number(process.argv[2] || 9);
const a = new Live.CrewMotion([rig], meta);
const c = new CrewMotion([rig], meta, { mode: 'crew', n });
let maxd = 0, cnt = 0;
for (let t = rig.drop; t < 141; t += 1 / 60) for (let i = 0; i < 9; i++) {
  const p = Float64Array.from(a.sample(i, t, 1)), q = c.sample(i, t, 1);
  for (let k = 0; k < 28; k++) maxd = Math.max(maxd, Math.abs(p[k] - q[k]));
  cnt++;
}
console.log('n', n, 'samples', cnt, 'max |dq| vs a3f13d5 (dancers 0-8)', maxd);
const t = 41.04;
console.log('41.04 lead', Array.from(c.sample(0, t)).slice(0, 4).map((v) => v.toFixed(4)).join(' '));
console.log(JSON.stringify(c.sched.info));
