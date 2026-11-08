"""Score card (PLAN sections 6 and 12) from a full-song rollout npz (+ optional episodes npz).

    python -m dance_rl.metrics --rollout runs/X/rollout.npz [--episodes runs/X/episodes.npz] \
        --out runs/X/metrics.json

Metrics (all over the post-drop part of the song unless noted):
  plv            phase-locking value of motion-energy peaks vs the beat grid (0 random, 1 perfect).
                 The grid is the rollout's own (features_version 1: anchored at the drop 8.37 s;
                 2: anchored at song.GRID_ANCHOR_V2 8.6304 s). plv_v1_grid / plv_v2_grid report both.
  plv_on_beat    plv * cos(2 pi plv_phase): +1 peaks on the beat, -1 on the "and" (|plv| can't tell)
  plv_phase      mean beat phase of the peaks (0 = on the beat, +0.25 = an eighth note late)
  peaks_per_beat motion-energy peaks per beat (context for plv)
  fall_rate      fraction of random-start 16 s episodes that fell (needs --episodes)
  fell_in_song   whether the full-song rollout fell
  amp_<group>    mean per-beat joint-position range (rad) per group arms/legs/torso, head = range
                 of head position relative to pelvis (m)
  groove         Pearson corr of joint trajectories vs themselves 1 bar earlier (1 = same move every bar)
  variety        1 - corr at a 4-bar lag (0 = identical loop, higher = changing phrases)
  predrop_motion mean motion energy m (m/s) between 0.5 s and the drop (should be ~0)
  motion_energy  mean m after the drop (m/s)
  jerk           mean |d^3 x / dt^3| of the end-effectors (m/s^3), lower = smoother
  net_turn_deg   total unwrapped change of the root (torso) heading over the whole song (deg,
                 + = counter-clockwise seen from above); not part of the score
  turn_rate_dps  net heading change after the drop / time after the drop (deg/s, signed)
  arrive_align_ms median signed offset (ms) of the post-hit stops (first hands+head speed minimum after
                 each speed peak, 10 Hz low-passed, within half a beat) from the beat nearest to that
                 peak, on the rollout's grid (- = before the beat); arrive_all_minima_ms uses every minimum,
                 speed_peak_ms the hands+head speed peaks
  clap_align_ms  median signed offset (ms) of motion-energy peaks from the nearest clap (beats 2 and 4 of
                 the v2 grid = backbeat_pulse maxima), over claps with a peak within half a beat
  bounce_amp_cm  p90 - p10 of pelvis z after the drop (cm); bounce_amp_detrended_cm: same after
                 removing the 1-bar moving mean
  knee_deg       mean knee flexion after the drop (deg, both knees, flexion = -q_knee)
  alternation_mirror  as alternation, but with q_right sign-flipped on shoulder1/shoulder2/ankle_x
  bounce_corr    Pearson corr after the drop of (pelvis z - its trailing 1-bar mean) with the bounce
                 reference z_ref = -0.015 cos(2 pi beat_phase) + 0.006 cos(4 pi bar_phase) on the rollout's grid
  travel_m_per_s mean over the post-drop frames of |trailing 1-bar mean of the root's world xy velocity|
                 (= net displacement per bar / bar time, so in-place sway and weight shifts don't count);
                 travel_net_m = |root xy at the end - at the drop|
  mean_cos_yaw   mean cos(root heading) after the drop (1 = always facing the camera on +x)
  clap_stop_align_ms  round 6: for each clap (backbeat_pulse maxima = beats 2 and 4 of the v2 grid), the
                 nearest post-hit stop (first hands+head speed minimum after a speed peak, as arrive_align_ms)
                 within half a beat; median signed offset stop - clap (ms, - = stop before the clap)
  beat_stop_align_ms  the same against every grid beat
  mirror_sim     round 6: Pearson corr (flattened, per-joint means removed, post-drop) of q(t) with
                 M q(t - 1 eight-count = 212 steps), M = left/right swap + MIRROR_FLIP (shoulder1, shoulder2,
                 ankle_x) + abdomen_z/abdomen_x sign flips. 1 = every 8-count is the mirror of the one before.
                 same_unit_sim = corr of q(t) with q(t - 212); self_sym = corr of q(t) with M q(t)
                 (high = left/right-symmetric movement); asym_rms_deg = rms of (q - M q)/2 over joints
  track_pose_err_deg  phase 2 (track-mode rollouts): mean over joints and post-drop frames of |q - q_ref| (deg)
                 vs the scheduled (choreographer, fused) reference; track_pose_err_deg_all over the whole song
  track_ee_err_cm  mean head/hands/feet position error (cm; hands/head in the torso frame, feet in the
                 pelvis frame) after the drop
  amp_score      mean discriminator output D over all 10-frame windows after the drop (needs a checkpoint with
                 an `amp` entry: --checkpoint, else the rollout's own checkpoint path); 1 = looks like the
                 library, -1 = looks like the policy at training time. amp_reward = mean max(0, 1 - (D-1)^2/4).
                 amp_score_library = the same D on the library's own windows (ceiling for comparison)
  tilt_*_deg     phase 2 round 2: torso tilt from vertical (policy mean / p90, ref_tilt_* for the reference),
                 tilt_diff_deg = mean angle between the policy and reference torso z axes; heading_diff_deg = mean
                 |wrap(yaw - yaw_ref)|; rom_ratio = sum over post-drop 8-count units and joints of std(q) / std(q_ref)
                 (rom_ratio_top_third: the third of units with the largest reference range)
  score          round-1..4 weighted composite (kept unchanged for the log; formula below)
  score_v2       round-5 composite (formula + weights in SCORE_V2_WEIGHTS below); replaces score for
                 comparing runs because |PLV| is blind to a constant grid shift and arrive-mode peaks
                 sit ~0.1 beat early on purpose
"""
from __future__ import annotations

