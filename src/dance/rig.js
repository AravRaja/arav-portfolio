// The RL humanoid's rig for the browser: loads public/dance/finale.{json,bin} (exported by
// dance-rl/src/dance_rl/export_web.py) and rebuilds every body's pose with plain forward kinematics
// over the MuJoCo body tree, exactly as MuJoCo does it:
//   X_body = X_parent * T(pos) R(quat) * prod_joints [T(anchor) R(axis, q) T(-anchor)]
// (the torso's free joint replaces its local transform with the root position + quaternion).
// Poses are in MuJoCo world coordinates (z up, the dancer faces +x); MJ_TO_THREE turns that into
// three.js (y up, facing +z = towards the camera).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { loadFinaleData } from './data.js';

export const MJ_TO_THREE = new Matrix4().set(
  0, 1, 0, 0,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1,
);

export function loadFinale(base = '/dance/finale') {
  return loadFinaleData(base); // memoised: one download per base
}

const BREATH_PERIOD = 3.6; // seconds per breath while waiting for the drop

export class Rig {
  constructor({ header, frames }) {
    this.header = header;
    this.frames = frames;
    this.stride = header.stride;
    this.fps = header.fps;
    this.n = header.n_frames;
    this.drop = header.drop;
    this.bodies = header.model.bodies.map((b) => ({
      name: b.name,
      parent: b.parent,
      pos: new Vector3(...b.pos),
      quat: new Quaternion(b.quat[1], b.quat[2], b.quat[3], b.quat[0]),
      free: b.joints.some((j) => j.type === 'free'),
      joints: b.joints.filter((j) => j.type === 'hinge').map((j) => ({
        name: j.name,
        qpos: j.qpos,
        anchor: new Vector3(...j.pos),
        axis: new Vector3(...j.axis).normalize(),
      })),
      geoms: b.geoms,
    }));
    this.index = Object.fromEntries(this.bodies.map((b, i) => [b.name, i]));
    this.jointQ = Object.fromEntries(header.joint_names.map((n, i) => [n, 7 + i]));
    // World pose per body (MuJoCo frame, stage-centred)
    this.wpos = this.bodies.map(() => new Vector3());
    this.wquat = this.bodies.map(() => new Quaternion());
    this.world = this.bodies.map(() => new Matrix4());
    this.qpos = new Float64Array(28);
    this.idleQ = new Float64Array(28);
    this.readFrame(Math.round(7.5 * this.fps), this.idleQ); // standing, waiting for the drop
    this._buildStageOffset();
    this._q = new Quaternion();
    this._v = new Vector3();
    this._one = new Vector3(1, 1, 1);
  }

  readFrame(k, out) {
    const o = Math.max(0, Math.min(this.n - 1, k)) * this.stride + 1; // skip song time
    for (let i = 0; i < 28; i++) out[i] = this.frames[o + i];
    return out;
  }

