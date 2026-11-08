import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bone, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4,
  MeshLambertMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from 'three';
import { MJ_TO_THREE } from '../rig.js';
import { BlobShadow, YELLOW } from './common.jsx';

// D. Low-poly character: a faceted, flat-shaded person (hoodie, trousers, trainers, DJ headphones)
// built procedurally here (no third-party model, so no licence to track) and skinned to the same 16
// MuJoCo bodies: one bone per body, posed by the same forward kinematics as every other design.
// Rings shared between two bones are weighted to both, so knees, elbows, shoulders and the waist
// bend like a sleeve instead of breaking apart. One draw call (+ the contact shadow).
const C = {
  hoodie: new Color('#f3f4fa'),
  trousers: new Color('#14183a'),
  skin: new Color('#e9d9c8'),
  hair: new Color('#1b1d2e'),
  shoe: new Color('#ffffff'),
  sole: new Color(YELLOW),
  phones: new Color('#14183a'),
  cups: new Color(YELLOW),
};

function builder(rig) {
  // bind pose: every hinge at 0, torso at the origin
  const q = new Float64Array(28);
  q[3] = 1;
  rig.offsetX = 0; rig.offsetY = 0;
  rig.fk(q);
  const W = rig.world.map((m) => m.clone());
  const I = rig.index;
  const pos = [], col = [], si = [], sw = [];
  const pt = (body, local) => new Vector3(...local).applyMatrix4(W[I[body]]);
  const axis = (body, local) => new Vector3(...local).transformDirection(W[I[body]]);

  const pushV = (p, c, w) => {
    pos.push(p.x, p.y, p.z);
    col.push(c.r, c.g, c.b);
    const e = Object.entries(w).slice(0, 4);
    const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0];
    e.forEach(([b, v], k) => { idx[k] = I[b]; wt[k] = v; });
    const s = wt.reduce((a, b) => a + b, 0);
    si.push(...idx);
    sw.push(...wt.map((v) => v / s));
  };
  const tri = (a, b, c, color) => { pushV(a.p, color, a.w); pushV(b.p, color, b.w); pushV(c.p, color, c.w); };

  // ring: { c: centre, t: tangent, ref: a direction across, rx, ry, w: weights, color }
  const ringVerts = (r, n) => {
    const t = r.t.clone().normalize();
    const u = r.ref.clone().sub(t.clone().multiplyScalar(r.ref.dot(t))).normalize();
    const v = new Vector3().crossVectors(t, u);
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (r.twist || 0);
      out.push({ p: r.c.clone().addScaledVector(u, Math.cos(a) * r.rx).addScaledVector(v, Math.sin(a) * r.ry), w: r.w });
    }
    return out;
  };
  const loft = (rings, n, { capStart = true, capEnd = true } = {}) => {
    const R = rings.map((r) => ringVerts(r, n));
    for (let i = 0; i + 1 < R.length; i++) {
      const color = rings[i + 1].color || rings[i].color;
      for (let k = 0; k < n; k++) {
        const a = R[i][k], b = R[i][(k + 1) % n], c = R[i + 1][(k + 1) % n], d = R[i + 1][k];
        tri(a, b, c, color); tri(a, c, d, color);
      }
    }
    const cap = (ring, r, flip) => {
      const centre = { p: r.c.clone().addScaledVector(r.t.clone().normalize(), flip ? r.capOut || 0 : -(r.capOut || 0)), w: r.w };
      for (let k = 0; k < n; k++) {
        const a = ring[k], b = ring[(k + 1) % n];
        if (flip) tri(centre, a, b, r.color); else tri(centre, b, a, r.color);
      }
    };
    if (capStart) cap(R[0], rings[0], false);
    if (capEnd) cap(R[R.length - 1], rings[rings.length - 1], true);
  };
  // add a primitive's faces (optionally only those whose local centroid passes `keep`)
  const poly = (geo, transform, color, w, keep) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const v = new Vector3();
    for (let k = 0; k < p.count; k += 3) {
      const local = [0, 1, 2].map((j) => v.fromBufferAttribute(p, k + j).clone());
      if (keep && !keep(local[0].clone().add(local[1]).add(local[2]).divideScalar(3))) continue;
      const vs = local.map((l) => ({ p: l.applyMatrix4(transform), w }));
      tri(vs[0], vs[1], vs[2], color);
    }
  };
  return { W, I, pt, axis, loft, poly, out: () => ({ pos, col, si, sw }) };
}

