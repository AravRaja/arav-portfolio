import React from 'react';
import { BlobShadow, GeomMesh, RigBodies, YELLOW } from './common.jsx';

// B. Capsule mannequin: the simulation body itself (MuJoCo's 20 capsules and spheres), matte, in the
// site's yellow. A white sky / blue ground light lets the stage colour bounce up into the shadows.
export default function CapsuleMannequin({ rig, clock }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#1b2cff', 1.6]} />
      <directionalLight position={[-2.5, 4, 3.5]} intensity={1.6} />
      <RigBodies rig={rig} clock={clock}>
        {(b) => b.geoms.map((g) => (
          <GeomMesh key={g.name} g={g} radial={20} cap={8}>
            <meshLambertMaterial color={YELLOW} />
          </GeomMesh>
        ))}
      </RigBodies>
      <BlobShadow rig={rig} color="#000a78" opacity={0.65} />
    </>
  );
}
