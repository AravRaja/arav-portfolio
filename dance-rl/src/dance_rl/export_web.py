"""Export a full-song rollout for the portfolio site (PLAN §7): a small JSON header + a float32 binary.

    PYTHONPATH=src .venv-train/bin/python -m dance_rl.export_web \
        --rollout runs/s9_c/rollout_cpu.npz --out ../public/dance/finale [--fps 30] [--verify-png out.png]

Writes <out>.json (header) and <out>.bin. The binary is little-endian float32, frame-major, 29 values per frame:
    [song time (s), root pos x y z (m, MuJoCo world, z up), root quat w x y z, 21 hinge angles (rad, joint_names order)]
Frame k is song time k / fps (t = 0 is the start of now-get-busy.mp3; the drop hit is 8.37 s). The 50 Hz rollout
is resampled by linear interpolation (quaternions: sign-aligned nlerp).

The header also carries the humanoid's kinematic tree as MuJoCo compiles it (bodies in topological order with
parent, local pos / quat, hinge joints with anchor / unit axis / range, capsule + sphere geoms in the body frame:
capsules along local z, size = [radius, half-length]) so a client can rebuild the pose with plain forward
kinematics:  X_body = X_parent * T(pos) R(quat) * prod_joints [T(anchor) R(axis, q) T(-anchor)];  the torso's free
joint replaces its local transform with T(qpos[0:3]) R(qpos[3:7]).  `verify` holds one frame's qpos and MuJoCo's
own xpos / xquat for every body so the client FK can be checked to float precision.
"""
from __future__ import annotations

import argparse
import json
import os

import mujoco
import numpy as np

from dance_rl.humanoid_model import load_model

EIGHT = 4.25


def _resample(qpos: np.ndarray, src_fps: float, fps: float, duration: float):
    n = int(np.floor(duration * fps)) + 1
    t = np.arange(n) / fps
    x = np.clip(t * src_fps, 0, len(qpos) - 1)
    i0 = np.floor(x).astype(int)
    i1 = np.minimum(i0 + 1, len(qpos) - 1)
    a = (x - i0)[:, None]
    q0, q1 = qpos[i0], qpos[i1]
    out = (1 - a) * q0 + a * q1
    qa, qb = q0[:, 3:7], q1[:, 3:7]
    qb = np.where(np.sum(qa * qb, axis=1, keepdims=True) < 0, -qb, qb)
    qq = (1 - a) * qa + a * qb
    out[:, 3:7] = qq / np.linalg.norm(qq, axis=1, keepdims=True)
    return t, out


def _model_desc(m: mujoco.MjModel):
    name = lambda t, i: mujoco.mj_id2name(m, t, i)
    bodies = []
    for b in range(1, m.nbody):
        joints = []
        for j in range(m.body_jntadr[b], m.body_jntadr[b] + m.body_jntnum[b]):
            jt = int(m.jnt_type[j])
            if jt == mujoco.mjtJoint.mjJNT_FREE:
                joints.append(dict(name=name(mujoco.mjtObj.mjOBJ_JOINT, j), type="free"))
                continue
            assert jt == mujoco.mjtJoint.mjJNT_HINGE, jt
            joints.append(dict(name=name(mujoco.mjtObj.mjOBJ_JOINT, j), type="hinge",
                               qpos=int(m.jnt_qposadr[j]), pos=m.jnt_pos[j].round(6).tolist(),
                               axis=m.jnt_axis[j].round(6).tolist(),
                               range=np.degrees(m.jnt_range[j]).round(2).tolist()))
        geoms = []
        for g in range(m.ngeom):
            if m.geom_bodyid[g] != b:
                continue
            gt = int(m.geom_type[g])
            kind = {mujoco.mjtGeom.mjGEOM_CAPSULE: "capsule", mujoco.mjtGeom.mjGEOM_SPHERE: "sphere"}[gt]
            size = [float(m.geom_size[g, 0])] + ([float(m.geom_size[g, 1])] if kind == "capsule" else [])
            geoms.append(dict(name=name(mujoco.mjtObj.mjOBJ_GEOM, g), type=kind, size=np.round(size, 6).tolist(),
                              pos=m.geom_pos[g].round(6).tolist(), quat=m.geom_quat[g].round(6).tolist()))
        bodies.append(dict(name=name(mujoco.mjtObj.mjOBJ_BODY, b), parent=int(m.body_parentid[b]) - 1,
                           pos=m.body_pos[b].round(6).tolist(), quat=m.body_quat[b].round(6).tolist(),
                           joints=joints, geoms=geoms))
    return bodies


