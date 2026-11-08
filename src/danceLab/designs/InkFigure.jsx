import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, CanvasTexture, Color, ShaderMaterial } from 'three';
import { BLUE, GeomMesh, RigBodies } from './common.jsx';

// A. Ink figure: a line drawing on the blue page. Every body part is filled with the page's own
// blue and outlined by a back-face shell pushed out in screen space, so the figure reads as white
// pen strokes (limbs crossing in front of the body draw over it). The strokes "boil" 8 times a
// second, like hand-drawn animation redrawn on every other frame, and taper a little along their
// length so they look inked rather than vector-perfect.
const INK = '#ffffff';
const BOIL_HZ = 8;

const outlineVertex = /* glsl */ `
  uniform float uThickness;   // stroke width, drawing-buffer px
  uniform float uBoil;        // wobble, drawing-buffer px
  uniform float uStep;        // boil step (changes BOIL_HZ times a second)
  uniform vec2 uResolution;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 nView = normalize(normalMatrix * normal);
    vec2 dir = (projectionMatrix * vec4(nView, 0.0)).xy;
    dir = dir / max(length(dir), 1e-5);
    vec3 seed = position * 9.0 + vec3(uStep * 3.17, uStep * 1.31, uStep * 2.03);
    float width = uThickness * (0.45 + 1.1 * noise(seed * 0.7));
    vec2 wobble = vec2(noise(seed + 11.0), noise(seed + 23.0)) - 0.5;
    clip.xy += (dir * width + wobble * uBoil) * 2.0 / uResolution * clip.w;
    gl_Position = clip;
  }
`;
const outlineFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, 1.0); }
`;

function makeHatch(seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  x.strokeStyle = INK;
  x.lineCap = 'round';
  x.save();
  x.beginPath();
  x.ellipse(128, 64, 118 + rnd() * 6, 50 + rnd() * 6, 0, 0, Math.PI * 2);
  x.clip();
  for (let k = -140; k < 260; k += 13) {
    x.lineWidth = 3 + rnd() * 2;
    x.globalAlpha = 0.55 + rnd() * 0.4;
    x.beginPath();
    x.moveTo(k + rnd() * 6, 128 + rnd() * 4);
    x.quadraticCurveTo(k + 60 + rnd() * 10, 64 + rnd() * 8, k + 128 + rnd() * 6, rnd() * 4);
    x.stroke();
  }
  x.restore();
  const t = new CanvasTexture(c);
  return t;
}

export default function InkFigure({ rig, clock }) {
  const { size, viewport } = useThree();
  const outline = useMemo(() => new ShaderMaterial({
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    side: BackSide,
    uniforms: {
      uThickness: { value: 2.4 },
      uBoil: { value: 1.4 },
      uStep: { value: 0 },
      uResolution: { value: [1, 1] },
      uColor: { value: new Color(INK) },
    },
  }), []);
  const hatches = useMemo(() => [1, 2, 3].map(makeHatch), []);
  const shadow = useRef();
  const pel = rig.index.pelvis, lf = rig.index.left_foot, rf = rig.index.right_foot;

  useFrame(() => {
    const dpr = viewport.dpr;
    const u = outline.uniforms;
    u.uResolution.value = [size.width * dpr, size.height * dpr];
    u.uThickness.value = 2.1 * dpr * Math.max(0.85, Math.min(1.5, size.height / 720));
    u.uBoil.value = 1.1 * dpr;
    const s = clock.read();
    const step = s.frozen ? 0 : Math.floor(s.clock * BOIL_HZ);
    u.uStep.value = step % 97;
    const sh = shadow.current;
    if (sh) {
      sh.material.map = hatches[step % 3];
      const p = rig.wpos[pel], a = rig.wpos[lf], b = rig.wpos[rf];
      sh.position.set((a.y + b.y) / 2 * 0.6 + p.y * 0.4, 0.002, (a.x + b.x) / 2 * 0.6 + p.x * 0.4);
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      sh.scale.set(0.55 + spread * 0.9, 0.24 + spread * 0.25, 1);
    }
  });

  return (
    <>
      <RigBodies rig={rig} clock={clock}>
        {(b) => b.geoms.map((g) => (
          <group key={g.name}>
            <GeomMesh g={g} radial={18} cap={6}>
              <meshBasicMaterial color={BLUE} />
            </GeomMesh>
            <GeomMesh g={g} radial={18} cap={6} material={outline} />
          </group>
        ))}
      </RigBodies>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.4} depthWrite={false} map={hatches[0]} />
      </mesh>
    </>
  );
}