import argparse
import json

import numpy as np

from dance_rl import song

FPS = song.FPS
BAR = int(round(song.BAR * FPS))       # 106
FLOORS = dict(plv=0.7, fall_rate=0.02, amp_min=0.05, predrop_motion=0.15)

# score_v2 (score_v2_version 2, round 6): each part is normalised to [0, 1]; score_v2 = sum(w * part) / sum(w)
# (sum w = 16). Version 1 (round 5) scored on_beat = max(plv_on_beat, 0) and clap = 1 - min(|clap_align_ms|,
# 80)/80 on motion-energy PEAKS, which arrive mode puts ~80 ms early on purpose, so both read ~0 for every
# arrive run; version 2 scores the STOPS instead (kept in score_v2_v1 for reference):
#   on_beat  1 - min(|beat_stop_align_ms|, 80) / 80           post-hit stops on the beats
#   clap     1 - min(|clap_stop_align_ms|, 80) / 80           post-hit stops on the claps (2 and 4)
#   arrive   1 - min(|arrive_align_ms - (-20)|, 150) / 150      post-hit stop ~20 ms before the beat
#   no_fall  1 - fall_rate                                      (100 random-start episodes)
#   amp      min(smallest group amplitude / 0.2, 1)             as in score
#   bounce   clip(bounce_corr, 0, 1)
#   travel   1 - min(travel_m_per_s / 0.3, 1)
#   facing   max(mean_cos_yaw, 0)
#   smooth   clip(1 - jerk / 2000, 0, 1)                        as in score
#   variety  clip(variety / 0.5, 0, 1)                          as in score
#   still    clip(1 - predrop_motion / 0.3, 0, 1)               as in score
SCORE_V2_VERSION = 2
SCORE_V2_WEIGHTS = dict(on_beat=3.0, clap=2.0, arrive=1.0, no_fall=3.0, amp=2.0, bounce=1.0,
                        travel=1.0, facing=1.0, smooth=0.5, variety=0.5, still=1.0)


def _corr_lag(Q: np.ndarray, lag: int) -> float:
    if len(Q) <= lag + 10:
        return float("nan")
    a, b = Q[lag:], Q[:-lag]
    a = a - a.mean(0)
    b = b - b.mean(0)
    den = np.sqrt((a ** 2).sum() * (b ** 2).sum())
    return float((a * b).sum() / den) if den > 1e-9 else 0.0


def grid_of(d) -> tuple[int, float]:
    """(features_version, grid anchor in s) of a rollout npz; rollouts before round 4 are v1."""
    fv = int(d["features_version"]) if "features_version" in d else 1
    anchor = float(d["grid_anchor"]) if "grid_anchor" in d else (song.DROP if fv == 1 else song.GRID_ANCHOR_V2)
    return fv, anchor


def _lowpass1(x: np.ndarray, hz: float = 10.0) -> np.ndarray:
    """First-order low-pass, the same filter the env uses for m."""
    a = (1.0 / FPS) / (1.0 / FPS + 1.0 / (2 * np.pi * hz))
    y = np.zeros_like(x, dtype=np.float64)
    for i in range(1, len(x)):
        y[i] = y[i - 1] + a * (x[i] - y[i - 1])
    return y


