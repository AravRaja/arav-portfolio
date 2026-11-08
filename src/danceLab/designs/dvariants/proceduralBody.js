// Route 2 geometry: a smooth-shaded, human-proportioned body + layered outfit, built in code and skinned
// to its own biped skeleton (roles as in retarget.js), so it is driven by exactly the same retargeter
// as the real rigged characters. Everything is vertex-coloured (flat colours, no textures) and merged
// into one SkinnedMesh = one draw call.
//
// Proportions (metres, bind pose: standing, arms 40 deg out, facing +z): 1.78 m tall, hip joints at
// 0.93 m, thigh 0.42 + shin 0.415 (the MuJoCo humanoid's legs are 0.793 m; the retargeter scales the
// root motion by the ratio, ~1.05, so the feet still plant where the rig's do).
import {
  Bone, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, SphereGeometry, Uint16BufferAttribute, Vector3,
} from 'three';

const ARM_OUT = (40 * Math.PI) / 180;
const v3 = (x, y, z) => new Vector3(x, y, z);

export function skeletonDef() {
  const J = {
    hips: [null, v3(0, 0.975, 0)],
    spine: ['hips', v3(0, 1.05, -0.005)],
    spine1: ['spine', v3(0, 1.17, -0.01)],
    chest: ['spine1', v3(0, 1.31, -0.015)],
    neck: ['chest', v3(0, 1.495, -0.02)],
    head: ['neck', v3(0, 1.585, -0.005)],
  };
  for (const [s, x] of [['l', 1], ['r', -1]]) {
    const dir = v3(x * Math.sin(ARM_OUT), -Math.cos(ARM_OUT), 0);
    const sh = v3(x * 0.185, 1.44, -0.025);
    const el = sh.clone().addScaledVector(dir, 0.29);
    const wr = el.clone().addScaledVector(dir, 0.255);
    Object.assign(J, {
      [`${s}_clav`]: ['chest', v3(x * 0.035, 1.43, -0.01)],
      [`${s}_upperArm`]: [`${s}_clav`, sh],
      [`${s}_foreArm`]: [`${s}_upperArm`, el],
      [`${s}_hand`]: [`${s}_foreArm`, wr],
      [`${s}_thigh`]: ['hips', v3(x * 0.095, 0.93, 0)],
      [`${s}_calf`]: [`${s}_thigh`, v3(x * 0.1, 0.51, 0.005)],
      [`${s}_foot`]: [`${s}_calf`, v3(x * 0.105, 0.095, -0.01)],
      [`${s}_toe`]: [`${s}_foot`, v3(x * 0.108, 0.03, 0.135)],
    });
  }
  return J;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class BodyBuilder {
  constructor() {
    this.J = skeletonDef();
    this.names = Object.keys(this.J);
    this.idx = Object.fromEntries(this.names.map((n, i) => [n, i]));
    this.parts = []; // non-indexed { pos, nor, col, si, sw }
    this.tris = 0;
  }

  p(n) { return this.J[n][1].clone(); }

  // push an indexed part: positions[], weights[] (per vertex {role:w}), colours per triangle, indices[]
  _emit(P, Wt, faceCol, index) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(P.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const nor = g.attributes.normal.array;
    const out = { pos: [], nor: [], col: [], si: [], sw: [] };
    for (let f = 0; f < index.length; f += 3) {
      const c = faceCol[f / 3];
      for (let j = 0; j < 3; j++) {
        const i = index[f + j];
        out.pos.push(P[i].x, P[i].y, P[i].z);
        out.nor.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
        out.col.push(c.r, c.g, c.b);
        const e = Object.entries(Wt[i]).filter(([, w]) => w > 1e-3).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const s = e.reduce((a, [, w]) => a + w, 0);
        for (let k = 0; k < 4; k++) {
          out.si.push(e[k] ? this.idx[e[k][0]] : 0);
          out.sw.push(e[k] ? e[k][1] / s : 0);
        }
      }
    }
    this.tris += index.length / 3;
    this.parts.push(out);
  }

  // Loft through rings. ring: { c, t, ref, rx, ry, p (superellipse exp, 2 = ellipse), w | wfn(pt), col,
  // colFn(seg, n) }. capStart / capEnd add rounded domes (or `flat`). n radial segments.
  tube(rings, n = 18, { capStart = 'dome', capEnd = 'dome', domeDepth = 0.6 } = {}) {
    const R = [...rings];
    const dome = (r, sign) => {
      const extra = [];
      const t = r.t.clone().normalize();
      const depth = Math.min(r.rx, r.ry) * domeDepth;
      for (let s = 1; s <= 3; s++) {
        const a = (s / 3) * (Math.PI / 2);
        const k = s === 3 ? 0.02 : Math.cos(a);
        extra.push({ ...r, c: r.c.clone().addScaledVector(t, sign * Math.sin(a) * depth), rx: r.rx * k, ry: r.ry * k });
      }
      return extra;
    };
    if (capStart) R.unshift(...dome(rings[0], -1).reverse());
    if (capEnd) R.push(...dome(rings[rings.length - 1], 1));
    const P = [], Wt = [], faceCol = [], index = [];
    const tmpU = new Vector3(), tmpV = new Vector3();
    R.forEach((r) => {
      const t = r.t.clone().normalize();
      const u = tmpU.copy(r.ref).addScaledVector(t, -r.ref.dot(t)).normalize().clone();
      const v = tmpV.crossVectors(t, u).clone();
      const pe = 2 / (r.p || 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (r.twist || 0);
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = Math.sign(ca) * Math.abs(ca) ** pe, y = Math.sign(sa) * Math.abs(sa) ** pe;
        const pt = r.c.clone().addScaledVector(u, x * r.rx * (r.sx ? r.sx(a) : 1)).addScaledVector(v, y * r.ry);
        if (r.dv) pt.addScaledVector(v, r.dv(a)); // per-angle offset (flattened soles, etc.)
        P.push(pt);
        Wt.push(r.wfn ? r.wfn(pt) : r.w);
      }
    });
    for (let i = 0; i + 1 < R.length; i++) {
      for (let k = 0; k < n; k++) {
        const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + ((k + 1) % n), d = (i + 1) * n + k;
        index.push(a, b, c, a, c, d);
        const ring = R[i + 1].colFn || R[i + 1].col ? R[i + 1] : R[i];
        const col = ring.colFn ? ring.colFn(k, n, i) : ring.col;
        faceCol.push(col, col);
      }
    }
    this._emit(P, Wt, faceCol, index);
  }

  // ellipsoid from a sphere: centre, radii (along basis axes ax, ay, az), weights, colour,
  // keep(unitPoint) to drop triangles (e.g. hair only on the crown)
  ellipsoid(c, r, w, col, { ws = 20, hs = 14, basis = null, keep = null } = {}) {
    const s = new SphereGeometry(1, ws, hs);
    const pos = s.attributes.position, idx = s.index.array;
    const M = basis ? basis.clone() : new Matrix4();
    const P = [], Wt = [], faceCol = [], index = [];
    for (let i = 0; i < pos.count; i++) {
      const u = new Vector3(pos.getX(i) * r[0], pos.getY(i) * r[1], pos.getZ(i) * r[2]);
      P.push(u.applyMatrix4(M).add(c));
      Wt.push(typeof w === 'function' ? w(P[i]) : w);
    }
    for (let f = 0; f < idx.length; f += 3) {
      if (keep) {
        const m = new Vector3();
        for (let j = 0; j < 3; j++) m.add(new Vector3(pos.getX(idx[f + j]), pos.getY(idx[f + j]), pos.getZ(idx[f + j])));
        if (!keep(m.divideScalar(3))) continue;
      }
      index.push(idx[f], idx[f + 1], idx[f + 2]);
      faceCol.push(typeof col === 'function' ? col(P[idx[f]]) : col);
    }
    this._emit(P, Wt, faceCol, index);
  }

  build() {
    const cat = (k) => this.parts.flatMap((p) => p[k]);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(cat('pos'), 3));
    g.setAttribute('normal', new Float32BufferAttribute(cat('nor'), 3));
    g.setAttribute('color', new Float32BufferAttribute(cat('col'), 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(cat('si'), 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(cat('sw'), 4));
    // bones: local position = joint - parent joint, no bind rotation
    const bones = this.names.map((n) => { const b = new Bone(); b.name = n; return b; });
    const root = new Group();
    this.names.forEach((n, i) => {
      const [par, p] = this.J[n];
      if (par) { bones[i].position.copy(p).sub(this.J[par][1]); bones[this.idx[par]].add(bones[i]); }
      else { bones[i].position.copy(p); root.add(bones[i]); }
    });
    return { geometry: g, bones, root };
  }
}

// ---------- body parts ----------
const C = (h) => new Color(h);

export function buildDancer(o) {
  const B = new BodyBuilder();
  const p = (n) => B.p(n);
  const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);
  const skin = C(o.skin), hair = C(o.hair);
  const top = C(o.top), topDark = C(o.topCuff || o.top), pants = C(o.pants);
  const shoe = C(o.shoe), sole = C(o.sole), lace = C(o.lace || o.shoe);
  const stripe = o.stripe ? C(o.stripe) : null;
  const baggy = o.baggy ?? 1; // trouser width factor
  const ovs = o.oversize ?? 1; // top width factor

  // --- head, face, hair, neck
  const hc = v3(0, 1.675, 0.012);
  B.ellipsoid(hc, [0.083, 0.106, 0.096], { head: 1 }, skin, { ws: 24, hs: 16 });
  B.ellipsoid(v3(0, 1.655, 0.103), [0.016, 0.026, 0.02], { head: 1 }, skin, { ws: 10, hs: 6 }); // nose
  for (const x of [1, -1]) B.ellipsoid(v3(x * 0.083, 1.668, 0.0), [0.014, 0.03, 0.022], { head: 1 }, skin, { ws: 10, hs: 6 });
  if (o.hairStyle !== 'none') {
    // short crop: a shell over the crown and the back, down to the nape
    B.ellipsoid(hc.clone().add(v3(0, 0.006, -0.006)), [0.089, 0.112, 0.1], { head: 1 }, hair, {
      ws: 24, hs: 16, keep: (u) => u.y > 0.25 - 0.55 * Math.max(0, -u.z) || (u.z < -0.35 && u.y > -0.45),
    });
  }
  B.tube([
    { c: v3(0, 1.43, -0.02), t: Y, ref: X, rx: 0.056, ry: 0.052, w: { chest: 1 }, col: skin },
    { c: v3(0, 1.52, -0.02), t: Y, ref: X, rx: 0.05, ry: 0.048, w: { neck: 1 }, col: skin },
    { c: v3(0, 1.6, -0.01), t: Y, ref: X, rx: 0.048, ry: 0.046, w: { head: 1 }, col: skin },
  ], 14, { capStart: false, capEnd: false });

  // --- torso garment (hoodie / jacket / tee): boxy superellipse rings, hips -> shoulders
  const trunkW = (pt) => {
    const y = pt.y;
    const w = {};
    const a = smooth(0.96, 1.1, y), b = smooth(1.12, 1.24, y), c = smooth(1.26, 1.38, y);
    w.hips = 1 - a;
    w.spine = a * (1 - b);
    w.spine1 = b * (1 - c);
    w.chest = c;
    // shoulder corners follow the upper arm a little
    const side = pt.x > 0 ? 'l' : 'r';
    const sh = smooth(1.33, 1.45, y) * smooth(0.11, 0.2, Math.abs(pt.x)) * 0.55;
    if (sh > 0) { for (const k of Object.keys(w)) w[k] *= 1 - sh; w[`${side}_upperArm`] = sh; }
    return w;
  };
  // the hem stays at/above the hip joints: lower and the thighs poke through it when they swing
  const hemY = o.topLength === 'cropped' ? 1.0 : o.topLength === 'long' ? 0.905 : 0.935;
  const tr = (y, rx, rz, extra = {}) => ({ c: v3(0, y, -0.015 + (extra.dz || 0)), t: Y, ref: X, rx: rx * ovs, ry: rz * ovs, p: extra.p || 2.7, wfn: trunkW, col: extra.col || top, colFn: extra.colFn });
  const zipFn = null;
  const trunkRings = [
    tr(hemY - 0.01, 0.185, 0.125, { col: topDark }),
    tr(hemY + 0.035, 0.188, 0.128, { col: topDark }),
    tr(hemY + 0.05, 0.186, 0.127, { colFn: zipFn }),
    tr(1.06, 0.18, 0.124, { colFn: zipFn }),
    tr(1.18, 0.182, 0.128, { colFn: zipFn }),
    tr(1.3, 0.195, 0.132, { colFn: zipFn }),
    tr(1.39, 0.205, 0.125, { colFn: zipFn }),
    tr(1.45, 0.19, 0.105, { p: 2.3, colFn: zipFn }),
    tr(1.485, 0.12, 0.08, { p: 2.0 }),
  ];
  B.tube(trunkRings, 36, { capStart: false, capEnd: false });
  if (o.zip) {
    // zip: a thin ribbon on the front of the jacket, hem -> collar
    B.tube(trunkRings.slice(1, -1).map((r) => ({
      ...r, c: r.c.clone().setZ(r.c.z + r.ry + 0.003), rx: 0.006, ry: 0.003, p: 2, col: C(o.zip), colFn: null,
    })), 6, { capStart: false, capEnd: false });
  }
  // crew neck / collar ring
  B.tube([
    { c: v3(0, 1.47, -0.018), t: Y, ref: X, rx: 0.075 * ovs, ry: 0.066 * ovs, wfn: trunkW, col: topDark },
    { c: v3(0, 1.495, -0.018), t: Y, ref: X, rx: 0.062, ry: 0.058, w: { chest: 0.6, neck: 0.4 }, col: topDark },
    ...(o.zip ? [{ c: v3(0, 1.545, -0.02), t: Y, ref: X, rx: 0.06, ry: 0.057, w: { chest: 0.3, neck: 0.7 }, col: topDark }] : []),
  ], 18, { capStart: false, capEnd: false });

  if (o.hood) {
    // hood down: a soft roll lying around the back of the neck and on the shoulders
    const rings = [];
    for (let s = 0; s <= 10; s++) {
      const a = Math.PI * (-0.1 + 1.2 * (s / 10)); // from front-left round the back to front-right
      const c = v3(Math.cos(a) * 0.095 * ovs, 1.475 + 0.035 * Math.sin(a) ** 2, -0.02 - Math.sin(a) * 0.075 * ovs);
      const t = v3(-Math.sin(a), 0, -Math.cos(a));
      rings.push({ c, t, ref: Y, rx: 0.04 + 0.025 * Math.sin(a) ** 2, ry: 0.03 + 0.012 * Math.sin(a), w: { chest: 0.8, neck: 0.2 }, col: top });
    }
    B.tube(rings, 12);
  }
  if (o.pocket) {
    // kangaroo pocket: a shallow slab across the belly
    const z = (0.127 * ovs) - 0.015 + 0.006;
    B.tube([-0.11, -0.04, 0.04, 0.11].map((x, i) => ({
      c: v3(x, 1.0 + (hemY - 0.9), z), t: X, ref: Y, rx: i === 0 || i === 3 ? 0.05 : 0.06, ry: 0.012, p: 4, wfn: trunkW, col: topDark,
    })), 10, { capStart: 'dome', capEnd: 'dome', domeDepth: 0.3 });
  }
  if (o.strings) {
    for (const x of [0.035, -0.035]) {
      B.tube([
        { c: v3(x, 1.465, 0.095 * ovs), t: v3(0, -1, 0.15), ref: X, rx: 0.006, ry: 0.006, w: { chest: 1 }, col: C(o.strings) },
        { c: v3(x * 1.15, 1.34, 0.125 * ovs), t: v3(0, -1, 0.15), ref: X, rx: 0.006, ry: 0.006, w: { chest: 1 }, col: C(o.strings) },
      ], 6);
    }
  }

  // --- arms: sleeve shoulder -> cuff, then the hand
  for (const [s, x] of [['l', 1], ['r', -1]]) {
    const ua = `${s}_upperArm`, fa = `${s}_foreArm`, hd = `${s}_hand`;
    const sh = p(ua), el = p(fa), wr = p(hd);
    const d = el.clone().sub(sh).normalize();
    const out = v3(x * Math.cos(ARM_OUT), Math.sin(ARM_OUT), 0); // the outside of the arm
    const at = (q, f) => q.clone().addScaledVector(d, f);
    const sleeveCol = stripe ? (k, n) => (k === n - 1 || k === 0 ? stripe : top) : null;
    const short = o.sleeves === 'short';
    const sl = [
      { c: at(sh, -0.035), rx: 0.072 * ovs, ry: 0.07 * ovs, w: { chest: 0.55, [ua]: 0.45 } },
      { c: at(sh, 0.04), rx: 0.068 * ovs, ry: 0.064 * ovs, w: { chest: 0.15, [ua]: 0.85 } },
      { c: at(sh, 0.14), rx: 0.06 * ovs, ry: 0.058 * ovs, w: { [ua]: 1 } },
    ];
    if (short) {
      sl.push({ c: at(sh, 0.17), rx: 0.062 * ovs, ry: 0.06 * ovs, w: { [ua]: 1 }, col: topDark });
    } else {
      sl.push(
        { c: at(el, -0.05), rx: 0.054 * ovs, ry: 0.052 * ovs, w: { [ua]: 0.85, [fa]: 0.15 } },
        { c: el.clone(), rx: 0.052 * ovs, ry: 0.05 * ovs, w: { [ua]: 0.5, [fa]: 0.5 } },
        { c: at(el, 0.05), rx: 0.05 * ovs, ry: 0.048 * ovs, w: { [ua]: 0.15, [fa]: 0.85 } },
        { c: at(wr, -0.1), rx: 0.046 * ovs, ry: 0.043 * ovs, w: { [fa]: 1 } },
        { c: at(wr, -0.05), rx: 0.044 * ovs, ry: 0.041 * ovs, w: { [fa]: 1 }, col: topDark },
        { c: at(wr, -0.01), rx: 0.04, ry: 0.037, w: { [fa]: 0.8, [hd]: 0.2 }, col: topDark },
      );
    }
    B.tube(sl.map((r) => ({ t: d, ref: out, col: top, colFn: r.col ? null : sleeveCol, ...r })), 18, { capStart: 'dome', capEnd: false });
    if (short) {
      // bare forearm: elbow -> wrist in skin
      B.tube([
        { c: at(sh, 0.15), rx: 0.045, ry: 0.043, w: { [ua]: 1 } },
        { c: at(el, -0.04), rx: 0.042, ry: 0.04, w: { [ua]: 0.85, [fa]: 0.15 } },
        { c: el.clone(), rx: 0.041, ry: 0.038, w: { [ua]: 0.5, [fa]: 0.5 } },
        { c: at(el, 0.05), rx: 0.04, ry: 0.037, w: { [ua]: 0.15, [fa]: 0.85 } },
        { c: at(wr, -0.04), rx: 0.03, ry: 0.025, w: { [fa]: 1 } },
        { c: at(wr, 0.0), rx: 0.03, ry: 0.024, w: { [fa]: 0.6, [hd]: 0.4 } },
      ].map((r) => ({ t: d, ref: out, col: skin, ...r })), 14, { capStart: false, capEnd: false });
    }
    // wrist: closes the open cuff so the stage never shows through the sleeve
    B.tube([
      { c: at(wr, -0.07), rx: 0.034, ry: 0.03, w: { [fa]: 1 } },
      { c: at(wr, 0.0), rx: 0.03, ry: 0.025, w: { [fa]: 0.5, [hd]: 0.5 } },
      { c: at(wr, 0.03), rx: 0.03, ry: 0.024, w: { [hd]: 1 } },
    ].map((r) => ({ t: d, ref: out, col: skin, ...r })), 12, { capStart: 'dome', capEnd: false });
    // hand: a mitten (palm + fingers) and a thumb, palm facing the thigh
    const hb = new Matrix4().makeBasis(out.clone(), d.clone().negate(), Z.clone()); // x across the palm normal, y up the arm
    B.ellipsoid(at(wr, 0.055), [0.022, 0.06, 0.042], { [hd]: 1 }, skin, { ws: 14, hs: 10, basis: hb });
    B.ellipsoid(at(wr, 0.035).addScaledVector(Z, 0.035).addScaledVector(out, -0.008), [0.014, 0.03, 0.014], { [hd]: 1 }, skin, { ws: 8, hs: 6, basis: hb });
  }

  // --- trousers: seat + two legs
  const hipJ = { l: p('l_thigh'), r: p('r_thigh') };
  const seatW = () => ({ hips: 1 });
  B.tube([
    { c: v3(0, 1.02, -0.015), t: Y, ref: X, rx: 0.172 * Math.min(1.08, baggy), ry: 0.118, p: 2.6, wfn: seatW, col: pants },
    { c: v3(0, 0.95, -0.012), t: Y, ref: X, rx: 0.178 * Math.min(1.08, baggy), ry: 0.122, p: 2.6, wfn: seatW, col: pants },
    { c: v3(0, 0.88, -0.006), t: Y, ref: X, rx: 0.155 * Math.min(1.08, baggy), ry: 0.112, p: 2.4, wfn: seatW, col: pants },
  ].reverse(), 24, { capStart: 'dome', capEnd: false, domeDepth: 0.35 });
  if (o.belt) {
    B.tube([
      { c: v3(0, 1.01, -0.015), t: Y, ref: X, rx: 0.176, ry: 0.122, p: 2.6, w: { hips: 1 }, col: C(o.belt) },
      { c: v3(0, 1.04, -0.015), t: Y, ref: X, rx: 0.175, ry: 0.121, p: 2.6, w: { hips: 1 }, col: C(o.belt) },
    ], 24, { capStart: false, capEnd: false });
  }
  for (const [s, x] of [['l', 1], ['r', -1]]) {
    const th = `${s}_thigh`, cf = `${s}_calf`, ft = `${s}_foot`;
    const hip = hipJ[s], kn = p(cf), an = p(ft);
    const dt = kn.clone().sub(hip).normalize(), ds = an.clone().sub(kn).normalize();
    const out = v3(x, 0, 0);
    const legCol = stripe ? (k, n) => (k === n - 1 || k === 0 ? stripe : pants) : null;
    const b = baggy;
    const L = [
      { c: hip.clone().addScaledVector(dt, -0.03), t: dt, rx: 0.088 * b, ry: 0.09 * b, w: { hips: 0.7, [th]: 0.3 } },
      { c: hip.clone().addScaledVector(dt, 0.07), t: dt, rx: 0.09 * b, ry: 0.092 * b, w: { hips: 0.25, [th]: 0.75 } },
      { c: hip.clone().addScaledVector(dt, 0.2), t: dt, rx: 0.088 * b, ry: 0.09 * b, w: { [th]: 1 } },
      { c: kn.clone().addScaledVector(dt, -0.07), t: dt, rx: 0.074 * b, ry: 0.076 * b, w: { [th]: 0.9, [cf]: 0.1 } },
      { c: kn.clone(), t: dt.clone().add(ds), rx: 0.07 * b, ry: 0.072 * b, w: { [th]: 0.5, [cf]: 0.5 } },
      { c: kn.clone().addScaledVector(ds, 0.07), t: ds, rx: 0.068 * b, ry: 0.07 * b, w: { [th]: 0.1, [cf]: 0.9 } },
      { c: kn.clone().addScaledVector(ds, 0.2), t: ds, rx: 0.066 * b, ry: 0.068 * b, w: { [cf]: 1 } },
      { c: an.clone().addScaledVector(ds, -0.07), t: ds, rx: (o.taper ? 0.05 : 0.064) * b, ry: (o.taper ? 0.05 : 0.066) * b, w: { [cf]: 0.9, [ft]: 0.1 } },
      { c: an.clone().addScaledVector(ds, -0.01), t: ds, rx: (o.taper ? 0.047 : 0.066) * b, ry: (o.taper ? 0.047 : 0.068) * b, w: { [cf]: 0.6, [ft]: 0.4 }, col: o.cuff ? C(o.cuff) : pants },
    ];
    B.tube(L.map((r) => ({ ref: out, col: pants, colFn: r.col ? null : legCol, ...r })), 20, { capStart: false, capEnd: false });
    // sock / ankle: closes the trouser hem above the trainer
    B.tube([
      { c: an.clone().addScaledVector(ds, -0.09), rx: 0.05, ry: 0.05, w: { [cf]: 1 } },
      { c: an.clone().addScaledVector(ds, 0.0), rx: 0.045, ry: 0.045, w: { [cf]: 0.5, [ft]: 0.5 } },
      { c: an.clone().addScaledVector(ds, 0.04), rx: 0.045, ry: 0.045, w: { [ft]: 1 } },
    ].map((r) => ({ t: ds, ref: out, col: C(o.sock || '#f3f4fa'), ...r })), 12, { capStart: 'dome', capEnd: false });
    if (o.cargo) {
      // cargo pocket on the outer thigh
      const c = hip.clone().addScaledVector(dt, 0.25).addScaledVector(out, 0.086 * b);
      B.tube([-0.06, -0.02, 0.03, 0.065].map((f, i) => ({
        c: c.clone().addScaledVector(dt, f), t: dt, ref: Z, rx: i === 0 ? 0.05 : 0.055, ry: 0.018, p: 4, w: { [th]: 1 }, col: i === 0 ? C(o.cargo) : pants,
      })), 10, { domeDepth: 0.4 });
    }
    // --- trainer: chunky upper on a thick sole, heel -> toe along the foot
    const f0 = an.clone().setY(0);
    const fz = (z) => f0.clone().add(v3(x * 0.004 * z * 10, 0, z));
    const ch = o.chunky ?? 1;
    const up = [
      { z: -0.085, w: 0.045, y: 0.085, h: 0.055 },
      { z: -0.05, w: 0.055, y: 0.09, h: 0.065 },
      { z: 0.0, w: 0.058, y: 0.085, h: 0.06 },
      { z: 0.07, w: 0.06, y: 0.07, h: 0.045 },
      { z: 0.13, w: 0.056, y: 0.055, h: 0.033 },
      { z: 0.17, w: 0.045, y: 0.05, h: 0.027 },
    ];
    B.tube(up.map((r, i) => ({
      c: fz(r.z).setY(r.y * ch), t: Z, ref: X, rx: r.w * ch, ry: r.h * ch, p: 2.6, w: { [ft]: 1 },
      col: shoe, colFn: i >= 2 && i <= 3 && o.lace ? (k, n) => (k > n * 0.6 && k < n * 0.9 ? lace : shoe) : null,
    })), 18, { capStart: 'dome', capEnd: 'dome', domeDepth: 0.7 });
    // sole: a flat, wide slab
    const soleH = 0.022 * ch;
    B.tube([-0.095, -0.06, 0.0, 0.08, 0.15, 0.185].map((z, i) => ({
      c: fz(z).setY(soleH), t: Z, ref: X, rx: [0.05, 0.062, 0.064, 0.066, 0.06, 0.045][i] * ch, ry: soleH, p: 6, w: { [ft]: 1 }, col: sole,
    })), 18, { capStart: 'dome', capEnd: 'dome', domeDepth: 0.5 });
  }

  // --- hats
  if (o.hat === 'bucket') {
    const hcol = C(o.hatCol);
    const hy = 1.735;
    B.tube([
      { c: v3(0, hy - 0.035, 0.005), rx: 0.175, ry: 0.185, col: hcol },
      { c: v3(0, hy - 0.01, 0.005), rx: 0.13, ry: 0.14, col: hcol },
      { c: v3(0, hy - 0.003, 0.005), rx: 0.098, ry: 0.11, col: hcol },
      { c: v3(0, hy + 0.06, 0.0), rx: 0.092, ry: 0.102, col: hcol },
      { c: v3(0, hy + 0.08, 0.0), rx: 0.08, ry: 0.088, col: hcol },
    ].map((r) => ({ t: Y, ref: X, w: { head: 1 }, ...r })), 26, { capStart: false, capEnd: 'flat', domeDepth: 0.2 });
    // brim underside so it is not see-through
    B.tube([
      { c: v3(0, hy - 0.004, 0.005), rx: 0.098, ry: 0.11 },
      { c: v3(0, hy - 0.037, 0.005), rx: 0.172, ry: 0.182 },
    ].map((r) => ({ t: v3(0, -1, 0), ref: X, w: { head: 1 }, col: hcol.clone().multiplyScalar(0.8), ...r })), 26, { capStart: false, capEnd: false });
  } else if (o.hat === 'cap') {
    const hcol = C(o.hatCol);
    B.ellipsoid(hc.clone().add(v3(0, 0.022, -0.004)), [0.09, 0.098, 0.101], { head: 1 }, hcol, { ws: 24, hs: 14, keep: (u) => u.y > 0.12 });
    B.tube([0.02, 0.08, 0.13].map((dz, i) => ({
      c: v3(0, 1.7 - i * 0.004, 0.085 + dz), t: Z, ref: X, rx: [0.085, 0.08, 0.06][i], ry: 0.007, p: 3, w: { head: 1 }, col: hcol,
    })), 16, { domeDepth: 0.3 });
  }
  return B;
}
