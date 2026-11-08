import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, CapsuleGeometry, Group, Object3D, SphereGeometry, Vector3 } from 'three';
import { MJ_TO_THREE, geomMatrix } from '../rig.js';

export const BLUE = '#0117d5';
export const YELLOW = '#f0ff18';

// One Object3D per humanoid body under a z-up -> y-up group, posed from the rig every frame.
// `children(body, index)` renders what hangs off each body (in the body's own MuJoCo frame).
export function RigBodies({ rig, clock, children, onPose }) {
  const nodes = useMemo(() => rig.bodies.map(() => {
    const o = new Object3D();
    o.matrixAutoUpdate = false;
    return o;
  }), [rig]);
  const root = useMemo(() => {
    const g = new Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(MJ_TO_THREE);
    nodes.forEach((n) => g.add(n));
    return g;
  }, [nodes]);

  useFrame((state) => {
    const s = clock.read();
    rig.pose(s.t, s);
    for (let i = 0; i < nodes.length; i++) nodes[i].matrix.copy(rig.world[i]);
    root.updateMatrixWorld(true);
    if (onPose) onPose(s, state);
  }, -1);

  return (
    <primitive object={root}>
      {nodes.map((n, i) => (
        <BodyPortal key={rig.bodies[i].name} node={n}>{children(rig.bodies[i], i)}</BodyPortal>
      ))}
    </primitive>
  );
}

// Renders children into an existing Object3D (a body node) without re-parenting the node itself.
function BodyPortal({ node, children }) {
  return <primitive object={node} dispose={null}>{children}</primitive>;
}

// three.js geometry for a MuJoCo geom, positioned in its body frame. `grow` inflates the radius.
export function geomGeometry(g, { grow = 0, radial = 16, cap = 6 } = {}) {
  const r = g.size[0] + grow;
  if (g.type === 'capsule') return new CapsuleGeometry(r, 2 * g.size[1], cap, radial);
  return new SphereGeometry(r, radial, Math.max(6, Math.round(radial * 0.75)));
}

export function GeomMesh({ g, grow = 0, radial, cap, children, ...props }) {
  const geometry = useMemo(() => geomGeometry(g, { grow, radial, cap }), [g, grow, radial, cap]);
  const matrix = useMemo(() => geomMatrix(g), [g]);
  return (
    <mesh geometry={geometry} matrix={matrix} matrixAutoUpdate={false} {...props}>
      {children}
    </mesh>
  );
}

// Frames the dancer between the site chrome: the header + intro text at the top and the space key
// + caption at the bottom (CSS px). The ~2.1 m tall, ~2 m wide dance space is fitted into what is
// left, on desktop and on a portrait phone, and the view is shifted so it sits in that gap.
export function StageCamera({ top = 130, bottom = 150, spanH = 2.15, spanW = 2.1, centre = 0.98, fov = 26, elevation = 10 }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const w = size.width, h = size.height;
    const avail = Math.max(120, h - top - bottom);
    const ppm = Math.min(avail / spanH, (0.94 * w) / spanW); // px per metre at the dancer
    const tan = Math.tan((fov * Math.PI) / 360);
    const dist = h / (2 * tan * ppm);
    camera.fov = fov;
    camera.near = 0.1;
    camera.far = 100;
    const el = (elevation * Math.PI) / 180; // looking down a little, so the floor shadow reads
    camera.position.set(0, centre + dist * Math.sin(el), dist * Math.cos(el));
    camera.lookAt(0, centre, 0);
    const shift = top + avail / 2 - h / 2; // px the dancer's centre should move down
    camera.setViewOffset(w, h, 0, -shift, w, h);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, top, bottom, spanH, spanW, centre, fov, elevation]);
  return null;
}


// Soft contact shadow without an extra render pass: a blurred ellipse under each foot (fading as
// the foot lifts) and a wider one under the hips. Three transparent quads, one shared texture.
let blobTexture = null;
function getBlobTexture() {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  blobTexture = new CanvasTexture(c);
  return blobTexture;
}

export function BlobShadow({ rig, color = '#000a78', opacity = 0.6, blending }) {
  const refs = [useRef(), useRef(), useRef()];
  const I = rig.index;
  const ids = [I.left_foot, I.right_foot, I.pelvis];
  const fwd = useMemo(() => new Vector3(), []);
  useFrame(() => {
    ids.forEach((b, k) => {
      const m = refs[k].current;
      if (!m) return;
      const p = rig.wpos[b];
      // three.js floor position of a MuJoCo point: (mj y, 0, mj x)
      if (k < 2) {
        fwd.set(1, 0, 0).applyQuaternion(rig.wquat[b]);
        const lift = Math.max(0, p.z - 0.03);
        const f = Math.max(0, 1 - lift / 0.3);
        m.position.set(p.y + fwd.y * 0.04, 0.002 + k * 0.0005, p.x + fwd.x * 0.04);
        m.rotation.set(-Math.PI / 2, 0, Math.atan2(-fwd.x, fwd.y)); // long axis along the foot
        m.scale.set(0.36 * (1 + lift), 0.2 * (1 + lift), 1);
        m.material.opacity = opacity * f;
      } else {
        const f = Math.max(0.25, Math.min(1, 1.35 - p.z * 0.5));
        m.position.set(p.y, 0.001, p.x);
        m.rotation.set(-Math.PI / 2, 0, 0);
        m.scale.set(0.95, 0.6, 1);
        m.material.opacity = opacity * 0.55 * f;
      }
    });
  });
  const tex = getBlobTexture();
  return refs.map((r, k) => (
    <mesh key={k} ref={r} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} color={color} transparent depthWrite={false} opacity={opacity} {...(blending ? { blending } : {})} />
    </mesh>
  ));
}
