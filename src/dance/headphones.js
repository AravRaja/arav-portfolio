// Over-ear DJ headphones (shared by the lab's D-variants and the crew; pure three.js, usable in a worker).
import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Matrix4, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const YELLOW = '#f0ff18';

// Over-ear DJ headphones around a head, in stage space at the bind pose: `c` head centre, `r` half
// width of the head (ear to ear), `up`/`side` unit axes. Returns one merged, vertex-coloured geometry.
export function headphonesGeometry({ c, r, up = new Vector3(0, 1, 0), side = new Vector3(1, 0, 0), band = '#14183a', cups = YELLOW, scale = 1 }) {
  const parts = [];
  const paint = (g, col) => {
    const cc = new Color(col);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new Float32BufferAttribute(a, 3));
    if (g.index) g = g.toNonIndexed();
    return g;
  };
  const fwd = new Vector3().crossVectors(side, up).normalize();
  const basis = new Matrix4().makeBasis(side, up, fwd);
  const place = (g, local) => g.applyMatrix4(new Matrix4().multiplyMatrices(new Matrix4().setPosition(c), basis).multiply(local));
  const R = r * 1.12 * scale;
  // band: half torus over the crown (in the side/up plane)
  const bandG = new TorusGeometry(R, 0.012 * scale, 8, 28, Math.PI);
  parts.push(paint(place(bandG, new Matrix4().makeTranslation(0, r * 0.05, 0)), band));
  // cups: short cylinders on the ears, axis along `side`
  for (const s of [1, -1]) {
    const cup = new CylinderGeometry(0.045 * scale, 0.05 * scale, 0.04 * scale, 20, 1);
    const m = new Matrix4().makeTranslation(s * (r + 0.012 * scale), -0.005, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    parts.push(paint(place(cup, m), cups));
    const pad = new SphereGeometry(0.043 * scale, 16, 8);
    const pm = new Matrix4().makeTranslation(s * (r + 0.04 * scale), -0.005, 0).multiply(new Matrix4().makeScale(0.35, 1, 1));
    parts.push(paint(place(pad, pm), cups));
  }
  parts.forEach((g) => { delete g.attributes.uv; });
  const merged = mergeGeometries(parts.map((g) => { const b = new BufferGeometry(); b.setAttribute('position', g.attributes.position); b.setAttribute('normal', g.attributes.normal); b.setAttribute('color', g.attributes.color); return b; }));
  return merged;
}
