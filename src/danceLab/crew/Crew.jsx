// 9-dancer crew on the music stage (/dance-lab?crew=L1..L4, key L cycles). Procedural toon bodies
// (dvariants/proceduralBody.js) dressed by looks.js, each driven by the shared retargeter from a time-shifted /
// mirrored copy of the exported trajectories (motion.js), placed by layouts.js.
// Draw calls: one skinned mesh per dancer (headphones merged into it, skinned to the head bone) + ONE instanced
// mesh for all 27 contact-shadow blobs = 10.
// `lineup` ('front' | 'back'): the 9 looks in a row in their bind pose (arms 40 deg out), for judging outfits / hair.
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  BufferGeometry, CanvasTexture, Color, DynamicDrawUsage, Float32BufferAttribute, FrontSide, Group, InstancedBufferAttribute,
  InstancedMesh, MeshToonMaterial, Object3D, PlaneGeometry, ShaderMaterial, Skeleton, SkinnedMesh, Vector3,
} from 'three';
import { Retargeter } from '../designs/dvariants/retarget.js';
import { buildDancer, headphoneFit } from '../designs/dvariants/proceduralBody.js';
import { StageLights, addRim, getToonRamp, headphonesGeometry } from '../designs/dvariants/shared.jsx';
import { Rig, loadFinale } from '../rig.js';
import { generateCrew, PALETTE } from './looks.js';
import { CrewMotion } from './motion.js';
import { LAYOUTS } from './layouts.js';

const TEMPLATE_LABEL = { cropHoodie: 'crop hoodie', teeDress: 'tee dress', allblack: 'all black', tee: 'tee + jeans' };

