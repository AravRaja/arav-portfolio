// Retargets the RL humanoid's motion (rig.js: 16 MuJoCo bodies posed by FK over the 21 hinges, composed
// in XML order) onto any skinned skeleton whose bones are tagged with a role (hips, spine, l_thigh, ...).
//
// For every mapped bone we only transfer rotation, as a world-space rotation *relative to the rig's
// zero pose* (all 21 hinges at 0, the "boxer" pose with forearms up):
//
//   bone_world(t) = body_world(t) * body_world(zero)^-1 * Delta_b * bone_bind_world
//
// Delta_b rotates the bone from the character's own bind pose (T/A-pose) onto the rig's zero pose:
//  - torso / feet: Delta = I (both stand upright facing +z at rest),
//  - legs: the bone's direction (joint -> child joint) onto the rig segment's, keeping "forward" so
//    the knee bends the right way,
//  - arms: the bone's direction plus the elbow hinge axis (upper x fore arm in the rig; upper x forward
//    for a character whose arms hang straight), so the elbow folds in the same plane as the rig's.
// Bone lengths stay the character's own; the hips are placed so the hip midpoint follows the rig's
// (scaled by the leg-length ratio k), then lifted so the lowest sole point sits where the rig's does.
// Unmapped bones (clavicles, neck, head, hands, toes, fingers, face) keep their bind local transform.
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { MJ_TO_THREE } from '../../rig.js';

const QM = new Quaternion().setFromRotationMatrix(MJ_TO_THREE);
const QMI = QM.clone().invert();
const mjQ = (q, out = new Quaternion()) => out.copy(QM).multiply(q).multiply(QMI);
const mjV = (v, out = new Vector3()) => out.set(v.y, v.z, v.x);

// role -> [rig body, alignment kind, child role (for the bone direction), rig child body]
export const ROLE_MAP = {
  hips: ['pelvis', 'frame'],
  spine: ['pelvis', 'frame'],
  spine1: ['lower_waist', 'frame'],
  chest: ['torso', 'frame'],
  l_thigh: ['left_thigh', 'leg', 'l_calf', 'left_shin'],
  l_calf: ['left_shin', 'leg', 'l_foot', 'left_foot'],
  l_foot: ['left_foot', 'frame'],
  r_thigh: ['right_thigh', 'leg', 'r_calf', 'right_shin'],
  r_calf: ['right_shin', 'leg', 'r_foot', 'right_foot'],
  r_foot: ['right_foot', 'frame'],
  l_upperArm: ['left_upper_arm', 'upperArm', 'l_foreArm', 'left_lower_arm'],
  l_foreArm: ['left_lower_arm', 'foreArm', 'l_hand', 'left_hand'],
  r_upperArm: ['right_upper_arm', 'upperArm', 'r_foreArm', 'right_lower_arm'],
  r_foreArm: ['right_lower_arm', 'foreArm', 'r_hand', 'right_hand'],
};

// 3ds Max Biped names (Rocketbox, many Mixamo-era rigs) -> roles
export const BIPED_ROLES = {
  'Bip01 Pelvis': 'hips', 'Bip01 Spine': 'spine', 'Bip01 Spine1': 'spine1', 'Bip01 Spine2': 'chest',
  'Bip01 Neck': 'neck', 'Bip01 Head': 'head',
  'Bip01 L Thigh': 'l_thigh', 'Bip01 L Calf': 'l_calf', 'Bip01 L Foot': 'l_foot', 'Bip01 L Toe0': 'l_toe',
  'Bip01 R Thigh': 'r_thigh', 'Bip01 R Calf': 'r_calf', 'Bip01 R Foot': 'r_foot', 'Bip01 R Toe0': 'r_toe',
  'Bip01 L UpperArm': 'l_upperArm', 'Bip01 L Forearm': 'l_foreArm', 'Bip01 L Hand': 'l_hand',
  'Bip01 R UpperArm': 'r_upperArm', 'Bip01 R Forearm': 'r_foreArm', 'Bip01 R Hand': 'r_hand',
};

// basis matrix with x = a, z = s orthogonalised against a, y = z x a
function basis(a, s) {
  const x = a.clone().normalize();
  const z = s.clone().addScaledVector(x, -s.dot(x)).normalize();
  const y = new Vector3().crossVectors(z, x);
  return new Matrix4().makeBasis(x, y, z);
}
const deltaFrom = (aT, sT, aR, sR) => new Quaternion().setFromRotationMatrix(
  basis(aR, sR).multiply(basis(aT, sT).transpose()),
);

// rig sole points (heel / toe under each foot), in the foot body's MuJoCo frame
function rigSolePoints(rig, body) {
  const b = rig.bodies[rig.index[body]];
  let lo = Infinity, hi = -Infinity, bottom = Infinity;
  for (const g of b.geoms) {
    if (g.type !== 'capsule') continue;
    const q = new Quaternion(g.quat[1], g.quat[2], g.quat[3], g.quat[0]);
    const ax = new Vector3(0, 0, g.size[1]).applyQuaternion(q);
    for (const s of [1, -1]) {
      const e = new Vector3(...g.pos).addScaledVector(ax, s);
      lo = Math.min(lo, e.x - g.size[0]); hi = Math.max(hi, e.x + g.size[0]);
      bottom = Math.min(bottom, e.z - g.size[0]);
    }
  }
  return [new Vector3(lo + 0.02, 0, bottom), new Vector3(hi - 0.02, 0, bottom)];
}