def _units(d, names):
    anchor = float(d["grid_anchor"])
    lo, up = np.asarray(d["schedule_lower"]), np.asarray(d["schedule_upper"])
    fused = set(int(u) for u in np.asarray(d["show_fused_units"]))
    out = []
    for u in range(len(lo)):
        legs, arms = str(names[lo[u]]), str(names[up[u]])
        out.append(dict(u=u, t0=round(anchor + u * EIGHT, 4), t1=round(anchor + (u + 1) * EIGHT, 4),
                        move=legs, legs=legs, arms=arms, fused=u in fused, mirrored=legs.endswith("_M"),
                        label=(f"FUSED  LEGS: {legs}  ARMS: {arms}" if u in fused else legs)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rollout", required=True)
    ap.add_argument("--out", required=True, help="path without extension")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--verify-t", type=float, default=41.04)
    ap.add_argument("--seed", type=int, default=None, help="recorded in the header")
    a = ap.parse_args()

    d = np.load(a.rollout, allow_pickle=False)
    qpos = np.asarray(d["qpos"], np.float64)
    src_fps = 50.0
    duration = float(d["t"][-1])
    m = load_model()
    jn = [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, j) for j in range(1, m.njnt)]
    assert jn == [str(s) for s in d["joint_names"]], "joint order differs from the rollout"
    t, q = _resample(qpos, src_fps, a.fps, duration)
    frames = np.concatenate([t[:, None], q], axis=1).astype("<f4")
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    frames.tofile(a.out + ".bin")

    # verification frame: MuJoCo FK of the 50 Hz qpos at verify_t
    i = int(round(a.verify_t * src_fps))
    md = mujoco.MjData(m)
    md.qpos[:] = qpos[i]
    mujoco.mj_kinematics(m, md)
    bnames = [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, b) for b in range(1, m.nbody)]
    verify = dict(t=i / src_fps, qpos=qpos[i].round(7).tolist(),
                  xpos={n: md.xpos[b + 1].round(7).tolist() for b, n in enumerate(bnames)},
                  xquat={n: md.xquat[b + 1].round(7).tolist() for b, n in enumerate(bnames)})

    names = [str(s) for s in d["ref_move_names"]]
    header = dict(
        format="dance-finale/1",
        bin=os.path.basename(a.out) + ".bin",
        layout="float32 LE, frame-major, 29 per frame: [song_t, root_x, root_y, root_z, root_qw, root_qx, root_qy, "
               "root_qz, 21 hinge angles in joint_names order]; MuJoCo world (z up, dancer faces +x)",
        stride=29, fps=a.fps, n_frames=int(len(frames)), duration=round(duration, 4),
        drop=8.37, grid_anchor=float(d["grid_anchor"]), beat=float(d["beat"]), eight=EIGHT,
        joint_names=jn,
        units=_units(d, names),
        source=dict(rollout=os.path.relpath(a.rollout), checkpoints=[str(s) for s in d["show_checkpoints"]],
                    env_config=str(d["show_env_config"]), seed=a.seed, fell=bool(d["fell_any"]),
                    note="finale (configs/s9/c_show.yaml) re-rolled on CPU MJX on the Mac; deterministic policy"),
        model=dict(bodies=_model_desc(m)),
        verify=verify,
    )
    with open(a.out + ".json", "w") as f:
        json.dump(header, f, separators=(",", ":"))
    print(f"wrote {a.out}.bin ({os.path.getsize(a.out + '.bin') / 1e6:.2f} MB, {len(frames)} frames @ {a.fps} fps)"
          f" and {a.out}.json ({os.path.getsize(a.out + '.json') / 1e3:.1f} kB)")

    # self-check: numpy FK with the exported description reproduces MuJoCo
    err = _check_fk(header["model"]["bodies"], np.array(verify["qpos"]), verify["xpos"])
    print(f"numpy FK from the exported tree vs MuJoCo xpos at t={verify['t']}: max |d| = {err:.2e} m")


def _qmul(a, b):
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return np.array([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2])


def _qrot(q, v):
    w, x, y, z = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])
    return R @ np.asarray(v)


def _check_fk(bodies, qpos, xpos_ref):
    P, Q, err = [], [], 0.0
    for b in bodies:
        if b["joints"] and b["joints"][0]["type"] == "free":
            p, q = qpos[0:3].copy(), qpos[3:7] / np.linalg.norm(qpos[3:7])
        else:
            pp, pq = P[b["parent"]], Q[b["parent"]]
            p, q = pp + _qrot(pq, b["pos"]), _qmul(pq, b["quat"])
            for j in b["joints"]:
                ang = qpos[j["qpos"]]
                ax = np.asarray(j["axis"])
                jq = np.concatenate([[np.cos(ang / 2)], np.sin(ang / 2) * ax])
                anchor = p + _qrot(q, j["pos"])
                q = _qmul(q, jq)
                p = anchor - _qrot(q, j["pos"])
        P.append(p)
        Q.append(q)
        err = max(err, float(np.abs(p - np.asarray(xpos_ref[b["name"]])).max()))
    return err


if __name__ == "__main__":
    main()