// ---------- one dancer: procedural body (+ headphones merged in) on its own skeleton
function buildCrewDancer(rig, look, materials) {
  const o = look.outfit;
  const B = buildDancer(o);
  let { geometry, bones, root: skelRoot } = B.build();
  let tris = B.tris;
  if (o.headphones) {
    const fit = headphoneFit(o); // sized to the head and the hair under it
    const hp = headphonesGeometry({ c: fit.c, r: fit.r, cups: o.phonesCol || PALETTE.yellow, band: o.bandCol || '#14183a' });
    const n = hp.attributes.position.count;
    const head = B.idx.head;
    const g = new BufferGeometry();
    const cat = (k, extra) => new Float32BufferAttribute(Float32Array.from([...geometry.attributes[k].array, ...extra]), geometry.attributes[k].itemSize);
    g.setAttribute('position', cat('position', hp.attributes.position.array));
    g.setAttribute('normal', cat('normal', hp.attributes.normal.array));
    g.setAttribute('color', cat('color', hp.attributes.color.array));
    const si = new Uint16Array(geometry.attributes.skinIndex.array.length + n * 4);
    si.set(geometry.attributes.skinIndex.array);
    const sw = new Float32Array(si.length);
    sw.set(geometry.attributes.skinWeight.array);
    for (let i = 0, b = geometry.attributes.skinIndex.array.length; i < n; i++) { si[b + i * 4] = head; sw[b + i * 4] = 1; }
    g.setAttribute('skinIndex', new (geometry.attributes.skinIndex.constructor)(si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    geometry = g;
    tris += n / 3;
  }
  const model = new Group();
  model.add(skelRoot);
  const black = o.top === PALETTE.black;
  const mesh = new SkinnedMesh(geometry, black ? materials.black : materials.base);
  mesh.frustumCulled = false;
  model.add(mesh);
  model.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  const rt = new Retargeter(rig, model, (b) => b.name, { keepScale: true });
  const outer = new Group();
  outer.add(model);
  return { outer, model, rt, mesh, tris, look };
}

// ---------- contact shadows: 3 blobs per dancer (feet + hips), one instanced draw call
let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  blobTex = new CanvasTexture(c);
  return blobTex;
}
function makeShadows(n) {
  const geo = new PlaneGeometry(1, 1);
  const op = new InstancedBufferAttribute(new Float32Array(n), 1);
  op.setUsage(DynamicDrawUsage);
  geo.setAttribute('aOpacity', op);
  const mat = new ShaderMaterial({
    uniforms: { map: { value: blobTexture() }, color: { value: new Color('#000a78') } },
    vertexShader: `attribute float aOpacity; varying float vO; varying vec2 vUv;
      void main() { vUv = uv; vO = aOpacity; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vO; varying vec2 vUv;
      void main() { gl_FragColor = vec4(color, texture2D(map, vUv).a * vO);
      #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const m = new InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

// ---------- camera: fit every slot's dance box between the header and the space key
// `elevation` (deg) may be a range [lo, hi]: the angle is then chosen per viewport so the crew fills both the
// width and the height (a deep crowd looked down on fills a tall phone; a lower camera suits 16:9 / 9:16).
const tmpV = new Vector3();
function fitCamera(camera, w, h, boxes, opts) {
  if (!Array.isArray(opts.elevation)) return fitCameraAt(camera, w, h, boxes, opts);
  const [lo, hi] = opts.elevation;
  let best = null;
  for (let el = lo; el <= hi + 1e-6; el += 1) {
    const r = fitCameraAt(camera, w, h, boxes, { ...opts, elevation: el });
    const score = Math.min(r.wfill / (opts.side ?? 0.94), r.hfill);
    if (!best || score > best.score + 0.005) best = { el, score };
  }
  return { ...fitCameraAt(camera, w, h, boxes, { ...opts, elevation: best.el }), elevation: best.el };
}
function fitCameraAt(camera, w, h, boxes, { top, bottom, fov, elevation, side = 0.94, arm = 0.75, wander = 0 }) {
  const pts = [];
  let cx = 0, cz = 0;
  for (const [x, z, s] of boxes) {
    cx += x / boxes.length; cz += z / boxes.length;
    for (const dx of [-arm - wander, arm + wander]) for (const y of [0, 2.05]) for (const dz of [-0.5 - wander, 0.5 + wander]) pts.push(new Vector3(x + dx * s, y * s, z + dz * s));
  }
  const avail = Math.max(120, h - top - bottom);
  const el = (elevation * Math.PI) / 180;
  const look = new Vector3(cx, 0.95, cz);
  camera.fov = fov; camera.near = 0.1; camera.far = 200; camera.aspect = w / h;
  camera.clearViewOffset();
  const bbox = (d) => {
    camera.position.set(look.x, look.y + d * Math.sin(el), look.z + d * Math.cos(el));
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      tmpV.copy(p).project(camera);
      const px = (tmpV.x * 0.5 + 0.5) * w, py = (0.5 - tmpV.y * 0.5) * h;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return [x0, x1, y0, y1];
  };
  let lo = 2, hi = 120;
  for (let k = 0; k < 40; k++) {
    const d = (lo + hi) / 2;
    const [x0, x1, y0, y1] = bbox(d);
    if (x1 - x0 <= side * w && y1 - y0 <= avail) hi = d; else lo = d;
  }
  const [x0, x1, y0, y1] = bbox(hi);
  const dx = w / 2 - (x0 + x1) / 2, dy = top + avail / 2 - (y0 + y1) / 2;
  camera.setViewOffset(w, h, -dx, -dy, w, h);
  camera.updateProjectionMatrix();
  return { dist: hi, ppm: (y1 - y0) / 2.05, wfill: (x1 - x0) / w, hfill: (y1 - y0) / avail, elevation };
}

function CrewCamera({ slots, layout, top, bottom, portrait, lineup }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const L = LAYOUTS[layout];
    const opts = lineup ? { top, bottom, fov: 18, elevation: 4, arm: 0.58, wander: 0, side: 0.98 }
      : { top, bottom, fov: L.fov, elevation: L.elevation[portrait ? 1 : 0], arm: portrait ? (L.armPortrait ?? 0.6) : 0.75,
        wander: (portrait && L.wanderPortrait != null ? L.wanderPortrait : 0.3) * L.travel };
    const r = fitCamera(camera, size.width, size.height, slots.map(([x, z, , s]) => [x, z, s]), opts);
    window.__crewCam = { ...r, w: size.width, h: size.height, top, bottom };
  }, [camera, size.width, size.height, slots, layout, top, bottom, portrait, lineup]);
  return null;
}

// ---------- extra trajectories (public/dance/crew.json)
const META_FALLBACK = { sections: [[0, 6], [6, 8], [8, 14], [14, 16], [16, 20], [20, 26], [26, 28], [28, 32]], sync_units: [0, 6, 8, 14, 16, 20, 26, 28], tracks: [] };
function useCrewRigs(rig) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      let meta = META_FALLBACK;
      try { meta = await (await fetch('/dance/crew.json')).json(); } catch { /* fallback: finale only */ }
      const rigs = [rig];
      for (const tr of meta.tracks || []) {
        try { rigs.push(new Rig(await loadFinale(tr.base))); } catch (e) { console.warn('[crew] track failed', tr.base, e); }
      }
      if (alive) setState({ meta, rigs });
    })();
    return () => { alive = false; };
  }, [rig]);
  return state;
}

export default function Crew({ rig, clock, layout = 'L1', top, bottom, seed = 7, lineup = null }) {
  const { size } = useThree();
  const portrait = size.height > size.width;
  const loaded = useCrewRigs(rig);
  const looks = useMemo(() => generateCrew(seed), [seed]);
  const materials = useMemo(() => ({
    base: addRim(new MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp(), side: FrontSide }), { strength: 0.5, power: 2.6 }),
    black: addRim(new MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp(), side: FrontSide }), { strength: 0.75, power: 2.4 }),
  }), []);
  const dancers = useMemo(() => looks.map((l) => buildCrewDancer(rig, l, materials)), [rig, looks, materials]);
  const shadows = useMemo(() => makeShadows(dancers.length * 3), [dancers]);
  const motion = useMemo(() => (loaded ? new CrewMotion(loaded.rigs, loaded.meta) : null), [loaded]);
  const L = LAYOUTS[layout] || LAYOUTS.L1;
  // a layout may show fewer dancers on a phone (L.mobileCount); the rest are built but not mounted
  const count = lineup ? dancers.length : Math.min(dancers.length, portrait && L.mobileCount ? L.mobileCount : dancers.length);
  const slots = useMemo(() => {
    if (!lineup) return L.slots(portrait).slice(0, count);
    const gap = 1.22; // arm span at the bind pose is ~1.07 m
    return dancers.map((_, i) => [(i - (dancers.length - 1) / 2) * gap, 0, lineup === 'back' ? 180 : 0, 1]);
  }, [L, portrait, lineup, dancers, count]);
  const shown = useMemo(() => dancers.slice(0, count), [dancers, count]);

  useLayoutEffect(() => {
    shown.forEach((d, i) => {
      const [x, z, yaw, s] = slots[i];
      d.outer.position.set(x, 0, z);
      d.outer.rotation.set(0, (yaw * Math.PI) / 180, 0);
      d.outer.scale.setScalar(s * d.look.height);
      d.outer.updateMatrixWorld(true);
    });
  }, [shown, slots]);

  useEffect(() => {
    window.__crew = {
      looks, layout, seed, portrait, count, lineup,
      bodies: looks.map((l) => l.body).join(''),
      tracks: loaded ? loaded.rigs.length : 0,
      describe: (t) => (motion ? dancers.map((_, i) => motion.describe(i, t)) : []),
      // root wander (MuJoCo x / y, m, after `travel`) per dancer over [t0, t1]: sizes the camera's dance box
      wander: (t0 = rig.drop, t1 = 140, dt = 0.05) => (motion ? dancers.map((_, i) => {
        let ax = 0, ay = 0;
        for (let t = t0; t < t1; t += dt) { const q = motion.sample(i, t, L.travel); ax = Math.max(ax, Math.abs(q[0])); ay = Math.max(ay, Math.abs(q[1])); }
        return [+ax.toFixed(2), +ay.toFixed(2)];
      }) : []),
      tris: shown.reduce((a, d) => a + d.tris, 0),
    };
    return () => { delete window.__crew; };
  }, [looks, layout, seed, portrait, loaded, motion, dancers, shown, count, lineup, rig, L]);

  const dummy = useMemo(() => new Object3D(), []);
  const fwd = useMemo(() => new Vector3(), []);
  const tmpP = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const s = clock.read();
    const op = shadows.geometry.attributes.aOpacity;
    if (lineup) { // bind pose: nothing to pose, just the foot / hip blobs under the static skeleton
      shown.forEach((d, i) => {
        ['l_foot', 'r_foot', 'hips'].forEach((role, k) => {
          d.rt.role[role].getWorldPosition(tmpP);
          dummy.position.set(tmpP.x, 0.002 + k * 0.0005, tmpP.z + (k < 2 ? 0.05 : 0));
          dummy.rotation.set(-Math.PI / 2, 0, k < 2 ? Math.PI / 2 : 0);
          dummy.scale.set(k < 2 ? 0.38 : 0.95, k < 2 ? 0.21 : 0.6, 1);
          dummy.updateMatrix();
          shadows.setMatrixAt(i * 3 + k, dummy.matrix);
          op.array[i * 3 + k] = k < 2 ? 0.6 : 0.3;
        });
      });
      for (let j = shown.length * 3; j < op.count; j++) op.array[j] = 0;
      shadows.instanceMatrix.needsUpdate = true;
      op.needsUpdate = true;
      return;
    }
    for (let j = shown.length * 3; j < op.count; j++) op.array[j] = 0;
    shown.forEach((d, i) => {
      if (s.idle || !motion || s.t < rig.drop) {
        rig.pose(s.t, { ...s, clock: s.clock + i * 0.41 });
      } else {
        const q = motion.sample(i, s.t, L.travel);
        rig.offsetX = 0; rig.offsetY = 0;
        rig.fk(q);
      }
      d.rt.update();
      // shadows (dancer-local, then into the stage through the dancer's slot transform)
      const rt = d.rt;
      for (let k = 0; k < 3; k++) {
        let a = 0.65;
        if (k < 2) {
          const side = k ? 'r' : 'l';
          const p = rt.footPos(side);
          rt.footForward(side, fwd);
          const lift = Math.max(0, p.y - rt.ankleRestY(side));
          a *= Math.max(0, 1 - lift / 0.3);
          dummy.position.set(p.x + fwd.x * 0.05, 0.002 + k * 0.0005, p.z + fwd.z * 0.05);
          dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(-fwd.z, fwd.x));
          dummy.scale.set(0.38 * (1 + lift), 0.21 * (1 + lift), 1);
        } else {
          const p = rt.hipsPos();
          a *= 0.55 * Math.max(0.25, Math.min(1, 1.35 - p.y * 0.5));
          dummy.position.set(p.x, 0.001, p.z);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(0.95, 0.6, 1);
        }
        dummy.updateMatrix();
        dummy.matrix.premultiply(d.outer.matrixWorld);
        shadows.setMatrixAt(i * 3 + k, dummy.matrix);
        op.array[i * 3 + k] = a;
      }
    });
    shadows.instanceMatrix.needsUpdate = true;
    op.needsUpdate = true;
  }, -1);

  return (
    <>
      <CrewCamera slots={slots} layout={layout} top={top} bottom={bottom} portrait={portrait} lineup={lineup} />
      <StageLights keyLight={2.1} hemi={1.4} />
      <primitive object={shadows} />
      {shown.map((d, i) => <primitive key={i} object={d.outer} />)}
      {lineup === 'front' && shown.map((d, i) => (
        <Html key={`l${i}`} position={[slots[i][0], -0.12, slots[i][1]]} center zIndexRange={[5, 0]}>
          <div style={{ color: '#fff', font: '11px/1.45 "IBM Plex Mono", ui-monospace, monospace', letterSpacing: '0.08em', textAlign: 'center', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>
            <span style={{ color: PALETTE.yellow }}>{`${d.look.id} ${d.look.body === 'f' ? 'W' : 'M'}`}</span>{` ${TEMPLATE_LABEL[d.look.template] || d.look.template}`}<br />
            {`${{ none: 'buzz' }[d.look.hairStyle] || d.look.hairStyle}${d.look.outfit.hat ? ` + ${d.look.outfit.hat}` : ''}${d.look.outfit.headphones ? ' + phones' : ''}`}
          </div>
        </Html>
      ))}
    </>
  );
}