  // The dancer travels ~2.5 m over the song; the stage keeps them centred by subtracting a slow
  // (±2.5 s) moving average of the root's floor position. Within a move they still step around.
  _buildStageOffset() {
    const n = this.n, w = Math.round(2.5 * this.fps);
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let k = 0; k < n; k++) { x[k] = this.frames[k * this.stride + 1]; y[k] = this.frames[k * this.stride + 2]; }
    const cx = new Float64Array(n + 1), cy = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) { cx[k + 1] = cx[k] + x[k]; cy[k + 1] = cy[k] + y[k]; }
    this.offX = new Float32Array(n);
    this.offY = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - w), b = Math.min(n, k + w + 1);
      this.offX[k] = (cx[b] - cx[a]) / (b - a);
      this.offY[k] = (cy[b] - cy[a]) / (b - a);
    }
  }

  // Interpolated qpos at song time t (seconds into now-get-busy.mp3).
  sample(t, out = this.qpos) {
    const x = Math.max(0, Math.min(this.n - 1, t * this.fps));
    const k0 = Math.floor(x), k1 = Math.min(this.n - 1, k0 + 1), a = x - k0;
    const o0 = k0 * this.stride + 1, o1 = k1 * this.stride + 1, F = this.frames;
    for (let i = 0; i < 28; i++) out[i] = F[o0 + i] * (1 - a) + F[o1 + i] * a;
    // quaternion: sign-aligned nlerp
    const dot = F[o0 + 3] * F[o1 + 3] + F[o0 + 4] * F[o1 + 4] + F[o0 + 5] * F[o1 + 5] + F[o0 + 6] * F[o1 + 6];
    const s = dot < 0 ? -1 : 1;
    let l = 0;
    for (let i = 3; i < 7; i++) { out[i] = F[o0 + i] * (1 - a) + s * F[o1 + i] * a; l += out[i] * out[i]; }
    l = Math.sqrt(l);
    for (let i = 3; i < 7; i++) out[i] /= l;
    this.offsetX = this.offX[k0] * (1 - a) + this.offX[k1] * a;
    this.offsetY = this.offY[k0] * (1 - a) + this.offY[k1] * a;
    return out;
  }

  // Pose for the stage at song time `t`. `idle` = waiting before the drop (wall-clock `clock` drives
  // the breathing); after the drop the breathing fades out within 0.4 s.
  pose(t, { idle = false, clock = 0, frozen = false } = {}) {
    const q = this.qpos;
    let breath;
    if (idle) {
      q.set(this.idleQ);
      this.offsetX = q[0];
      this.offsetY = q[1];
      breath = 1;
    } else {
      this.sample(t, q);
      breath = Math.max(0, Math.min(1, (this.drop + 0.4 - t) / 0.4));
    }
    if (breath > 0) {
      const c = frozen ? 0 : clock;
      const ph = Math.sin((2 * Math.PI * c) / BREATH_PERIOD);
      const J = this.jointQ;
      q[J.abdomen_y] += breath * 0.035 * ph; // chest rises and falls
      q[J.right_shoulder1] += breath * 0.03 * ph;
      q[J.left_shoulder1] -= breath * 0.03 * ph;
      q[2] += breath * 0.004 * ph;
    }
    this.fk(q);
    return q;
  }

  // The waiting pose (breathing, wall clock `clock`) as a qpos with the root at the stage origin, without posing the
  // rig: the crew crossfades from it into each dancer's first move as it falls in after the drop.
  idlePose(clock, frozen, out) {
    out.set(this.idleQ);
    out[0] = 0; out[1] = 0;
    const ph = Math.sin((2 * Math.PI * (frozen ? 0 : clock)) / BREATH_PERIOD);
    const J = this.jointQ;
    out[J.abdomen_y] += 0.035 * ph;
    out[J.right_shoulder1] += 0.03 * ph;
    out[J.left_shoulder1] -= 0.03 * ph;
    out[2] += 0.004 * ph;
    return out;
  }

  fk(q) {
    const B = this.bodies, P = this.wpos, Q = this.wquat, v = this._v, jq = this._q;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], p = P[i], r = Q[i];
      if (b.free) {
        p.set(q[0] - this.offsetX, q[1] - this.offsetY, q[2]);
        r.set(q[4], q[5], q[6], q[3]).normalize();
      } else {
        p.copy(b.pos).applyQuaternion(Q[b.parent]).add(P[b.parent]);
        r.copy(Q[b.parent]).multiply(b.quat);
        for (const j of b.joints) {
          // rotate about the joint anchor: p' = anchor - R' * anchor_local, anchor = p + R * anchor_local
          const anchorW = v.copy(j.anchor).applyQuaternion(r).add(p);
          jq.setFromAxisAngle(j.axis, q[j.qpos]);
          r.multiply(jq);
          p.copy(j.anchor).applyQuaternion(r).negate().add(anchorW);
        }
      }
      this.world[i].compose(p, r, this._one);
    }
  }

  // Max |FK - MuJoCo| over all bodies for the header's verification frame (metres).
  verify() {
    const { qpos, xpos } = this.header.verify;
    const q = Float64Array.from(qpos);
    this.offsetX = 0; this.offsetY = 0;
    this.fk(q);
    let err = 0;
    this.bodies.forEach((b, i) => {
      const r = xpos[b.name];
      err = Math.max(err, Math.abs(this.wpos[i].x - r[0]), Math.abs(this.wpos[i].y - r[1]), Math.abs(this.wpos[i].z - r[2]));
    });
    return err;
  }

  unitAt(t) {
    return this.header.units.find((u) => t >= u.t0 && t < u.t1) || null;
  }
}

// Local matrix of a geom inside its body. three.js capsules run along +y, MuJoCo's along +z.
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
export function geomMatrix(g) {
  const m = new Matrix4().compose(
    new Vector3(...g.pos),
    new Quaternion(g.quat[1], g.quat[2], g.quat[3], g.quat[0]),
    new Vector3(1, 1, 1),
  );
  if (g.type === 'capsule') m.multiply(Y_TO_Z);
  return m;
}
