// The "sim reveal" wipe on the music stage: a vertical divider the user drags across the crew. Left of it, the toon
// crew on the blue page; right of it, the same nine dancers as the MuJoCo capsule bodies the policy was trained on
// (simBody.js), on the simulator's checkerboard floor under its grey-blue starry sky.
// One scene, one pass: both body sets are drawn every frame with a clipping plane each (the plane through the camera
// and the divider's screen line, so it cuts exactly at the divider), and the sim's floor + sky is one full-screen quad
// clipped by the same plane. No second render, no render target.
//
// The store is a plain mutable object shared by the DOM overlay (RevealOverlay.jsx), the pointer handling below and
// Crew's frame loop (which moves the planes and writes the overlay's positions, so nothing re-renders per frame).
import { useEffect } from 'react';
import { Color, Mesh, Plane, PlaneGeometry, Scene, ShaderMaterial, Vector3 } from 'three';

// the sim side's readouts (top left of the revealed region)
export const SIM_STATS = ['MUJOCO MJX · PPO · 400M STEPS', 'JOINT ERR 2.4° · FALLS 0/100', '602 HIP-HOP MOVES (AIST++)'];
export const PARK_PX = 6; // parked at the right edge: a sliver of checkerboard
export const SWEEP = { delay: 0.9, dur: 1.6, peak: 0.35 }; // s after the crew fades in, s, revealed fraction
const GRAB_PX = 22; // a press this close to the divider grabs it straight away
const DRAG_START_PX = 6; // anywhere else, a horizontal move this long starts a drag

// r: revealed fraction from the right (0..1; null = parked). sweep: run the discoverability sweep once.
export function createReveal({ r = null, sweep = true } = {}) {
  return {
    r, // null = parked
    sweep: sweep ? 'pending' : 'off', // pending -> (armed at t0) -> done
    sweepT0: 0,
    sweepFrom: 0,
    dragging: false,
    x: -1, // divider, CSS px from the left (written each frame)
    w: 1,
    frac: 0, // revealed fraction actually shown (parked / sweep / drag)
    dom: {}, // RevealOverlay's elements
    listeners: new Set(), // the lab panel's slider
  };
}

