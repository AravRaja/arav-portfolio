// Extra designs for the dance lab, registered by DanceLab.jsx after A-D.
// D1-D6: variants of D (a person in clothes) on the same animation. D1-D3 are real rigged characters
// (Microsoft Rocketbox, MIT) retargeted onto the rig; D4-D6 are procedural, built in code.
import { makeRiggedDesign } from './dvariants/RiggedCharacter.jsx';
import { makeProceduralDesign } from './dvariants/ProceduralDancer.jsx';

const RIM = { color: '#8fa2ff', strength: 0.45, power: 3 };

export const EXTRA_DESIGNS = {
  D1: {
    name: 'Rocketbox grey hoodie + phones (MIT)',
    Component: makeRiggedDesign({ url: '/dance/characters/rocketbox-male-18/model.glb', headphones: true, rim: RIM }),
    stage: 'blue', dpr: 2, caption: 3,
  },
  D2: {
    name: 'Rocketbox track jacket + jeans (MIT)',
    Component: makeRiggedDesign({ url: '/dance/characters/rocketbox-male-17/model.glb', rim: RIM }),
    stage: 'blue', dpr: 2, caption: 3,
  },
  D3: {
    name: 'Rocketbox black hoodie + shorts (MIT)',
    Component: makeRiggedDesign({ url: '/dance/characters/rocketbox-female-12/model.glb', rim: RIM }),
    stage: 'blue', dpr: 2, caption: 3,
  },

  D4: {
    name: 'Procedural hoodie + cargos (own code)',
    Component: makeProceduralDesign({
      skin: '#c98e68', hair: '#1b1d2e', top: '#eef0f6', topCuff: '#d9dce8', hood: true, pocket: true, strings: '#f0ff18',
      oversize: 1.12, topLength: 'long', sock: '#ffffff', pants: '#585e3c', cargo: '#4c5233', baggy: 1.18, shoe: '#ffffff', sole: '#f0ff18',
      lace: '#d9dce8', chunky: 1.12, headphones: true,
    }),
    stage: 'blue', dpr: 2, caption: 3,
  },
  D5: {
    name: 'Procedural tracksuit + bucket hat (own code)',
    Component: makeProceduralDesign({
      skin: '#8a5a3c', hair: '#141414', top: '#d8232c', topCuff: '#b51c24', stripe: '#ffffff', zip: '#ffffff',
      pants: '#d8232c', cuff: '#b51c24', taper: true, baggy: 1.0, shoe: '#ffffff', sole: '#e9e2cf', lace: '#ffffff',
      hat: 'bucket', hatCol: '#f3f1ea', hairStyle: 'none',
    }),
    stage: 'blue', dpr: 2, caption: 3,
  },
  D6: {
    name: 'Procedural all black + yellow (own code)',
    Component: makeProceduralDesign({
      skin: '#e2b896', hair: '#0e0f14', top: '#17181f', topCuff: '#22232c', hood: true, strings: '#f0ff18',
      oversize: 1.06, pants: '#121318', baggy: 1.05, taper: true, shoe: '#17181f', sole: '#f0ff18', lace: '#f0ff18',
      chunky: 1.08, headphones: true, belt: '#f0ff18', sock: '#17181f',
    }, { rim: { strength: 0.75, power: 2.4 } }),
    stage: 'blue', dpr: 2, caption: 3,
  },
};
