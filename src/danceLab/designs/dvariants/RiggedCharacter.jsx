// Route 1: a real rigged, clothed character (GLB in public/dance/characters/<name>/) retargeted onto
// the RL humanoid's motion by retarget.js. Rotation-only transfer, so the character keeps its own
// proportions; the hips follow the rig's hip midpoint and the soles are kept on the floor.
import React, { Suspense, useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Box3, DoubleSide, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BIPED_ROLES, Retargeter } from './retarget.js';
import { FootShadow, StageLights, addRim, headphonesGeometry } from './shared.jsx';

// bind-pose head bounds (stage space) from the vertices skinned to the head (or its face bones)
function headBounds(model, head) {
  const under = new Set();
  head.traverse((o) => { if (o.isBone) under.add(o); });
  const pts = [];
  const v = new Vector3();
  model.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const { position, skinIndex, skinWeight } = m.geometry.attributes;
    const bones = m.skeleton.bones;
    for (let i = 0; i < position.count; i++) {
      let w = 0;
      for (let c = 0; c < 4; c++) if (under.has(bones[skinIndex.getComponent(i, c)])) w += skinWeight.getComponent(i, c);
      if (w < 0.6) continue;
      m.getVertexPosition(i, v);
      pts.push(v.clone().applyMatrix4(m.matrixWorld));
    }
  });
  const box = new Box3().setFromPoints(pts);
  return { box, pts };
}

function Character({ rig, clock, url, headphones, rim, legScale, phonesDrop = 0.1, phonesScale = 1 }) {
  const gltf = useLoader(GLTFLoader, url);
  const { root, rt } = useMemo(() => {
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        const cut = m.alphaTest > 0 || m.transparent || /opacity/.test(m.name);
        const lm = new MeshLambertMaterial({ map: m.map, side: DoubleSide, alphaTest: cut ? 0.5 : 0, name: m.name });
        return rim ? addRim(lm, rim) : lm;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    const roleOf = (b) => BIPED_ROLES[b.name.replace(/_/g, ' ')]; // GLTFLoader turns spaces into _
    const rt = new Retargeter(rig, model, roleOf, { legScale });
    model.userData.retargeter = rt;
    if (headphones) {
      const head = model.getObjectByName('Bip01_Head');
      const { box, pts } = headBounds(model, head);
      const cy = box.max.y - phonesDrop;
      const ring = pts.filter((p) => Math.abs(p.y - cy) < 0.03);
      const rb = new Box3().setFromPoints(ring);
      const c = new Vector3((rb.min.x + rb.max.x) / 2, cy, (rb.min.z + rb.max.z) / 2 - 0.005);
      const geo = headphonesGeometry({ c, r: (rb.max.x - rb.min.x) / 2, scale: phonesScale });
      geo.applyMatrix4(head.matrixWorld.clone().invert()); // into the head bone's frame
      const mesh = new Mesh(geo, addRim(new MeshLambertMaterial({ vertexColors: true }), { strength: 0.35 }));
      mesh.frustumCulled = false;
      head.add(mesh);
    }
    return { root: model, rt };
  }, [gltf, rig, rim, legScale, headphones, phonesDrop, phonesScale]);

  useFrame(() => {
    const s = clock.read();
    rig.pose(s.t, s);
    rt.update();
  }, -1);

  return (
    <>
      <primitive object={root} />
      <FootShadow rt={rt} />
    </>
  );
}

export function makeRiggedDesign(opts) {
  function RiggedDesign({ rig, clock }) {
    return (
      <>
        <StageLights keyLight={opts.keyLight ?? 2.0} hemi={opts.hemi ?? 1.5} />
        <Suspense fallback={null}>
          <Character rig={rig} clock={clock} {...opts} />
        </Suspense>
      </>
    );
  }
  return RiggedDesign;
}