// start the sweep (the crew just faded in); no-op once it has run or been cancelled
export function armSweep(store, delay = SWEEP.delay) {
  if (store.sweep !== 'pending') return;
  store.sweep = 'armed';
  store.sweepT0 = performance.now() + delay * 1000;
}
export function cancelSweep(store) {
  if (store.sweep === 'armed' || store.sweep === 'pending') store.sweep = 'done';
}
export function setReveal(store, r) {
  cancelSweep(store);
  store.r = r == null ? null : Math.max(0, Math.min(1, r));
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// fraction shown right now (call once per frame, with the canvas width in CSS px)
export function revealFraction(store, w, now = performance.now()) {
  const park = Math.min(1, PARK_PX / Math.max(1, w));
  const base = store.r == null ? park : Math.max(park, store.r);
  if (store.sweep !== 'armed' || now < store.sweepT0) return base;
  const p = (now - store.sweepT0) / (SWEEP.dur * 1000);
  if (p >= 1 || base >= SWEEP.peak - 0.05) { store.sweep = 'done'; return base; }
  // out to the peak and back, easing in and out of both ends
  const k = easeInOut(p < 0.5 ? 2 * p : 2 - 2 * p);
  return base + (SWEEP.peak - base) * k;
}

// ---------- clipping: world-space planes through the camera and the divider's screen line
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _n = new Vector3();
// sim keeps x >= divider (positive side), toon keeps the rest
export function updateClipPlanes(camera, ndcX, simPlane, toonPlane) {
  // in view space: through the origin and the near-plane points (ndcX, -1) and (ndcX, 1)
  _a.set(ndcX, -1, -1).applyMatrix4(camera.projectionMatrixInverse);
  _b.set(ndcX, 1, -1).applyMatrix4(camera.projectionMatrixInverse);
  _n.crossVectors(_a, _b).normalize();
  _c.set(ndcX + 0.5, 0, -1).applyMatrix4(camera.projectionMatrixInverse);
  if (_n.dot(_c) < 0) _n.negate();
  simPlane.set(_n, 0).applyMatrix4(camera.matrixWorld);
  toonPlane.copy(simPlane).negate();
}
// `none`: never clips, for the crew's other material (the contact shadows), so that every material in the scene has
// exactly one local plane (see primeClipping)
export const makePlanes = () => ({
  sim: new Plane(new Vector3(-1, 0, 0), 0), toon: new Plane(new Vector3(1, 0, 0), 0), none: new Plane(new Vector3(0, 0, 0), 1),
});

// renderer.compileAsync() builds every program with the renderer's current clipping-plane count, but that count is only
// set while rendering (per material), so before the first frame it is 0 and the first real frame would recompile the
// clipped programs synchronously: the stall compileAsync is there to avoid. Rendering an empty scene with one global
// plane leaves the count at 1, which is what every crew material has (one local plane each), so the programs
// compileAsync builds are the ones the first frame uses. Call right before compileAsync.
const emptyScene = new Scene();
export function primeClipping(gl, camera) {
  const prev = gl.clippingPlanes;
  gl.clippingPlanes = [new Plane(new Vector3(0, 0, 0), 1)];
  try { gl.render(emptyScene, camera); } finally { gl.clippingPlanes = prev; }
}

// ---------- the sim's floor + sky: one full-screen quad, ray-cast against the floor (y = 0) per pixel
// Colours from the contact sheets (dance-rl/runs/*/sheets: MuJoCo's checker "grid" texture and gradient skybox).
const SKY_TOP = '#3d5a78', SKY_LOW = '#324b65', BAND = '#13212f';
const NEAR_A = '#3a5673', NEAR_B = '#1b3450', FAR_A = '#1e2d3c', FAR_B = '#101e2c';
export function makeSimBackdrop(plane) {
  const lin = (h) => new Color(h); // sRGB hex -> linear working space
  const material = new ShaderMaterial({
    uniforms: {
      uInvProj: { value: null }, uCamWorld: { value: null },
      uZFar: { value: -1e5 }, uSquare: { value: 0.9 }, uDpr: { value: 1 }, uCenter: { value: [0, 0] },
      uSkyTop: { value: lin(SKY_TOP) }, uSkyLow: { value: lin(SKY_LOW) }, uBand: { value: lin(BAND) },
      uNearA: { value: lin(NEAR_A) }, uNearB: { value: lin(NEAR_B) }, uFarA: { value: lin(FAR_A) }, uFarB: { value: lin(FAR_B) },
    },
    vertexShader: /* glsl */`
      #include <clipping_planes_pars_vertex>
      uniform mat4 uInvProj; uniform mat4 uCamWorld;
      varying vec3 vWorld; varying vec2 vUv;
      void main() {
        vec4 mvPosition = uInvProj * vec4(position.xy, 0.0, 1.0);
        mvPosition /= mvPosition.w;
        vWorld = (uCamWorld * mvPosition).xyz;
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <clipping_planes_pars_fragment>
      uniform vec3 uSkyTop, uSkyLow, uBand, uNearA, uNearB, uFarA, uFarB;
      uniform float uZFar, uSquare, uDpr; uniform vec2 uCenter;
      varying vec3 vWorld; varying vec2 vUv;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main() {
        #include <clipping_planes_fragment>
        vec3 dir = normalize(vWorld - cameraPosition);
        float t = dir.y < -1e-5 ? -cameraPosition.y / dir.y : -1.0;
        vec3 P = cameraPosition + dir * t;
        vec3 col;
        if (t > 0.0 && P.z > uZFar) {
          // box-filtered checker (no shimmer towards the horizon)
          vec2 q = P.xz / uSquare;
          vec2 w = fwidth(q) + 1e-4;
          vec2 i = 2.0 * (abs(fract((q - 0.5 * w) * 0.5) - 0.5) - abs(fract((q + 0.5 * w) * 0.5) - 0.5)) / w;
          float chk = 0.5 - 0.5 * i.x * i.y;
          float lit = 1.0 - smoothstep(3.0, 22.0, length(P.xz - uCenter));
          col = mix(mix(uFarA, uNearA, lit), mix(uFarB, uNearB, lit), chk);
          float edge = uZFar > -1e4 ? smoothstep(6.0, 0.0, P.z - uZFar) : 0.0;
          col = mix(col, uBand, max(smoothstep(30.0, 90.0, t), edge * 0.85));
        } else {
          col = mix(uSkyLow, uSkyTop, vUv.y);
          // stars: one in some of the 7 px cells, crisp 1-2 px dots, fixed to the screen
          vec2 px = gl_FragCoord.xy / uDpr;
          vec2 cell = floor(px / 7.0);
          if (hash(cell) > 0.8) {
            vec2 pos = cell * 7.0 + 1.0 + 5.0 * vec2(hash(cell + 17.1), hash(cell + 31.7));
            float s = (1.0 - smoothstep(0.45, 0.95, length(px - pos))) * (0.45 + 0.55 * hash(cell + 5.3));
            col = mix(col, vec3(1.0), s);
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
    clipping: true,
    clippingPlanes: [plane],
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100; // first of the opaque list: everything else draws over it
  mesh.name = 'sim-backdrop';
  return mesh;
}

// floor edge (world z) so a phone that looks down steeply still shows some sky at the top: where the ray through
// screen y = skyFrac * h meets the floor, unless the real horizon is already in the top 30% of the screen
const _o = new Vector3(), _d = new Vector3();
export function floorEdgeZ(camera, skyFrac = 0.2) {
  const hit = (ndcY) => {
    _o.setFromMatrixPosition(camera.matrixWorld);
    _d.set(0, ndcY, 0.5).unproject(camera).sub(_o).normalize();
    return _d.y < -1e-4 ? _o.z + _d.z * (-_o.y / _d.y) : null;
  };
  if (hit(1 - 2 * 0.3) === null) return -1e5; // the horizon is in the top 30%: an endless floor
  return hit(1 - 2 * skyFrac) ?? -1e5;
}

// ---------- pointer: drag the handle, or click-drag / touch-drag anywhere on the stage
// Listens on the window (the deck's canvas sits on top of the stage and keeps its pointer events): a press near the
// divider grabs it at once; elsewhere a mostly horizontal move of DRAG_START_PX starts the drag, and the click that
// ends it is swallowed. Presses on links, buttons, the space key, the header and the lab panel are left alone. Space
// isn't touched.
const SKIP = 'a,button,input,select,textarea,label,[role="button"],.site-header,.space-full,.lab-panel';
export function useRevealDrag(store, enabled) {
  useEffect(() => {
    if (!store || !enabled) return undefined;
    const root = document.documentElement;
    let press = null; // { id, x0, y0, active }
    let swallowClick = false;
    const toFrac = (clientX) => 1 - clientX / Math.max(1, store.w);
    const begin = (e) => {
      cancelSweep(store);
      press.active = true;
      store.dragging = true;
      root.classList.add('sim-reveal-dragging');
      setReveal(store, toFrac(e.clientX));
    };
    const end = () => {
      if (press?.active) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 0); }
      press = null;
      store.dragging = false;
      root.classList.remove('sim-reveal-dragging');
    };
    const down = (e) => {
      if (press || (e.pointerType === 'mouse' && e.button !== 0) || store.x < 0) return;
      if (e.target?.closest?.(SKIP)) return;
      press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
      if (Math.abs(e.clientX - store.x) <= GRAB_PX || e.target?.closest?.('.sim-reveal-handle')) {
        e.preventDefault();
        e.stopPropagation(); // it's ours: the (invisible) deck under the stage doesn't get it
        begin(e);
      }
    };
    const move = (e) => {
      if (e.pointerType === 'mouse' && !press) root.classList.toggle('sim-reveal-hover', store.x >= 0 && Math.abs(e.clientX - store.x) <= GRAB_PX);
      if (!press || e.pointerId !== press.id) return;
      if (!press.active) {
        const dx = e.clientX - press.x0, dy = e.clientY - press.y0;
        if (Math.abs(dx) < DRAG_START_PX || Math.abs(dx) < Math.abs(dy)) {
          if (Math.hypot(dx, dy) > 24) press = null; // a vertical gesture: not ours
          return;
        }
        begin(e);
      }
      setReveal(store, toFrac(e.clientX));
    };
    const up = (e) => { if (press && e.pointerId === press.id) end(); };
    const click = (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } };
    // the stage is fixed (nothing to scroll), but stop the browser's own touch gestures while a drag is on
    const touchmove = (e) => { if (press?.active && e.cancelable) e.preventDefault(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('click', click, true);
    window.addEventListener('touchmove', touchmove, { passive: false });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('touchmove', touchmove);
      root.classList.remove('sim-reveal-dragging', 'sim-reveal-hover');
      store.dragging = false;
    };
  }, [store, enabled]);
}

// 'gMH_sFM_d24_mMH5_ch20_s6' -> 'gMH_sFM_d24 ch20'
export function shortMove(id) {
  const p = id.split('_');
  const ch = p.find((s) => /^ch\d+$/.test(s));
  return `${p.slice(0, 3).join('_')}${ch ? ` ${ch}` : ''}`;
}