export class Retargeter {
  // model: Object3D holding the skeleton (it is re-oriented / scaled / moved here so it stands on the
  // floor at the origin facing +z). roleOf(bone) -> role or undefined. legScale: visual leg length
  // relative to the rig's (1 = same); keepScale: leave the model's size alone (k = its legs / the rig's).
  constructor(rig, model, roleOf, { legScale = 1, keepScale = false } = {}) {
    this.rig = rig;
    this.model = model;
    const bones = [];
    model.traverse((o) => { if (o.isBone) bones.push(o); }); // DFS pre-order: parents first
    this.bones = bones;
    this.role = {};
    for (const b of bones) { const r = roleOf(b); if (r) this.role[r] = b; }
    for (const r of Object.keys(ROLE_MAP)) if (!this.role[r]) throw new Error(`retarget: no bone for role ${r}`);

    // --- rig zero pose (three.js frame)
    const q0 = new Float64Array(28); q0[3] = 1;
    rig.offsetX = 0; rig.offsetY = 0;
    rig.fk(q0);
    const I = rig.index;
    this.r0inv = rig.bodies.map((_, i) => mjQ(rig.wquat[i]).invert());
    const p0 = (name) => mjV(rig.wpos[I[name]]);
    const rigLeg = p0('left_shin').distanceTo(p0('left_thigh')) + p0('left_foot').distanceTo(p0('left_shin'));
    this.rigSoles = { l: rigSolePoints(rig, 'left_foot'), r: rigSolePoints(rig, 'right_foot') };

    // --- normalise the character: face +z, y up, legs = k * rig legs, feet on the floor at the origin
    model.position.set(0, 0, 0); model.quaternion.identity(); model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    const wp = (r) => new Vector3().setFromMatrixPosition(this.role[r].matrixWorld);
    const hipMid = wp('l_thigh').add(wp('r_thigh')).multiplyScalar(0.5);
    const left = wp('l_thigh').sub(wp('r_thigh')).normalize();
    let up = wp('chest').sub(hipMid).normalize();
    const fwd = new Vector3().crossVectors(left, up).normalize();
    up = new Vector3().crossVectors(fwd, left).normalize();
    const R = new Matrix4().makeBasis(left, up, fwd).transpose(); // character frame -> stage frame
    model.quaternion.setFromRotationMatrix(R);
    const leg = wp('l_calf').distanceTo(wp('l_thigh')) + wp('l_foot').distanceTo(wp('l_calf'));
    if (keepScale) legScale = leg / rigLeg; // keep the character's own size, scale the root motion instead
    this.k = legScale;
    model.scale.setScalar((rigLeg * legScale) / leg);
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const hm = wp('l_thigh').add(wp('r_thigh')).multiplyScalar(0.5);
    model.position.set(-hm.x, -box.min.y, -hm.z);
    model.updateMatrixWorld(true);
    this.height = box.max.y - box.min.y;

    // --- bind data per bone (stage space)
    const tmpS = new Vector3(), tmpP = new Vector3();
    this.data = bones.map((b) => {
      const pw = b.parent.matrixWorld;
      const pq = new Quaternion(), ps = new Vector3(), pp = new Vector3();
      pw.decompose(pp, pq, ps);
      const wq = new Quaternion();
      b.matrixWorld.decompose(tmpP, wq, tmpS);
      return {
        bone: b,
        parentIdx: bones.indexOf(b.parent),
        parentQ: pq, parentP: pp, parentS: ps.x, parentInv: pw.clone().invert(),
        localP: b.position.clone(), localQ: b.quaternion.clone(),
        bindWQ: wq, bindWP: new Vector3().setFromMatrixPosition(b.matrixWorld),
        body: -1, A: null,
        wq: new Quaternion(), wp: new Vector3(),
      };
    });
    const D = (r) => this.data[bones.indexOf(this.role[r])];
    const Z = new Vector3(0, 0, 1);
    for (const [role, [body, kind, childRole, rigChild]] of Object.entries(ROLE_MAP)) {
      const d = D(role);
      d.body = I[body];
      let delta = new Quaternion();
      if (kind !== 'frame') {
        const aT = D(childRole).bindWP.clone().sub(d.bindWP);
        const aR = p0(rigChild).sub(p0(body));
        if (kind === 'leg') delta = deltaFrom(aT, Z, aR, Z);
        else {
          const side = role[0];
          const uT = D(`${side}_foreArm`).bindWP.clone().sub(D(`${side}_upperArm`).bindWP);
          const nT = new Vector3().crossVectors(uT, Z.clone().addScaledVector(uT.clone().normalize(), -Z.dot(uT.clone().normalize())));
          const uR = p0(`${side === 'l' ? 'left' : 'right'}_lower_arm`).sub(p0(`${side === 'l' ? 'left' : 'right'}_upper_arm`));
          const fR = p0(`${side === 'l' ? 'left' : 'right'}_hand`).sub(p0(`${side === 'l' ? 'left' : 'right'}_lower_arm`));
          const nR = new Vector3().crossVectors(uR, fR);
          delta = deltaFrom(aT, nT, aR, nR);
        }
      }
      d.A = delta.multiply(d.bindWQ);
    }
    this.hips = D('hips');
    this.thighL = D('l_thigh'); this.thighR = D('r_thigh');
    this.footL = D('l_foot'); this.footR = D('r_foot');
    for (const f of [this.footL, this.footR]) f.fwdLocal = Z.clone().applyQuaternion(f.bindWQ.clone().invert());

    // sole points of the character's feet (heel + toe at the floor), from the skinned vertices
    this.soles = { l: this._soles('l'), r: this._soles('r') };
    this._q = new Quaternion(); this._v = new Vector3(); this._v2 = new Vector3(); this._v3 = new Vector3();
  }

