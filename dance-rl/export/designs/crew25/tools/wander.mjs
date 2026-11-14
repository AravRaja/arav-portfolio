import fs from 'fs';
const R = '/Users/aravraja/arav-portfolio';
const { Rig } = await import(R + '/src/dance/rig.js');
const { CrewMotion } = await import(R + '/src/dance/motion.js');
const header = JSON.parse(fs.readFileSync(R + '/public/dance/finale.json'));
const b = fs.readFileSync(R + '/public/dance/finale.bin');
const rig = new Rig({ header, frames: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) });
const meta = JSON.parse(fs.readFileSync(R + '/public/dance/crew.json'));
const c = new CrewMotion([rig], meta, { mode: 'crew', n: 25 });
// per recipe: root path (mj x, y) at 10 Hz from the drop
const paths = [];
for (let i = 0; i < 25; i++) { const p = []; for (let t = rig.drop; t < 141.5; t += 0.1) { const q = c.sample(i, t, 1); p.push([+q[0].toFixed(4), +q[1].toFixed(4), q[3], q[6]]); } paths.push(p); }
const mx = paths.map((p) => [Math.max(...p.map((v) => Math.abs(v[0]))), Math.max(...p.map((v) => Math.abs(v[1])))]);
console.log('max |x|,|y| per dancer', mx.slice(0, 9).map((v) => v.map((x) => x.toFixed(2)).join('/')).join('  '));
fs.writeFileSync(R.replace('arav-portfolio', 'arav-portfolio') && '/private/tmp/claude-501/-Users-aravraja-arav-portfolio/4ef1b1ad-00ef-4d28-8dbd-efa026d7158a/scratchpad/c25/paths.json', JSON.stringify(paths.map((p) => p.map((v) => [v[0], v[1]]))));
console.log('dur', header.duration, 'n', paths[0].length, 'offsetX', rig.offsetX, rig.offsetY);