def _signed_to_nearest(times: np.ndarray, grid: np.ndarray) -> np.ndarray:
    i = np.clip(np.searchsorted(grid, times), 1, len(grid) - 1)
    lo, hi = grid[i - 1], grid[i]
    near = np.where(times - lo < hi - times, lo, hi)
    return times - near


def track_metrics(d, post, checkpoint: str | None = None) -> dict:
    """Phase-2 metrics from a track-mode rollout (see module docstring)."""
    res = {}
    te = d["track_err"]
    res["track_pose_err_deg"] = float(np.degrees(te[post, 0].mean()))
    res["track_pose_err_deg_all"] = float(np.degrees(te[:, 0].mean()))
    res["track_ee_err_cm"] = float(100.0 * te[post, 1].mean())
    # round 2: torso tilt / heading / range of motion vs the reference (ref_qpos root = yaw-normalised RSI frame)
    q, r = d["qpos"].astype(np.float64), d["ref_qpos"].astype(np.float64)

    def zax(x):
        w, a, b_, c = x[:, 3], x[:, 4], x[:, 5], x[:, 6]
        return np.stack([2 * (a * c + w * b_), 2 * (b_ * c - w * a), 1 - 2 * (a * a + b_ * b_)], -1)

    def yaw(x):
        w, a, b_, c = x[:, 3], x[:, 4], x[:, 5], x[:, 6]
        return np.arctan2(2 * (w * c + a * b_), 1 - 2 * (b_ * b_ + c * c))

    zp, zr = zax(q), zax(r)
    tp = np.degrees(np.arccos(np.clip(zp[:, 2], -1, 1)))
    tr = np.degrees(np.arccos(np.clip(zr[:, 2], -1, 1)))
    res["tilt_mean_deg"], res["tilt_p90_deg"] = float(tp[post].mean()), float(np.percentile(tp[post], 90))
    res["ref_tilt_mean_deg"], res["ref_tilt_p90_deg"] = float(tr[post].mean()), float(np.percentile(tr[post], 90))
    res["tilt_diff_deg"] = float(np.degrees(np.arccos(np.clip((zp * zr).sum(-1), -1, 1)))[post].mean())
    dy = np.degrees(np.angle(np.exp(1j * (yaw(q) - yaw(r)))))
    res["heading_diff_deg"] = float(np.abs(dy[post]).mean())
    # range of motion: per 8-count unit after the drop, sum over joints of std(q) / the same for q_ref
    u = np.floor((d["t"] - song.GRID_ANCHOR_V2) / song.EIGHT).astype(int)
    rp, rr = [], []
    for k in np.unique(u[post]):
        sel = post & (u == k)
        if sel.sum() >= 150:
            rp.append(q[sel, 7:].std(0)); rr.append(r[sel, 7:].std(0))
    if rp:
        rp, rr = np.array(rp), np.array(rr)
        res["rom_ratio"] = float(rp.sum() / rr.sum())
        hi = np.argsort(rr.sum(1))[-max(len(rr) // 3, 1):]
        res["rom_ratio_top_third"] = float(rp[hi].sum() / rr[hi].sum())
    names = [str(n) for n in d["track_term_names"]]
    res["track_terms_mean"] = {n: float(v) for n, v in zip(names, d["track_terms"][post].mean(0))}
    ck_path = checkpoint or (str(d["checkpoint"]) if "checkpoint" in d else None)
    if ck_path:
        import os
        from dance_rl import amp
        if os.path.exists(ck_path):
            from dance_rl.train import load_checkpoint
            amp_ck = load_checkpoint(ck_path).get("amp")
            if amp_ck is not None:
                W = int(amp_ck["window"])
                X = amp.windows(d["amp_feat"], W)
                okw = post[W - 1:]
                D = amp.d_numpy(amp_ck, X[okw])
                res["amp_score"] = float(D.mean())
                res["amp_reward"] = float(np.maximum(0.0, 1.0 - 0.25 * (D - 1.0) ** 2).mean())
                try:                       # D on the library itself (same config / filter as the run)
                    from dance_rl.track_env import make_track_env
                    cfg = load_checkpoint(ck_path)["config"]
                    env = make_track_env(dict(cfg, music_source="song"))
                    ref = env.ref
                    Xl = np.concatenate([amp.windows(ref.amp[i, :ref.length[i]], W) for i in range(ref.idle)])
                    res["amp_score_library"] = float(amp.d_numpy(amp_ck, Xl).mean())
                except Exception as e:     # library not on this machine
                    res["amp_score_library_error"] = f"{type(e).__name__}: {e}"
    return res


def ref_ee_speed(ref_qpos: np.ndarray) -> np.ndarray:
    """(T, 5) world speed (m/s) of head, hands, feet of a reference qpos sequence (CPU MuJoCo FK), the same
    finite difference as rollout's ee_speed. The rollout's ref_qpos root xy is the policy's (the reference's own
    translation is not stored), so root xy is held at frame 0's: the reference's limb + body-rotation speed, a
    property of the schedule only (independent of the policy)."""
    import mujoco
    from dance_rl.env import load_model
    from dance_rl.track_ref import EE_BODIES
    m = load_model(0.004)
    dd = mujoco.MjData(m)
    ids = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n) for n in EE_BODIES]
    P = np.zeros((len(ref_qpos), 5, 3))
    for i, qp in enumerate(ref_qpos):
        dd.qpos[:] = qp
        dd.qpos[0:2] = ref_qpos[0, 0:2]
        mujoco.mj_kinematics(m, dd)
        P[i] = dd.xpos[ids]
    sp = np.zeros(P.shape[:2], np.float32)
    sp[1:] = np.linalg.norm(np.diff(P, axis=0), axis=-1) * FPS
    return sp