function buildCharacter(rig) {
  const B = builder(rig);
  const { pt, axis, loft, poly } = B;
  const up = axis('torso', [0, 0, 1]);
  const fwd = axis('torso', [1, 0, 0]);

  // trunk: chest -> waist -> hips, octagonal and wider than deep
  loft([
    { c: pt('torso', [0, 0, 0.13]), t: up, ref: fwd, rx: 0.07, ry: 0.1, w: { torso: 1 }, color: C.hoodie, capOut: 0.02 },
    { c: pt('torso', [0, 0, 0.07]), t: up, ref: fwd, rx: 0.115, ry: 0.19, w: { torso: 1 }, color: C.hoodie },
    { c: pt('torso', [-0.005, 0, -0.04]), t: up, ref: fwd, rx: 0.125, ry: 0.175, w: { torso: 1 }, color: C.hoodie },
    { c: pt('torso', [-0.01, 0, -0.15]), t: up, ref: fwd, rx: 0.11, ry: 0.15, w: { torso: 0.7, lower_waist: 0.3 }, color: C.hoodie },
    { c: pt('lower_waist', [0, 0, 0]), t: up, ref: fwd, rx: 0.105, ry: 0.145, w: { lower_waist: 1 }, color: C.hoodie },
    { c: pt('pelvis', [0, 0, 0.07]), t: up, ref: fwd, rx: 0.11, ry: 0.155, w: { lower_waist: 0.4, pelvis: 0.6 }, color: C.hoodie },
    { c: pt('pelvis', [0, 0, 0.035]), t: up, ref: fwd, rx: 0.112, ry: 0.158, w: { pelvis: 1 }, color: C.trousers },
    { c: pt('pelvis', [-0.015, 0, -0.07]), t: up, ref: fwd, rx: 0.11, ry: 0.165, w: { pelvis: 1 }, color: C.trousers, capOut: -0.01 },
  ], 8);

  // neck + head
  loft([
    { c: pt('torso', [0, 0, 0.12]), t: up, ref: fwd, rx: 0.042, ry: 0.042, w: { torso: 1 }, color: C.skin },
    { c: pt('head', [0, 0, -0.06]), t: up, ref: fwd, rx: 0.04, ry: 0.04, w: { head: 1 }, color: C.skin },
  ], 6, { capStart: false, capEnd: false });
  const headM = new Matrix4().copy(B.W[B.I.head]).multiply(new Matrix4().makeScale(1.0, 0.92, 1.08));
  poly(new IcosahedronGeometry(0.105, 1), headM, C.skin, { head: 1 });
  // short hair: a slightly bigger shell over the crown and the back of the head
  poly(new IcosahedronGeometry(0.113, 1), headM, C.hair, { head: 1 }, (c) => c.z > 0.035 - 0.5 * Math.max(0, -c.x) || c.x < -0.06);
  // headphones: band over the top, a cup on each ear
  const bandRings = [];
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * (k / 8);
    const c = pt('head', [-0.005, Math.cos(a) * 0.112, 0.01 + Math.sin(a) * 0.112]);
    const t = axis('head', [0, -Math.sin(a), Math.cos(a)]);
    bandRings.push({ c, t, ref: fwd, rx: 0.018, ry: 0.012, w: { head: 1 }, color: C.phones });
  }
  loft(bandRings, 5);
  for (const s of [1, -1]) {
    const side = axis('head', [0, s, 0]);
    loft([
      { c: pt('head', [0, s * 0.093, 0]), t: side, ref: up, rx: 0.045, ry: 0.04, w: { head: 1 }, color: C.cups },
      { c: pt('head', [0, s * 0.128, 0]), t: side, ref: up, rx: 0.04, ry: 0.035, w: { head: 1 }, color: C.cups },
    ], 8);
  }

  // legs: hip -> thigh -> knee -> calf -> ankle, all trousers
  for (const s of ['left', 'right']) {
    const th = `${s}_thigh`, sh = `${s}_shin`, ft = `${s}_foot`;
    const hip = pt(th, [0, 0, 0.02]), knee = pt(sh, [0, 0, 0.02]), ankle = pt(ft, [0, 0, 0.07]);
    const tThigh = knee.clone().sub(hip), tShin = ankle.clone().sub(knee);
    loft([
      { c: hip, t: tThigh, ref: fwd, rx: 0.088, ry: 0.088, w: { pelvis: 0.35, [th]: 0.65 }, color: C.trousers },
      { c: pt(th, [0, 0, -0.17]), t: tThigh, ref: fwd, rx: 0.078, ry: 0.074, w: { [th]: 1 }, color: C.trousers },
      { c: knee, t: tThigh.clone().add(tShin), ref: fwd, rx: 0.06, ry: 0.058, w: { [th]: 0.5, [sh]: 0.5 }, color: C.trousers },
      { c: pt(sh, [0, 0, -0.13]), t: tShin, ref: fwd, rx: 0.06, ry: 0.056, w: { [sh]: 1 }, color: C.trousers },
      { c: ankle, t: tShin, ref: fwd, rx: 0.05, ry: 0.05, w: { [sh]: 0.55, [ft]: 0.45 }, color: C.trousers },
    ], 7);
    // trainer: a faceted wedge on a yellow sole
    const footM = B.W[B.I[ft]];
    const shoe = [
      [-0.085, -0.05, -0.012], [0.165, -0.05, -0.012], [0.165, 0.05, -0.012], [-0.085, 0.05, -0.012],
      [-0.08, -0.045, 0.075], [0.03, -0.05, 0.06], [0.16, -0.04, 0.025], [0.16, 0.04, 0.025], [0.03, 0.05, 0.06], [-0.08, 0.045, 0.075],
    ].map((v) => new Vector3(...v).applyMatrix4(footM));
    const V = (i) => ({ p: shoe[i], w: { [ft]: 1 } });
    const faces = [[0, 2, 1], [0, 3, 2], [0, 1, 6], [0, 6, 5], [0, 5, 4], [1, 2, 7], [1, 7, 6], [3, 9, 8], [3, 8, 7], [3, 7, 2],
      [0, 4, 9], [0, 9, 3], [4, 5, 8], [4, 8, 9], [5, 6, 7], [5, 7, 8]];
    const out = B.out();
    faces.forEach(([a, b, c], fi) => {
      const color = fi < 2 ? C.sole : C.shoe; // the first two faces are the bottom
      [V(a), V(b), V(c)].forEach((x) => {
        out.pos.push(x.p.x, x.p.y, x.p.z);
        out.col.push(color.r, color.g, color.b);
        out.si.push(B.I[ft], 0, 0, 0);
        out.sw.push(1, 0, 0, 0);
      });
    });
  }

  // arms: shoulder -> elbow -> wrist in hoodie sleeves, then a hand
  for (const s of ['left', 'right']) {
    const ua = `${s}_upper_arm`, la = `${s}_lower_arm`, hd = `${s}_hand`;
    const sh = pt(ua, [0, 0, 0]), el = pt(la, [0, 0, 0]), wr = pt(hd, [0, 0, 0]);
    const tU = el.clone().sub(sh), tL = wr.clone().sub(el);
    const wrist = el.clone().addScaledVector(tL, 0.8);
    loft([
      { c: sh.clone().addScaledVector(tU, -0.12), t: tU, ref: up, rx: 0.058, ry: 0.058, w: { torso: 0.6, [ua]: 0.4 }, color: C.hoodie, capOut: 0.02 },
      { c: sh.clone().addScaledVector(tU, 0.4), t: tU, ref: up, rx: 0.052, ry: 0.05, w: { [ua]: 1 }, color: C.hoodie },
      { c: el, t: tU.clone().normalize().add(tL.clone().normalize()), ref: up, rx: 0.045, ry: 0.045, w: { [ua]: 0.5, [la]: 0.5 }, color: C.hoodie },
      { c: el.clone().addScaledVector(tL, 0.45), t: tL, ref: up, rx: 0.043, ry: 0.041, w: { [la]: 1 }, color: C.hoodie },
      { c: wrist, t: tL, ref: up, rx: 0.04, ry: 0.038, w: { [la]: 1 }, color: C.hoodie },
    ], 7);
    const handM = new Matrix4().copy(B.W[B.I[hd]]).multiply(new Matrix4().makeScale(1.1, 0.8, 1.15));
    poly(new IcosahedronGeometry(0.046, 0), handM, C.skin, { [hd]: 1 });
  }
  return B;
}