  _soles(side) {
    const foot = this.data[this.bones.indexOf(this.role[`${side}_foot`])];
    const ids = new Set([this.role[`${side}_foot`], this.role[`${side}_toe`]].filter(Boolean));
    let minZ = Infinity, maxZ = -Infinity, minY = Infinity, sx = 0, n = 0;
    const v = new Vector3();
    this.model.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const { position, skinIndex, skinWeight } = m.geometry.attributes;
      const bones = m.skeleton.bones;
      for (let i = 0; i < position.count; i++) {
        let w = 0;
        for (let c = 0; c < 4; c++) if (ids.has(bones[skinIndex.getComponent(i, c)])) w += skinWeight.getComponent(i, c);
        if (w < 0.5) continue;
        m.getVertexPosition(i, v); // bind pose: skinning is the identity here
        v.applyMatrix4(m.matrixWorld);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); minY = Math.min(minY, v.y); sx += v.x; n++;
      }
    });
    if (!n) { // no skinned feet (shouldn't happen): use the ankle
      const p = foot.bindWP;
      minZ = p.z - 0.06; maxZ = p.z + 0.15; minY = 0; sx = p.x; n = 1;
    }
    const x = sx / n;
    const inv = foot.bindWQ.clone().invert();
    return [new Vector3(x, minY, minZ + 0.02), new Vector3(x, minY, maxZ - 0.02)].map((p) => p.sub(foot.bindWP).applyQuaternion(inv));
  }

  // call after rig.pose(); writes bone.quaternion (all mapped bones) and the hips position
  update() {
    const { rig, data } = this;
    const q = this._q;
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const P = d.parentIdx >= 0 ? data[d.parentIdx] : null;
      const pq = P ? P.wq : d.parentQ;
      const pp = P ? P.wp : d.parentP;
      const ps = P ? P.parentS * P.bone.scale.x : d.parentS;
      d.wp.copy(d.localP).multiplyScalar(ps).applyQuaternion(pq).add(pp);
      if (d.body >= 0) {
        mjQ(rig.wquat[d.body], d.wq).multiply(this.r0inv[d.body]).multiply(d.A);
        d.bone.quaternion.copy(q.copy(pq).invert().multiply(d.wq));
      } else {
        d.wq.copy(pq).multiply(d.localQ);
      }
    }
    // hips placement: hip midpoint follows the rig's (x k), lowest sole point follows the rig's
    const I = rig.index, k = this.k, v = this._v, v2 = this._v2;
    const rigHip = mjV(rig.wpos[I.left_thigh], v).add(mjV(rig.wpos[I.right_thigh], v2)).multiplyScalar(0.5 * k);
    const delta = rigHip.sub(this._v3.copy(this.thighL.wp).add(this.thighR.wp).multiplyScalar(0.5));
    let rigMin = Infinity, tMin = Infinity;
    for (const [s, body, foot] of [['l', I.left_foot, this.footL], ['r', I.right_foot, this.footR]]) {
      for (const p of this.rigSoles[s]) {
        rigMin = Math.min(rigMin, v2.copy(p).applyQuaternion(rig.wquat[body]).add(rig.wpos[body]).z * k);
      }
      for (const p of this.soles[s]) tMin = Math.min(tMin, v2.copy(p).applyQuaternion(foot.wq).add(foot.wp).y);
    }
    delta.y = rigMin - tMin;
    for (const d of data) d.wp.add(delta);
    const h = this.hips;
    h.bone.position.copy(v2.copy(h.wp).applyMatrix4(h.parentInv));
  }

  // world (stage-space) positions for the contact shadow: feet + hips (valid after update())
  footPos(side) { return side === 'l' ? this.footL.wp : this.footR.wp; }
  footForward(side, out) { const f = side === 'l' ? this.footL : this.footR; return out.copy(f.fwdLocal).applyQuaternion(f.wq); }
  ankleRestY(side) { return (side === 'l' ? this.footL : this.footR).bindWP.y; }
  hipsPos() { return this.hips.wp; }
}