def stop_metrics(t, ee_speed, post, anchor, n_beats) -> dict:
    """arrive / clap / beat stop alignment from (T, >=3) end-effector speeds (head + hands first); see the module
    docstring (arrive_align_ms, clap_stop_align_ms, beat_stop_align_ms). Round 3: also applied to the reference
    (ref_* keys) to see whether a late stop is the dancers' own timing."""
    from scipy.signal import find_peaks
    res = {}
    beats_all = song.beat_times(float(t[-1]), anchor=anchor)
    sp = ee_speed[:, :3].mean(1)                       # head + both hands, raw finite difference
    s_lp = _lowpass1(sp)
    sneg = -s_lp.copy()
    sneg[~post] = sneg[post].min() if post.any() else 0.0
    sprom = max(0.05 * (np.percentile(s_lp[post], 95) if post.any() else 0.0), 1e-3)
    mins, _ = find_peaks(sneg, distance=int(0.15 * FPS), prominence=sprom)
    mins = mins[post[mins]]
    spk, _ = find_peaks(np.where(post, s_lp, 0.0), distance=int(0.15 * FPS), prominence=sprom)
    spk = spk[post[spk]]
    if len(mins) >= 4 and len(spk) >= 4:
        # post-hit stop = the first speed minimum after each speed peak (within half a beat)
        j = np.searchsorted(mins, spk, side="right")
        ok = j < len(mins)
        stops, pk_ = mins[j[ok]], spk[ok]
        keep = (t[stops] - t[pk_]) <= 0.5 * song.BEAT
        stops, pk_ = stops[keep], pk_[keep]
        # offset of the stop from the beat nearest to its hit (peak), so a stop late by more than half
        # a beat doesn't wrap onto the next beat
        hit_beat = t[pk_] - _signed_to_nearest(t[pk_], beats_all)
        off = t[stops] - hit_beat
        res["arrive_align_ms"] = float(np.median(off) * 1e3) if len(off) else float("nan")
        res["arrive_within_60ms"] = float(np.mean(np.abs(off) <= 0.06)) if len(off) else 0.0
        res["arrive_all_minima_ms"] = float(np.median(_signed_to_nearest(t[mins], beats_all)) * 1e3)
        res["arrive_minima_per_beat"] = float(len(mins) / max(n_beats, 1))
        res["speed_peak_ms"] = float(np.median(_signed_to_nearest(t[spk], beats_all)) * 1e3)
        # round 6: stops vs claps / beats (per grid event: the nearest post-hit stop within half a beat)
        st_t = np.sort(t[stops])
        if len(st_t) >= 2:
            def stop_align(ev):
                ev = ev[(ev >= song.DROP) & (ev <= t[-1])]
                if not len(ev):
                    return float("nan"), 0
                jj = np.clip(np.searchsorted(st_t, ev), 1, len(st_t) - 1)
                near = np.where(np.abs(st_t[jj - 1] - ev) < np.abs(st_t[jj] - ev), st_t[jj - 1], st_t[jj])
                o = near - ev
                o = o[np.abs(o) <= 0.5 * song.BEAT]
                return (float(np.median(o) * 1e3) if len(o) else float("nan")), int(len(o))
            res["beat_stop_align_ms"], res["beat_stop_n"] = stop_align(beats_all)
            claps_ = song.GRID_ANCHOR_V2 + song.BEAT * (1 + 2 * np.arange(
                np.ceil((song.DROP - song.GRID_ANCHOR_V2 - song.BEAT) / (2 * song.BEAT)),
                np.floor((float(t[-1]) - song.GRID_ANCHOR_V2 - song.BEAT) / (2 * song.BEAT)) + 1))
            res["clap_stop_align_ms"], res["clap_stop_n"] = stop_align(claps_)
    return res


