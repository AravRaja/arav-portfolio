"""Phase-2 motion library loader (numpy only; safe to import inside the env or on the Mac).

    from dance_rl.motion_lib import MotionLibrary
    lib = MotionLibrary.load("data/library/moves.npz")      # manifest.json next to it is optional
    ref = lib.get("gMH_sFM_d22_mMH0_ch01_s0", phase=0.25)    # quarter of the 8-count = beat 3
    ref["qpos"] (28,), ref["qvel"] (27,), ref["contacts"] (2,) [left, right]
    lib.get(mid, phase, mirrored=True)                       # the left/right mirrored move
    lib.mirror({"qpos": q, "qvel": v, "contacts": c})        # mirror arbitrary arrays (any leading dims)
    lib.fuse(upper_id, lower_id, phase)                      # arms + abdomen of one move, root + legs of another

Every move is one 8-count (2 bars = 4.25 s) at 112.94 BPM starting on a downbeat, sampled at 50 Hz:
frame i at t = i / 50 (i = 0..212). phase in [0, 1] maps to t = phase * 4.25 s, i.e. frame phase * 212.5;
beat_phase(i) = (t / 0.53125) mod 1, bar_phase(i) = (t / 2.125) mod 1. To drive a move from the song's
v2 grid: phase = (eight_count_position + bar_phase) / 2 with eight_count_position in {0, 1} (which bar
of the 8-count) -- or (count_in_8 + beat_phase) / 8.

Layout (identical to env.py's data.qpos / data.qvel): qpos[0:3] root (= TORSO body) position, qpos[3:7]
root quaternion (w, x, y, z), qpos[7:28] hinges in joint_names order; qvel[0:3] root linear velocity
(world), qvel[3:6] root angular velocity (body frame), qvel[6:27] hinges. Moves are re-rooted: root
xy = 0 and torso heading = +x (towards the camera) at frame 0.
"""
from __future__ import annotations

import json
import os
from typing import Dict, Optional, Union

import numpy as np

MOVE_SECONDS = 4.25
FPS = 50
FRAMES_PER_MOVE = MOVE_SECONDS * FPS      # 212.5; 213 stored frames (0..212)


def _nlerp_quat(q0, q1, a):
    q1 = np.where(np.sum(q0 * q1, axis=-1, keepdims=True) < 0, -q1, q1)
    q = (1 - a) * q0 + a * q1
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


