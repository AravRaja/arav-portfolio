// Route 2: procedural dancer (proceduralBody.js) in a layered outfit, driven by the same retargeter as
// the rigged characters. Toon shading (3-step ramp) + a stage-blue rim, one skinned draw call
// (+1 for the headphones when worn, +3 contact-shadow quads).
import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { FrontSide, Group, Mesh, MeshLambertMaterial, MeshToonMaterial, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { Retargeter } from '../../../dance/retarget.js';
import { buildDancer } from '../../../dance/proceduralBody.js';
import { FootShadow, StageLights, addRim, getToonRamp, headphonesGeometry } from '../../../dance/shared.jsx';

function Dancer({ rig, clock, outfit, rim }) {
  const { root, rt } = useMemo(() => {
    const B = buildDancer(outfit);
    const { geometry, bones, root: skelRoot } = B.build();
    const model = new Group();
    model.add(skelRoot);
    const mat = addRim(new MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp(), side: FrontSide }), rim);
    const mesh = new SkinnedMesh(geometry, mat);
    mesh.frustumCulled = false;
    model.add(mesh);
    model.updateMatrixWorld(true);
    mesh.bind(new Skeleton(bones));
    let tris = B.tris;
    if (outfit.headphones) {
      const head = bones.find((b) => b.name === 'head');
      const geo = headphonesGeometry({ c: new Vector3(0, 1.68, 0.006), r: 0.087, cups: outfit.phonesCol || '#f0ff18', band: outfit.bandCol || '#14183a' });
      geo.applyMatrix4(head.matrixWorld.clone().invert());
      const hp = new Mesh(geo, addRim(new MeshLambertMaterial({ vertexColors: true }), { strength: 0.35 }));
      hp.frustumCulled = false;
      head.add(hp);
      tris += geo.attributes.position.count / 3;
    }
    const rt = new Retargeter(rig, model, (b) => b.name, { keepScale: true });
    model.userData.retargeter = rt;
    model.userData.tris = tris;
    return { root: model, rt, tris };
  }, [rig, outfit, rim]);

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

export function makeProceduralDesign(outfit, { rim = { strength: 0.5, power: 2.6 }, keyLight = 2.1, hemi = 1.4 } = {}) {
  function ProceduralDesign({ rig, clock }) {
    return (
      <>
        <StageLights keyLight={keyLight} hemi={hemi} />
        <Dancer rig={rig} clock={clock} outfit={outfit} rim={rim} />
      </>
    );
  }
  return ProceduralDesign;
}