def compute(rollout: str, episodes: str | None = None, checkpoint: str | None = None) -> dict:
    from scipy.signal import find_peaks

    d = np.load(rollout)
    t = d["t"]
    m = d["motion_energy"]
    qpos = d["qpos"]
    q = qpos[:, 7:]
    post = t >= song.DROP
    res: dict = {}
    fv, anchor = grid_of(d)
    res["features_version"] = fv
    res["grid_anchor"] = anchor

    # --- PLV of motion-energy peaks vs beats (rollout's grid; both grids reported)
    mp = m.copy()
    mp[~post] = 0
    prom = max(0.05 * (np.percentile(m[post], 95) if post.any() else 0.0), 1e-3)
    peaks, _ = find_peaks(mp, distance=int(0.15 * FPS), prominence=prom)
    peaks = peaks[post[peaks]]
    n_beats = (t[post][-1] - song.DROP) / song.BEAT if post.any() else 1

    def plv_at(a):
        if len(peaks) < 4:
            return 0.0, float("nan")
        z = np.mean(np.exp(2j * np.pi * np.mod((t[peaks] - a) / song.BEAT, 1.0)))
        return float(np.abs(z)), float(np.angle(z) / (2 * np.pi))

    res["plv"], res["plv_phase"] = plv_at(anchor)
    res["plv_v1_grid"], res["plv_phase_v1_grid"] = plv_at(song.DROP)
    res["plv_v2_grid"], res["plv_phase_v2_grid"] = plv_at(song.GRID_ANCHOR_V2)
    # |PLV| is invariant to a constant grid shift, so it cannot tell on-beat from off-beat; the
    # projection PLV*cos(2 pi phase) can (+1 = all peaks on the beat, -1 = all on the "and"). Not scored.
    for sfx in ("", "_v1_grid", "_v2_grid"):
        ph = res["plv_phase" + sfx]
        res["plv_on_beat" + sfx] = float(res["plv" + sfx] * np.cos(2 * np.pi * ph)) if np.isfinite(ph) else 0.0
    res["n_peaks"] = int(len(peaks))
    res["peaks_per_beat"] = float(len(peaks) / max(n_beats, 1))

    # --- falls
    res["fell_in_song"] = bool(d["fell"].max() > 0)
    if res["fell_in_song"]:
        res["first_fall_time"] = float(t[np.argmax(d["fell"] > 0)])
    if episodes:
        e = np.load(episodes)
        res["fall_rate"] = float(e["fell"].mean())
        res["n_episodes"] = int(len(e["fell"]))
        if "terminated" in e:
            res["term_rate"] = float(e["terminated"].mean())

    # --- per-group amplitude (range within each beat, averaged over post-drop beats)
    head_rel = d["ee_pos"][:, 0] - d["pelvis_pos"]
    groups = {"arms": d["arm_idx"], "legs": d["leg_idx"], "torso": d["torso_idx"]}
    beat_edges = song.beat_times(float(t[-1]), anchor=anchor)
    beat_edges = beat_edges[beat_edges >= song.DROP]
    idx = np.searchsorted(t, beat_edges)
    amps = {g: [] for g in list(groups) + ["head"]}
    for i0, i1 in zip(idx[:-1], idx[1:]):
        seg = q[i0:i1 + 1]
        if len(seg) < 3:
            continue
        r = seg.max(0) - seg.min(0)
        for g, ix in groups.items():
            amps[g].append(r[ix].mean())
        h = head_rel[i0:i1 + 1]
        amps["head"].append((h.max(0) - h.min(0)).mean())
    for g, v in amps.items():
        res[f"amp_{g}"] = float(np.mean(v)) if v else 0.0

    # --- groove / variety / alternation (correlation at lags, post-drop)
    Qp = q[post]
    res["groove"] = _corr_lag(Qp, BAR)
    res["variety"] = 1.0 - _corr_lag(Qp, 4 * BAR) if len(Qp) > 4 * BAR + 10 else float("nan")
    L, R = d["left_idx"], d["right_idx"]
    h = BAR // 2
    if len(Qp) > h + 10:
        a, b = Qp[h:, L], Qp[:-h, R]
        a, b = a - a.mean(0), b - b.mean(0)
        den = np.sqrt((a ** 2).sum() * (b ** 2).sum())
        res["alternation"] = float((a * b).sum() / den) if den > 1e-9 else 0.0
        names = [str(n) for n in d["joint_names"]]
        sgn = np.array([-1.0 if any(names[j].endswith(k) for k in ("shoulder1", "shoulder2", "ankle_x"))
                        else 1.0 for j in R])
        b = Qp[:-h, R] * sgn
        b = b - b.mean(0)
        den = np.sqrt((a ** 2).sum() * (b ** 2).sum())
        res["alternation_mirror"] = float((a * b).sum() / den) if den > 1e-9 else 0.0

    # --- round 4: arrive / clap timing, bounce, knees
    res.update(stop_metrics(t, d["ee_speed"], post, anchor, n_beats))
    claps = song.GRID_ANCHOR_V2 + song.BEAT * (1 + 2 * np.arange(
        np.ceil((song.DROP - song.GRID_ANCHOR_V2 - song.BEAT) / (2 * song.BEAT)),
        np.floor((float(t[-1]) - song.GRID_ANCHOR_V2 - song.BEAT) / (2 * song.BEAT)) + 1))
    claps = claps[claps >= song.DROP]
    if len(peaks) >= 4 and len(claps):
        pt = t[peaks]
        j = np.clip(np.searchsorted(pt, claps), 1, len(pt) - 1)
        near = np.where(np.abs(pt[j - 1] - claps) < np.abs(pt[j] - claps), pt[j - 1], pt[j])
        off = near - claps
        off = off[np.abs(off) <= 0.5 * song.BEAT]
        res["clap_align_ms"] = float(np.median(off) * 1e3) if len(off) else float("nan")
    zp = d["pelvis_pos"][:, 2]
    if post.sum() > BAR:
        res["bounce_amp_cm"] = float((np.percentile(zp[post], 90) - np.percentile(zp[post], 10)) * 100)
        zdt = zp - np.convolve(zp, np.ones(BAR) / BAR, mode="same")
        sel = post & (t < t[-1] - song.BAR)
        res["bounce_amp_detrended_cm"] = float((np.percentile(zdt[sel], 90) - np.percentile(zdt[sel], 10)) * 100)
        # bounce tracking: detrend with the trailing 1-bar mean (as the env does) and correlate with z_ref
        Ccol = song.COL if fv == 1 else song.COL_V2
        F = d["features"]
        zref = -0.015 * np.cos(2 * np.pi * F[:, Ccol["beat_phase"]]) + 0.006 * np.cos(4 * np.pi * F[:, Ccol["bar_phase"]])
        cs = np.concatenate([[0.0], np.cumsum(zp.astype(np.float64))])
        n_ = np.minimum(np.arange(1, len(zp) + 1), BAR)
        ztr = zp - (cs[1:] - cs[np.arange(1, len(zp) + 1) - n_]) / n_
        sel = post & (np.arange(len(zp)) >= BAR)
        res["bounce_corr"] = float(np.corrcoef(ztr[sel], zref[sel])[0, 1]) if ztr[sel].std() > 1e-9 else 0.0
    # travel: trailing 1-bar mean of the root xy velocity = (xy(t) - xy(t - 1 bar)) / bar time
    xy = qpos[:, 0:2].astype(np.float64)
    i0 = int(np.argmax(post)) if post.any() else len(t)
    if len(t) - i0 > BAR:
        k = np.arange(max(i0, BAR), len(t))
        res["travel_m_per_s"] = float(np.mean(np.linalg.norm(xy[k] - xy[k - BAR], axis=1)) / (BAR / FPS))
        res["travel_net_m"] = float(np.linalg.norm(xy[-1] - xy[i0]))
    names = [str(n) for n in d["joint_names"]]
    # round 6: mirrored 8-counts (A, A', A, A' ...)
    from dance_rl.mirror import mirror_perm_sign
    perm, sgn = mirror_perm_sign(names)
    Mq = q[:, perm] * sgn
    U = 212
    ip = np.where(post)[0]
    ip = ip[ip >= U]
    if len(ip) > 10:
        def _corr(a, b):
            a = a - a.mean(0)
            b = b - b.mean(0)
            den = np.sqrt((a ** 2).sum() * (b ** 2).sum())
            return float((a * b).sum() / den) if den > 1e-9 else 0.0
        res["mirror_sim"] = _corr(q[ip], Mq[ip - U])
        res["same_unit_sim"] = _corr(q[ip], q[ip - U])
        res["self_sym"] = _corr(q[post], Mq[post])
        res["asym_rms_deg"] = float(np.degrees(np.sqrt(np.mean(((q[post] - Mq[post]) / 2) ** 2))))
    kn = [names.index("left_knee"), names.index("right_knee")]
    res["knee_deg"] = float(np.degrees(-q[post][:, kn].mean()))

    # --- energy
    pre = (t >= 0.5) & (t < song.DROP)
    res["predrop_motion"] = float(m[pre].mean())
    res["motion_energy"] = float(m[post].mean()) if post.any() else 0.0
    res["energy_corr"] = float(np.corrcoef(m[post], d["features"][post, song.COL["energy"]])[0, 1]) \
        if post.sum() > 10 and m[post].std() > 1e-6 else 0.0

    # --- jerk of end-effectors
    x = d["ee_pos"]
    j = np.diff(x, n=3, axis=0) * FPS ** 3
    jm = np.linalg.norm(j, axis=-1).mean(-1)
    res["jerk"] = float(np.mean(jm[post[3:]])) if post.any() else float(np.mean(jm))
    # --- heading (root quat w,x,y,z -> yaw of the torso x-axis), unwrapped
    w_, x_, y_, z_ = (qpos[:, 3 + i].astype(np.float64) for i in range(4))
    yaw = np.unwrap(np.arctan2(2 * (x_ * y_ + w_ * z_), 1 - 2 * (y_ ** 2 + z_ ** 2)))
    res["net_turn_deg"] = float(np.degrees(yaw[-1] - yaw[0]))
    if post.sum() > 1:
        tp = t[post]
        res["turn_rate_dps"] = float(np.degrees(yaw[post][-1] - yaw[post][0]) / (tp[-1] - tp[0]))
        res["mean_cos_yaw"] = float(np.mean(np.cos(yaw[post])))
    res["mean_reward"] = float(d["reward"].mean())
    if "track_err" in d:
        res.update(track_metrics(d, post, checkpoint))
        if "ref_qpos" in d:          # round 3: the reference's own stop timing (same detector, reference FK)
            rs = stop_metrics(t, ref_ee_speed(d["ref_qpos"]), post, anchor, n_beats)
            res.update({f"ref_{k}": v for k, v in rs.items()})
    names = [str(s) for s in d["term_names"]]
    res["terms_mean_weighted"] = {n: float(v) for n, v in zip(names, d["weighted_terms"].mean(0))}

    # --- composite score: higher is better. Each piece is clipped to [0, 1].
    amp_min = min(res["amp_arms"], res["amp_legs"], res["amp_torso"], res["amp_head"])
    fr = res.get("fall_rate", 1.0 if res["fell_in_song"] else 0.0)
    parts = dict(
        plv=res["plv"],
        no_fall=1.0 - fr,
        amp=np.clip(amp_min / 0.2, 0, 1),
        groove=np.clip(res["groove"], 0, 1) if np.isfinite(res["groove"]) else 0.0,
        variety=np.clip(res["variety"] / 0.5, 0, 1) if np.isfinite(res["variety"]) else 0.0,
        still=np.clip(1.0 - res["predrop_motion"] / 0.3, 0, 1),
        smooth=np.clip(1.0 - res["jerk"] / 2000.0, 0, 1),
    )
    w = dict(plv=3.0, no_fall=3.0, amp=2.0, groove=1.0, variety=0.5, still=1.0, smooth=0.5)
    res["score"] = float(sum(w[k] * parts[k] for k in w) / sum(w.values()))
    res["score_parts"] = {k: float(v) for k, v in parts.items()}
    fin = lambda x, f: f(x) if x is not None and np.isfinite(x) else 0.0
    parts2 = dict(
        on_beat=fin(res.get("beat_stop_align_ms"), lambda x: 1.0 - min(abs(x), 80.0) / 80.0),
        clap=fin(res.get("clap_stop_align_ms"), lambda x: 1.0 - min(abs(x), 80.0) / 80.0),
        arrive=fin(res.get("arrive_align_ms"), lambda x: 1.0 - min(abs(x + 20.0), 150.0) / 150.0),
        no_fall=1.0 - fr,
        amp=parts["amp"],
        bounce=fin(res.get("bounce_corr"), lambda x: float(np.clip(x, 0, 1))),
        travel=fin(res.get("travel_m_per_s"), lambda x: 1.0 - min(x / 0.3, 1.0)),
        facing=fin(res.get("mean_cos_yaw"), lambda x: max(x, 0.0)),
        smooth=parts["smooth"], variety=parts["variety"], still=parts["still"],
    )
    w2 = SCORE_V2_WEIGHTS
    res["score_v2"] = float(sum(w2[k] * parts2[k] for k in w2) / sum(w2.values()))
    res["score_v2_parts"] = {k: float(v) for k, v in parts2.items()}
    res["score_v2_version"] = SCORE_V2_VERSION
    # version-1 score_v2 (round 5: on_beat / clap from motion-energy peaks), for continuity with the log
    p1 = dict(parts2, on_beat=max(res["plv_on_beat"], 0.0),
              clap=fin(res.get("clap_align_ms"), lambda x: 1.0 - min(abs(x), 80.0) / 80.0))
    res["score_v2_v1"] = float(sum(w2[k] * p1[k] for k in w2) / sum(w2.values()))
    res["floors_ok"] = bool(res["plv"] >= 0 and fr <= 0.5 and np.isfinite(res["jerk"]))
    res["targets_met"] = bool(res["plv"] > FLOORS["plv"] and fr < FLOORS["fall_rate"]
                              and amp_min > FLOORS["amp_min"]
                              and res["predrop_motion"] < FLOORS["predrop_motion"])
    return res