class MotionLibrary:
    def __init__(self, data: Dict[str, np.ndarray], manifest: Optional[dict] = None):
        self.ids = [str(s) for s in data["ids"]]
        self.index = {m: i for i, m in enumerate(self.ids)}
        self.qpos = np.asarray(data["qpos"], np.float32)              # (N, 213, 28)
        self.qvel = np.asarray(data["qvel"], np.float32)              # (N, 213, 27)
        self.contacts = np.asarray(data["contacts"], bool)            # (N, 213, 2) [left, right]
        self.qpos_mirror = np.asarray(data["qpos_mirror"], np.float32)
        self.qvel_mirror = np.asarray(data["qvel_mirror"], np.float32)
        self.contacts_mirror = np.asarray(data["contacts_mirror"], bool)
        self.beat_phase = np.asarray(data["beat_phase"], np.float32)  # (213,)
        self.bar_phase = np.asarray(data["bar_phase"], np.float32)    # (213,)
        self.joint_names = [str(s) for s in data["joint_names"]]
        self.actuator_names = [str(s) for s in data["actuator_names"]]
        self.upper_qpos_idx = np.asarray(data["upper_qpos_idx"])      # abdomen + arms (9 hinges)
        self.lower_qpos_idx = np.asarray(data["lower_qpos_idx"])      # hips/knees/ankles (12 hinges)
        self.upper_qvel_idx = np.asarray(data["upper_qvel_idx"])
        self.lower_qvel_idx = np.asarray(data["lower_qvel_idx"])
        self.mirror_perm = np.asarray(data["mirror_perm"])
        self.mirror_sign = np.asarray(data["mirror_sign"], np.float32)
        self.manifest = manifest
        self.meta = {m["id"]: m for m in manifest["moves"]} if manifest else {}
        self.n_frames = self.qpos.shape[1]

    # ------------------------------------------------------------------ loading
    @classmethod
    def load(cls, path: str = "data/library/moves.npz", manifest: Optional[str] = None) -> "MotionLibrary":
        if os.path.isdir(path):
            path = os.path.join(path, "moves.npz")
        with np.load(path, allow_pickle=False) as z:
            data = {k: z[k] for k in z.files}
        mpath = manifest or os.path.join(os.path.dirname(path), "manifest.json")
        man = json.load(open(mpath)) if os.path.exists(mpath) else None
        return cls(data, man)

    def __len__(self):
        return len(self.ids)

    # ------------------------------------------------------------------ lookup
    def frame_of(self, phase: Union[float, np.ndarray]):
        """(i0, i1, alpha) for a phase in [0, 1] of the 8-count (clamped to the last stored frame)."""
        f = np.clip(np.asarray(phase, np.float64), 0.0, 1.0) * FRAMES_PER_MOVE
        f = np.minimum(f, self.n_frames - 1)
        i0 = np.minimum(np.floor(f).astype(int), self.n_frames - 2)
        return i0, i0 + 1, (f - i0)

    def get(self, move_id: Union[str, int], phase: Union[float, np.ndarray], mirrored: bool = False):
        """Reference state at `phase` (fraction of the move's 2 bars; scalar or array), linearly
        interpolated between the two neighbouring 50 Hz frames (root quaternion: normalised lerp)."""
        n = self.index[move_id] if isinstance(move_id, str) else int(move_id)
        Q = self.qpos_mirror[n] if mirrored else self.qpos[n]
        V = self.qvel_mirror[n] if mirrored else self.qvel[n]
        C = self.contacts_mirror[n] if mirrored else self.contacts[n]
        i0, i1, a = self.frame_of(phase)
        a = np.asarray(a)[..., None]
        q = (1 - a) * Q[i0] + a * Q[i1]
        q[..., 3:7] = _nlerp_quat(Q[i0][..., 3:7], Q[i1][..., 3:7], a)
        v = (1 - a) * V[i0] + a * V[i1]
        c = np.where(a < 0.5, C[i0], C[i1])
        return dict(qpos=q.astype(np.float32), qvel=v.astype(np.float32), contacts=c,
                    beat_phase=(np.asarray(phase) * 8.0) % 1.0, bar_phase=(np.asarray(phase) * 2.0) % 1.0)

    def move(self, move_id: Union[str, int], mirrored: bool = False):
        n = self.index[move_id] if isinstance(move_id, str) else int(move_id)
        if mirrored:
            return dict(qpos=self.qpos_mirror[n], qvel=self.qvel_mirror[n], contacts=self.contacts_mirror[n])
        return dict(qpos=self.qpos[n], qvel=self.qvel[n], contacts=self.contacts[n])

    # ------------------------------------------------------------------ mirror / fusion
    def mirror(self, move):
        """Left/right mirror (reflection y -> -y) of a move id or of a dict with any of qpos (..., 28),
        qvel (..., 27), contacts (..., 2). Joints use mirror.py's (perm, sign); root pos y -> -y,
        quat (w,x,y,z) -> (w,-x,y,-z), lin vel vy -> -vy, body ang vel (wx,wy,wz) -> (-wx,wy,-wz).
        mirror(mirror(m)) == m."""
        if isinstance(move, (str, int, np.integer)):
            n = self.index[move] if isinstance(move, str) else int(move)
            return dict(qpos=self.qpos_mirror[n], qvel=self.qvel_mirror[n], contacts=self.contacts_mirror[n])
        out = {}
        if "qpos" in move:
            Q = np.array(move["qpos"], copy=True)
            Q[..., 1] *= -1
            Q[..., 4] *= -1
            Q[..., 6] *= -1
            Q[..., 7:] = np.asarray(move["qpos"])[..., 7:][..., self.mirror_perm] * self.mirror_sign
            out["qpos"] = Q
        if "qvel" in move:
            V = np.array(move["qvel"], copy=True)
            V[..., 1] *= -1
            V[..., 3] *= -1
            V[..., 5] *= -1
            V[..., 6:] = np.asarray(move["qvel"])[..., 6:][..., self.mirror_perm] * self.mirror_sign
            out["qvel"] = V
        if "contacts" in move:
            out["contacts"] = np.asarray(move["contacts"])[..., ::-1].copy()
        return out

    def fuse(self, upper_id, lower_id, phase, upper_mirrored=False, lower_mirrored=False):
        """Naive part-wise reference: root + leg hinges from `lower_id`, abdomen + arm hinges from
        `upper_id`, both at the same phase. The root is the torso, so the result keeps the lower move's
        chest pose and swaps the abdomen; it is a target for a tracking policy, not a physical pose."""
        lo = self.get(lower_id, phase, lower_mirrored)
        up = self.get(upper_id, phase, upper_mirrored)
        q, v = lo["qpos"].copy(), lo["qvel"].copy()
        q[..., self.upper_qpos_idx] = up["qpos"][..., self.upper_qpos_idx]
        v[..., self.upper_qvel_idx] = up["qvel"][..., self.upper_qvel_idx]
        return dict(qpos=q, qvel=v, contacts=lo["contacts"])

    # ------------------------------------------------------------------ selection helpers
    def filter(self, genre=None, style=None, in_place=None, min_loopability=None):
        """Move ids matching the manifest metadata (needs manifest.json)."""
        out = []
        for m in self.ids:
            md = self.meta.get(m, {})
            if genre and md.get("genre") != genre:
                continue
            if style and md.get("style") != style:
                continue
            if in_place is not None and md.get("in_place") != in_place:
                continue
            if min_loopability is not None and md.get("loopability", 0) < min_loopability:
                continue
            out.append(m)
        return out
