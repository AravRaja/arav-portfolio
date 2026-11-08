// Shared bits for the D-variants: stage lighting, a cheap rim light (added to any lit material through
// onBeforeCompile, no extra pass), a contact shadow that follows the character's own feet, and the
// yellow DJ headphones.
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Color, DataTexture, NearestFilter, RedFormat, Vector3 } from 'three';

export const RIM_BLUE = '#8fa2ff';

// Fresnel rim, added after lighting: a thin bright edge on the silhouette, tinted like the stage.
export function addRim(material, { color = RIM_BLUE, strength = 0.55, power = 3.0 } = {}) {
  const c = new Color(color);
  material.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: c };
    sh.uniforms.rimStrength = { value: strength };
    sh.uniforms.rimPower = { value: power };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 rimColor; uniform float rimStrength; uniform float rimPower;\nvoid main() {')
      .replace('#include <dithering_fragment>', `
        { vec3 vd = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(abs(dot(normal, vd)), 0.0, 1.0), rimPower);
          gl_FragColor.rgb += rimColor * rim * rimStrength; }
        #include <dithering_fragment>`);
  };
  material.customProgramCacheKey = () => `rim-${color}-${strength}-${power}`;
  return material;
}

// 3-step toon ramp for MeshToonMaterial (cel-ish, soft dark step)
let toonRamp = null;
export function getToonRamp() {
  if (toonRamp) return toonRamp;
  const d = new Uint8Array([110, 175, 230, 255]);
  toonRamp = new DataTexture(d, 4, 1, RedFormat);
  toonRamp.minFilter = toonRamp.magFilter = NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

// White sky / stage-blue ground, warm-white key from the top left, cool fill from behind right.
export function StageLights({ keyLight = 2.0, hemi = 1.5, fill = 0.6 }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#2236ff', hemi]} />
      <directionalLight position={[-2.5, 4, 3.5]} intensity={keyLight} />
      <directionalLight position={[3, 1.5, -2]} intensity={fill} color="#9fb0ff" />
    </>
  );
}

let blobTex = null;
function getBlobTexture() {
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

// Contact shadow from the retargeted character's feet / hips (stage space), same look as common.jsx.
export function FootShadow({ rt, color = '#000a78', opacity = 0.65 }) {
  const refs = [useRef(), useRef(), useRef()];
  const fwd = useMemo(() => new Vector3(), []);
  useFrame(() => {
    ['l', 'r', 'h'].forEach((s, k) => {
      const m = refs[k].current;
      if (!m) return;
      if (k < 2) {
        const p = rt.footPos(s);
        rt.footForward(s, fwd);
        const lift = Math.max(0, p.y - rt.ankleRestY(s));
        const f = Math.max(0, 1 - lift / 0.3);
        m.position.set(p.x + fwd.x * 0.05, 0.002 + k * 0.0005, p.z + fwd.z * 0.05);
        m.rotation.set(-Math.PI / 2, 0, Math.atan2(-fwd.z, fwd.x)); // long axis along the foot
        m.scale.set(0.38 * (1 + lift), 0.21 * (1 + lift), 1);
        m.material.opacity = opacity * f;
      } else {
        const p = rt.hipsPos();
        const f = Math.max(0.25, Math.min(1, 1.35 - p.y * 0.5));
        m.position.set(p.x, 0.001, p.z);
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
      <meshBasicMaterial map={tex} color={color} transparent depthWrite={false} opacity={opacity} />
    </mesh>
  ));
}

// The DJ headphones' geometry lives in headphones.js (no React there, so the body worker can use it too)
export { headphonesGeometry } from './headphones.js';