def print_table(res: dict):
    keys = ["score", "score_v2", "score_v2_version", "score_v2_v1", "beat_stop_align_ms", "clap_stop_align_ms",
            "mirror_sim", "same_unit_sim", "self_sym", "asym_rms_deg", "features_version", "plv", "plv_phase", "plv_v1_grid", "plv_v2_grid", "plv_on_beat",
            "plv_on_beat_v1_grid", "plv_on_beat_v2_grid", "peaks_per_beat",
            "arrive_align_ms", "arrive_within_60ms", "arrive_all_minima_ms", "speed_peak_ms",
            "arrive_minima_per_beat", "clap_align_ms", "bounce_amp_cm",
            "bounce_amp_detrended_cm", "bounce_corr", "knee_deg", "travel_m_per_s", "travel_net_m",
            "mean_cos_yaw", "alternation_mirror", "fall_rate", "fell_in_song",
            "amp_arms", "amp_legs", "amp_torso", "amp_head", "groove", "variety", "alternation",
            "predrop_motion", "motion_energy", "energy_corr", "jerk", "net_turn_deg", "turn_rate_dps",
            "mean_reward", "targets_met", "track_pose_err_deg", "track_pose_err_deg_all", "track_ee_err_cm",
            "amp_score", "amp_reward", "amp_score_library", "term_rate", "tilt_mean_deg", "tilt_p90_deg",
            "ref_tilt_mean_deg", "ref_tilt_p90_deg", "tilt_diff_deg", "heading_diff_deg", "rom_ratio",
            "rom_ratio_top_third", "ref_clap_stop_align_ms", "ref_beat_stop_align_ms", "ref_arrive_align_ms"]
    print(f"{'metric':<18}{'value':>12}")
    print("-" * 30)
    for k in keys:
        if k in res:
            v = res[k]
            s = f"{v:12.3f}" if isinstance(v, float) else f"{str(v):>12}"
            print(f"{k:<18}{s}")
    print("-" * 30)
    for k, v in res.get("terms_mean_weighted", {}).items():
        if abs(v) > 1e-6:
            print(f"  r_{k:<15}{v:12.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rollout", required=True)
    ap.add_argument("--episodes", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--checkpoint", default=None, help="checkpoint with the discriminator (amp_score); default: "
                    "the rollout's own checkpoint")
    a = ap.parse_args()
    res = compute(a.rollout, a.episodes, a.checkpoint)
    print_table(res)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(res, f, indent=2)
        print("wrote", a.out)


if __name__ == "__main__":
    main()
