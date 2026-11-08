import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AddEquation, BackSide, Color, CustomBlending, EdgesGeometry, FrontSide, OneFactor, ShaderMaterial, ZeroFactor } from 'three';
import { RigBodies, YELLOW, geomGeometry } from './common.jsx';
import { geomMatrix } from '../../dance/rig.js';

// C. Neon wire: the body as glowing tubes on a darker club stage. Each capsule is an additive
// rim-lit shell (bright at the silhouette, almost clear in the middle) plus a wider, softer halo
// shell that fakes bloom without a post-processing pass, with the capsule's edges drawn as a thin
// white wire cage. The glow kicks on every beat after the drop.
const shellVertex = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const coreFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uPulse;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = clamp(0.06 + pow(f, 2.2) * 1.1 * uPulse, 0.0, 1.0);
    vec3 c = mix(uColor, vec3(1.0), pow(f, 6.0) * 0.6);
    gl_FragColor = vec4(c, a);
  }
`;
const haloFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uPulse;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float d = abs(dot(normalize(vN), normalize(vV)));
    gl_FragColor = vec4(uColor * pow(d, 2.6) * 0.32 * uPulse, 1.0);
  }
`;
const floorVertex = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const floorFragment = /* glsl */ `
  uniform vec2 uCentre; uniform float uPulse; uniform vec3 uGrid; uniform vec3 uGlow;
  varying vec2 vP;
  void main() {
    vec2 g = abs(fract(vP * 2.0 - 0.5) - 0.5) / fwidth(vP * 2.0);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    float r2 = dot(vP, vP);
    float fade = exp(-r2 / 7.0);
    if (fade < 0.02) discard;
    float pool = exp(-dot(vP - uCentre, vP - uCentre) / 0.18);
    vec3 c = uGrid * line * fade * 0.55 + uGlow * pool * 0.22 * uPulse;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// Light adds to whatever is behind it, and the canvas alpha is left alone, so the glow lands on the
// CSS stage gradient behind the (transparent) canvas instead of painting it black.
const ADD = {
  transparent: true, depthWrite: false, blending: CustomBlending, blendEquation: AddEquation,
  blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
};

function additive(fragmentShader, side, uniforms) {
  return new ShaderMaterial({ vertexShader: shellVertex, fragmentShader, side, uniforms, ...ADD });
}

export default function NeonWire({ rig, clock }) {
  const uniforms = useMemo(() => ({ uColor: { value: new Color(YELLOW) }, uPulse: { value: 1 } }), []);
  // the tube itself is painted (normal blending) so it stays yellow on blue; only the halo adds light
  const core = useMemo(() => new ShaderMaterial({
    vertexShader: shellVertex, fragmentShader: coreFragment, side: FrontSide, uniforms, transparent: true, depthWrite: false,
  }), [uniforms]);
  const halo = useMemo(() => additive(haloFragment, BackSide, uniforms), [uniforms]);
  const floor = useMemo(() => new ShaderMaterial({
    vertexShader: floorVertex, fragmentShader: floorFragment,
    uniforms: { uCentre: { value: [0, 0] }, uPulse: uniforms.uPulse, uGrid: { value: new Color('#3d63ff') }, uGlow: { value: new Color(YELLOW) } },
    ...ADD,
  }), [uniforms]);
  const parts = useMemo(() => rig.bodies.map((b) => b.geoms.map((g) => ({
    g,
    matrix: geomMatrix(g),
    core: geomGeometry(g, { radial: 20, cap: 8 }),
    halo: geomGeometry(g, { grow: 0.035, radial: 12, cap: 4 }),
    edges: new EdgesGeometry(geomGeometry(g, { radial: 8, cap: 2 }), 20),
  }))), [rig]);
  const floorRef = useRef();
  const pel = rig.index.pelvis;
  const H = rig.header;

  useFrame(() => {
    const s = clock.read();
    let pulse = 1;
    if (!s.idle && s.t > H.drop) {
      const ph = (((s.t - H.grid_anchor) / H.beat) % 1 + 1) % 1;
      pulse = 0.9 + 0.45 * Math.exp(-ph * 7);
    }
    uniforms.uPulse.value = pulse;
    const p = rig.wpos[pel];
    // the floor plane is rotated -90° about x: its local (x, y) = world (x, -z) = MuJoCo (y, -x)
    floor.uniforms.uCentre.value = [p.y, -p.x];
  });

  return (
    <>
      <RigBodies rig={rig} clock={clock}>
        {(b, i) => parts[i].map(({ g, matrix, core: cg, halo: hg, edges }) => (
          <group key={g.name} matrix={matrix} matrixAutoUpdate={false}>
            <mesh geometry={hg} material={halo} renderOrder={1} />
            <mesh geometry={cg} material={core} renderOrder={2} />
            <lineSegments geometry={edges} renderOrder={3}>
              <lineBasicMaterial color="#ffffff" opacity={0.5} premultipliedAlpha {...ADD} />
            </lineSegments>
          </group>
        ))}
      </RigBodies>
      <mesh ref={floorRef} rotation={[-Math.PI / 2, 0, 0]} material={floor} renderOrder={0}>
        <planeGeometry args={[9, 9]} />
      </mesh>
    </>
  );
}
