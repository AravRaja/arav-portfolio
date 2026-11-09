// The crew as the simulator sees them: every dancer's MuJoCo humanoid (rig.js: 16 bodies, 20 capsule / sphere geoms
// with the MJX XML's sizes), all 9 merged into ONE skinned mesh. Each vertex is rigidly bound to one bone = one body of
// one dancer (9 x 16 bones), and Crew writes those bones' world matrices straight from the rig's FK each frame, through
// the same slot transform as the toon dancer, so both bodies are posed by the very same numbers: one draw call for the
// whole sim crew. Pure three.js (no React, no DOM): the home page builds the geometry in the body worker.
import {
  Bone, BufferAttribute, BufferGeometry, CapsuleGeometry, Float32BufferAttribute, Matrix4, MeshLambertMaterial,
  Skeleton, SkinnedMesh, Sphere, SphereGeometry, Uint16BufferAttribute, Vector3,
} from 'three';
import { MJ_TO_THREE, geomMatrix } from './rig.js';

// the orange of the contact sheets (MuJoCo's default geom rgba .8 .6 .4 under its headlight), pre-warmed so it reads
// the same under the stage's blue-tinted hemisphere / fill lights
export const SIM_ORANGE = '#eca55a';

// bodies: the finale header's model.bodies ({ geoms: [{ type, size, pos, quat }] }); count: dancers
export function buildSimBodyData(bodies, count, { radial = 12, cap = 4 } = {}) {
  const parts = [];
  bodies.forEach((b, bi) => b.geoms.forEach((g) => {
    const geo = g.type === 'capsule'
      ? new CapsuleGeometry(g.size[0], 2 * g.size[1], cap, radial)
      : new SphereGeometry(g.size[0], radial, Math.round(radial * 0.75));
    geo.applyMatrix4(geomMatrix(g));
    parts.push([geo, bi]);
  }));
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const NV = nv * count, NI = ni * count;
  const position = new Float32Array(NV * 3), normal = new Float32Array(NV * 3);
  const skinIndex = new Uint16Array(NV * 4), skinWeight = new Float32Array(NV * 4);
  const index = NV > 65535 ? new Uint32Array(NI) : new Uint16Array(NI);
  let v = 0, k = 0;
  for (let d = 0; d < count; d++) {
    for (const [g, bi] of parts) {
      const n = g.attributes.position.count;
      position.set(g.attributes.position.array, v * 3);
      normal.set(g.attributes.normal.array, v * 3);
      const bone = d * bodies.length + bi;
      for (let j = 0; j < n; j++) { skinIndex[(v + j) * 4] = bone; skinWeight[(v + j) * 4] = 1; }
      const ix = g.index.array;
      for (let j = 0; j < ix.length; j++) index[k + j] = ix[j] + v;
      v += n; k += ix.length;
    }
  }
  for (const [g] of parts) g.dispose();
  return { attrs: { position, normal, skinIndex, skinWeight }, index, count, nb: bodies.length, tris: NI / 3 };
}

export const simTransferables = (d) => [...Object.values(d.attrs).map((a) => a.buffer), d.index.buffer];

// The skinned mesh for a built body set: bones are plain objects outside the scene graph (Crew sets their
// matrixWorld), bound at the identity, so a vertex lands at bone.matrixWorld * its body-local position.
export function simCrewFromData({ attrs, index, count, nb, tris }) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(attrs.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(attrs.normal, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(attrs.skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(attrs.skinWeight, 4));
  geometry.setIndex(new BufferAttribute(index, 1));
  const bones = [];
  for (let i = 0; i < count * nb; i++) {
    const b = new Bone();
    b.matrixAutoUpdate = false;
    b.matrixWorldAutoUpdate = false;
    bones.push(b);
  }
  const material = new MeshLambertMaterial({ color: SIM_ORANGE });
  const mesh = new SkinnedMesh(geometry, material);
  mesh.bind(new Skeleton(bones, bones.map(() => new Matrix4())), new Matrix4());
  mesh.frustumCulled = false;
  // three would otherwise skin every vertex on the CPU once to get a sorting sphere; the crew is never culled
  mesh.boundingSphere = new Sphere(new Vector3(0, 1, 0), 12);
  mesh.name = 'sim-crew';
  return { mesh, bones, material, geometry, count, nb, tris };
}

export function buildSimCrew(rig, count) {
  return simCrewFromData(buildSimBodyData(rig.header.model.bodies, count));
}

// Size of a dancer's capsule body, relative to its toon's k (retarget.js: the toon follows the rig with its own limb
// lengths, root at the rig's hip midpoint x k, k = its legs / the rig's, lowest sole on the rig's). The rig's "legs" run
// body origin to body origin and MuJoCo's foot origin sits 8 cm under the ankle hinge, so at plain x k the capsule hips
// ride 6-8 cm under the toon's. Fitting the capsule scale so its hip height matches the toon's over the whole song
// (least squares, every dancer, 9-140 s at 4 Hz) gives k x 1.084 for all nine (+-0.0003): mean hip gap 2 mm, worst
// 2.6 cm, with both bodies' soles on the floor. Crew then shifts the capsule body on the floor so its hip midpoint
// (x, z) stays exactly on the toon's.
export const SIM_SCALE = 1.084;

// dancer frame (the toon model's parent, see retarget.js) <- the rig's MuJoCo world, scaled by kSim and moved on the
// floor so the hip midpoint lands where the toon's does (rig hip midpoint x k): `hip` is the rig's hip midpoint
// (MuJoCo frame, this frame), out = T((k - kSim) * hip on the floor) * S(kSim) * MJ_TO_THREE
export function simRootMatrix(k, kSim, hip, out = new Matrix4()) {
  const d = k - kSim;
  out.makeScale(kSim, kSim, kSim).multiply(MJ_TO_THREE);
  out.elements[12] = d * hip.y; // three x = MuJoCo y
  out.elements[14] = d * hip.x; // three z = MuJoCo x
  return out;
}