export default function LowPolyCharacter({ rig, clock }) {
  const { root, bones } = useMemo(() => {
    const B = buildCharacter(rig);
    const { pos, col, si, sw } = B.out();
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    geo.computeVertexNormals();
    const root = new Group();
    root.matrixAutoUpdate = false;
    root.matrix.copy(MJ_TO_THREE);
    const bones = rig.bodies.map((b, i) => {
      const bone = new Bone();
      bone.name = b.name;
      bone.matrixAutoUpdate = false;
      bone.matrix.copy(B.W[i]);
      root.add(bone);
      return bone;
    });
    const mesh = new SkinnedMesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
    mesh.frustumCulled = false;
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new Skeleton(bones));
    return { root, bones };
  }, [rig]);

  useFrame(() => {
    const s = clock.read();
    rig.pose(s.t, s);
    for (let i = 0; i < bones.length; i++) bones[i].matrix.copy(rig.world[i]);
    root.updateMatrixWorld(true);
  }, -1);

  return (
    <>
      <hemisphereLight args={['#ffffff', '#2236ff', 1.5]} />
      <directionalLight position={[-2.5, 4, 3.5]} intensity={2.0} />
      <directionalLight position={[3, 1.5, -2]} intensity={0.6} color="#9fb0ff" />
      <primitive object={root} />
      <BlobShadow rig={rig} color="#000a78" opacity={0.65} />
    </>
  );
}
