"""Roll out a checkpoint.

Full song, deterministic, from t = 0 (one env, 50 Hz, whole 141.87 s):
    python -m dance_rl.rollout --checkpoint runs/X/checkpoints/latest.pkl --out runs/X/rollout.npz

Random-start 16 s episodes for fall-rate measurement:
    python -m dance_rl.rollout --checkpoint ... --episodes 100 --out runs/X/episodes.npz

Mirrored 8-counts without retraining (--mirror-odd-units): on odd units within a section (count_in_32 odd,
after the first post-drop unit) the policy sees the left/right-mirrored observation and its action is
mirrored back, so the dance runs A, A', A, A' (A' = mirror(A)). --mirror-blend B cross-fades the plain and
mirrored actions linearly over B seconds centred on each switch. --validate-mirror checks the obs mirror
against physically mirrored MuJoCo states (see validate_mirror).

Music always comes from the real song features (also for stage-2 checkpoints), so the video
and metrics are about the song. Physics keeps running after a fall in the full-song mode.

Phase 2 (config `mode: track`): the env is dance_rl.track_env.TrackEnv built with rollout=True, so the
full-song reference follows the choreographer's song schedule (track.choreo, default section_energy; fusion:
its second, upper-body schedule). rollout.npz then also has ref_qpos (T, 28: the scheduled, fused reference
pose, root xy = the policy's), ref_move (T, 2: upper, lower move index), ref_move_names, track_err (T, 2:
mean |q - q_ref| rad, mean end-effector error m), track_terms (T, 5) + track_term_names, amp_feat (T, 67: the
per-frame AMP features for metrics' amp_score) and schedule_lower / schedule_upper (per 8-count unit).
--episodes records `fell` (falls incl. the reference-relative fall) and `terminated` (+ tracking early
terminations). --mirror-odd-units also mirrors the track obs block (targets by the joint mirror, move codes by
their mirror sign flip); --validate-mirror is phase-1 only.
"""
from __future__ import annotations

import argparse
import os
import time

import numpy as np


def _setup(ckpt_path: str, config_path: str | None, features: str | None, **env_kw):
    from dance_rl import song
    from dance_rl.env import make_env
    from dance_rl.train import load_checkpoint, load_config, make_policy_fn

    ck = load_checkpoint(ckpt_path)
    if config_path is None:            # prefer the run's config.yaml (same dict as the checkpoint's)
        run_cfg = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(ckpt_path))), "config.yaml")
        config_path = run_cfg if os.path.exists(run_cfg) else None
    cfg = load_config(config_path) if config_path else ck["config"]
    cfg = dict(cfg, music_source="song")
    feat_path = features or cfg["features"]
    table = song.load_table(feat_path)
    fv = int(cfg.get("features_version", 1))
    want = song.N_FEATURES if fv == 1 else song.N_FEATURES_V2
    assert table.shape[1] == want, f"features_version {fv} but {feat_path} has {table.shape[1]} columns"
    print(f"features {feat_path} (version {fv}), config {config_path or 'from checkpoint'}")
    if cfg.get("mode", "dance") == "track":
        from dance_rl.track_env import make_track_env
        env = make_track_env(cfg, feature_bank=table, rollout=True, **env_kw)
    else:
        env = make_env(cfg, feature_bank=table, auto_reset_info=False, **env_kw)
    n_obs = int(env.observation_size)
    if int(ck.get("obs_size", n_obs)) < n_obs:      # e.g. a round-3 parent evaluated in a round-4 env
        from dance_rl.train import pad_obs_params
        print(f"padding checkpoint obs {ck['obs_size']} -> {n_obs}")
        ck = dict(ck, params=pad_obs_params(ck["params"], n_obs))
    policy = make_policy_fn(ck, n_obs, int(env.action_size), deterministic=True)
    return ck, cfg, env, policy, table


# ---------------------------------------------------------------------- left/right mirroring
def mirror_maps(env):
    """(obs_perm, obs_sign, act_perm, act_sign): mirror(o) = o[obs_perm] * obs_sign, same for actions.

    Reflection across the body's sagittal plane (torso frame: x forward, y left, z up; world: y -> -y,
    the camera looks along x). With S = diag(1, -1, 1) the mirrored torso rotation is R' = S R S, so a
    body-frame vector v (gravity, linear velocity) maps to S v and a body-frame pseudovector (angular
    velocity) to -S w = (-wx, wy, -wz). Joint pos / vel: dance_rl.mirror (joint order); prev_action:
    the same rule on the ACTUATOR names (the actuator order differs from the joint order: abdomen_y/z
    and ankle_y/x are swapped). Contacts [L, R] swap. Heading [sin yaw, cos yaw]: yaw -> -yaw. Music,
    phrase clock and the v2 music block are unchanged."""
    import mujoco
    from dance_rl import mirror

    m = env.mj_model
    jn = env._joint_names
    jperm, jsign = mirror.mirror_perm_sign(jn)
    an = [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, i) for i in range(m.nu)]
    assert [jn[m.actuator_trnid[i, 0] - 1] for i in range(m.nu)] == an, "actuator names != driven joints"
    gear = m.actuator_gear[:, 0]
    aperm, asign = mirror.mirror_perm_sign(an)
    assert np.allclose(gear[aperm], gear), "left/right gears differ"
    nj, nu = len(jn), m.nu
    perm, sign = [], []

    def add(p, sg, off):
        perm.extend(np.asarray(p) + off)
        sign.extend(sg)

    o = 0
    add(jperm, jsign, o); o += nj                       # qpos[7:]
    add(jperm, jsign, o); o += nj                       # qvel[6:]
    add([0, 1, 2], [1, -1, 1], o); o += 3               # gravity in the torso frame
    add([0, 1, 2], [-1, 1, -1], o); o += 3              # torso angular velocity (pseudovector)
    add([0], [1], o); o += 1                            # pelvis height
    add([0, 1, 2], [1, -1, 1], o); o += 3               # torso-frame linear velocity
    add([1, 0], [1, 1], o); o += 2                      # foot contacts L <-> R
    add(aperm, asign, o); o += nu                       # previous action (actuator order)
    n_music = 7 + (env._bank.shape[-1] - env._n_scalar)
    add(np.arange(n_music), np.ones(n_music), o); o += n_music
    blocks = dict(qpos=(0, nj), qvel=(nj, 2 * nj), grav=(2 * nj, 2 * nj + 3), angvel=(2 * nj + 3, 2 * nj + 6),
                  height=(2 * nj + 6, 2 * nj + 7), linvel=(2 * nj + 7, 2 * nj + 10), contact=(2 * nj + 10, 2 * nj + 12),
                  prev_action=(2 * nj + 12, 2 * nj + 12 + nu), music=(o - n_music, o))
    if env.cfg["phrase_clock"]:
        add([0, 1], [1, 1], o); blocks["phrase"] = (o, o + 2); o += 2
    if env.cfg["heading_obs"]:
        add([0, 1], [-1, 1], o); blocks["heading"] = (o, o + 2); o += 2
    if env.cfg["music_obs_v2"]:
        add(np.arange(10), np.ones(10), o); blocks["music_v2"] = (o, o + 10); o += 10
    if hasattr(env, "tcfg"):                            # phase-2 track block (track_env docstring)
        add([0, 1], [1, 1], o); blocks["track_phase"] = (o, o + 2); o += 2
        for k in range(3):                              # q_ref(t + k) - q: joint mirror
            add(jperm, jsign, o); o += nj
        blocks["track_targets"] = (o - 3 * nj, o)
        cs = np.array([1.0] * 4 + [-1.0] * 4)           # move code [a, b] -> mirrored copy [a, -b]
        add(np.arange(8), cs, o); add(np.arange(8), cs, o + 8); blocks["track_codes"] = (o, o + 16); o += 16
        if env.tcfg.get("root_obs"):                    # [sin, cos](yaw_ref - yaw) -> [-sin, cos]; g_ref - g -> S (g_ref - g)
            for k in range(3):
                add([0, 1, 2, 3, 4], [-1, 1, 1, -1, 1], o); o += 5
            blocks["track_root"] = (o - 15, o)
    assert o == int(env.observation_size), (o, env.observation_size)
    return (np.asarray(perm, np.int32), np.asarray(sign, np.float32), aperm.astype(np.int32),
            asign.astype(np.float32), blocks)


def mirror_weight(table, blend_s=0.0):
    """Per-row weight of the mirrored policy: 1 on odd 8-count units within a section (v2 count_in_32
    odd, eight_count_idx >= 1, i.e. after the first post-drop unit starts), else 0. With blend_s > 0 the
    0/1 steps are replaced by linear ramps of blend_s seconds centred on each switch."""
    from dance_rl import song
    c = song.COL_V2
    assert table.shape[1] == song.N_FEATURES_V2, "--mirror-odd-units needs a v2 feature table"
    k32 = np.round(table[:, c["count_in_32"]]).astype(int)
    unit = np.round(table[:, c["eight_count_idx"]]).astype(int)
    w = ((k32 % 2 == 1) & (unit >= 1)).astype(np.float32)
    if blend_s > 0:
        h = blend_s * song.FPS / 2.0
        sw = np.where(np.diff(w) != 0)[0] + 0.5             # switch between rows i and i + 1
        out = w.copy()
        r = np.arange(len(w), dtype=np.float64)
        for x in sw:
            i0 = int(x - 0.5)
            lo, hi = w[i0], w[i0 + 1]
            near = np.abs(r - x) < h
            frac = np.clip((r - (x - h)) / (2 * h), 0.0, 1.0)
            out[near] = (lo + (hi - lo) * frac[near]).astype(np.float32)
        w = out
    return w


def make_mirrored_policy(env, policy, table, blend_s=0.0):
    """policy'(obs, key, row): (1 - w) policy(obs) + w M policy(M obs), w = mirror_weight[row]."""
    import jax.numpy as jp
    operm, osign, aperm, asign, _ = mirror_maps(env)
    w_all = jp.asarray(mirror_weight(table, blend_s))
    operm, osign, aperm, asign = map(jp.asarray, (operm, osign, aperm, asign))

    def pol(obs, key, row):
        w = w_all[jp.clip(row, 0, w_all.shape[0] - 1)]
        a0, _ = policy(obs, key)
        a1, _ = policy(obs[operm] * osign, key)
        a1 = a1[aperm] * asign
        return (1.0 - w) * a0 + w * a1, w
    return pol


def validate_mirror(ckpt_path, config_path=None, features=None, seed=0, out=None):
    """mirror_obs(obs(state)) vs obs(mirror_state) on real states of a short rollout of the plain policy.

    mirror_state: hinge qpos / qvel -> M (joint order), root position y -> -y, root quaternion (w, x, y, z)
    -> (w, -x, y, -z) (R' = S R S), root linear velocity (world) y -> -y, root angular velocity (body frame)
    -> (-wx, wy, -wz); info.prev_action -> M (actuator order). Both states go through mjx.forward
    (after mjx.step, xpos / xmat lag qpos by one substep, so the comparison uses freshly forwarded data
    on both sides). Also checks one physics step: step(state, a) vs step(mirror_state, M a)."""
    import jax
    import jax.numpy as jp
    from mujoco import mjx

    ck, cfg, env, policy, table = _setup(ckpt_path, config_path, features)
    operm, osign, aperm, asign, blocks = mirror_maps(env)
    from dance_rl.mirror import mirror_perm_sign
    jperm, jsign = mirror_perm_sign(env._joint_names)
    jperm, jsign = jp.asarray(jperm), jp.asarray(jsign)
    operm_j, osign_j, aperm_j, asign_j = map(jp.asarray, (operm, osign, aperm, asign))
    mobs = lambda o: o[operm_j] * osign_j
    mact = lambda a: a[aperm_j] * asign_j
    nj = len(env._joint_names)
    pa0, pa1 = blocks["prev_action"]

    def mirror_data(d):
        qp, qv = d.qpos, d.qvel
        q0 = qp[3:7]
        qp2 = jp.concatenate([qp[0:1], -qp[1:2], qp[2:3], jp.array([q0[0], -q0[1], q0[2], -q0[3]]),
                              qp[7:][jperm] * jsign])
        qv2 = jp.concatenate([qv[0:1], -qv[1:2], qv[2:3], jp.array([-qv[3], qv[4], -qv[5]]),
                              qv[6:][jperm] * jsign])
        return qp2, qv2

    def fresh(qp, qv, ctrl):
        from mujoco_playground._src import mjx_env
        d = mjx_env.make_data(env.mj_model, qpos=qp, qvel=qv, ctrl=ctrl, impl="jax")
        return mjx.forward(env.mjx_model, d)

    def check(st, act):
        info = dict(st.info)
        d1 = fresh(st.data.qpos, st.data.qvel, st.data.ctrl)
        qp2, qv2 = mirror_data(st.data)
        d2 = fresh(qp2, qv2, mact(st.data.ctrl))
        info2 = dict(info, prev_action=mact(info["prev_action"]))
        o1 = env._obs(d1, info, env._contacts(d1))
        o2 = env._obs(d2, info2, env._contacts(d2))
        # one control step from both (physics symmetry + action map)
        s1 = env.step(st.replace(data=d1), act)
        s2 = env.step(st.replace(data=d2, info=info2), mact(act))
        # negative control: a naive mirror that only maps the joints / prev_action (no root-frame, contact
        # or heading flips) must FAIL on grav / angvel / linvel / contact / heading
        naive = o1[operm_j] * jp.where(osign_j < 0, 1.0, 1.0)
        naive = naive.at[:2 * nj].set(mobs(o1)[:2 * nj]).at[pa0:pa1].set(mobs(o1)[pa0:pa1])
        return mobs(o1) - o2, mobs(s1.obs) - s2.obs, jp.abs(o1 - st.obs), naive - o2

    rows = []
    for start in (300, 1500, 3000, 5200):              # 6 s (pre-drop), 30 s, 60 s, 104 s
        def body(carry, _):
            st, k = carry
            k, k1 = jax.random.split(k)
            a, _ = policy(st.obs, k1)
            nst = env.step(st, a)
            return (nst, k), (nst, a)

        @jax.jit
        def run(key):
            st = env.reset_at(key, start=start, track=0)
            _, (sts, acts) = jax.lax.scan(body, (st, key), None, length=300)
            idx = jp.arange(19, 300, 20)
            pick = jax.tree_util.tree_map(lambda x: x[idx], sts)
            a_next = acts[jp.minimum(idx + 1, 299)]
            return jax.vmap(check)(pick, a_next)

        rows.append(tuple(map(np.asarray, run(jax.random.PRNGKey(seed)))))
    e0, e1, stale, neg = (np.concatenate([r[i] for r in rows]) for i in range(4))
    print(f"mirror validation on {len(e0)} real states (s6 rollout, 4 song windows x 15 states)")
    print(f"{'block':12s} {'dims':>5s} {'max|err| obs':>14s} {'after 1 step':>13s} {'naive (neg ctl)':>16s} "
          f"{'stale vs fresh':>15s}")
    res = {}
    for name, (a, b) in blocks.items():
        m0, m1 = float(np.abs(e0[:, a:b]).max()), float(np.abs(e1[:, a:b]).max())
        res[name] = (m0, m1, float(np.abs(neg[:, a:b]).max()), float(stale[:, a:b].max()))
        print(f"{name:12s} {b - a:5d} {m0:14.2e} {m1:13.2e} {res[name][2]:16.2e} {res[name][3]:15.2e}")
    print(f"ALL          {e0.shape[1]:5d} {np.abs(e0).max():14.2e} {np.abs(e1).max():13.2e} {np.abs(neg).max():16.2e}")
    print("(after 1 step = mirror_obs(step(s, a)) vs step(mirror s, M a): physics symmetry incl. the action map;"
          " stale = rollout obs (xmat one substep behind qpos) vs a fresh forward of the same qpos)")
    ok = all(v[0] < 1e-5 for v in res.values())
    print("MIRROR_VALIDATION", "PASS" if ok else "FAIL")
    if out:
        import json
        with open(out, "w") as fh:
            json.dump(dict(per_block={k: dict(obs=v[0], step=v[1], naive=v[2], stale=v[3]) for k, v in res.items()},
                           passed=ok), fh, indent=1)
    return ok


def _track_out(env, st):
    """Per-step phase-2 outputs of a TrackEnv state (reference pose, move ids, errors, terms, AMP features)."""
    import jax.numpy as jp
    from dance_rl.track_env import TRACK_TERMS
    info = st.info
    ref = env.ref_at(info, info["start"] + info["ep_step"])
    rq = ref["qpos"].at[0:2].set(st.data.qpos[0:2])
    return dict(ref_qpos=rq, ref_move=jp.stack([ref["up"], ref["lo"]]), track_err=info["track_err"],
                track_terms=jp.stack([info["track_terms"][k] for k in TRACK_TERMS]), amp_feat=env.amp_frame(st.data))


def full_song(ckpt_path, out, config_path=None, features=None, seed=0, mirror_odd=False, mirror_blend=0.0,
              setup=None, act_fn=None, extra_save=None):
    """setup = (ck, cfg, env, policy, table) built by the caller (env with episode_steps = song length) and
    act_fn(obs, key, row) -> action replace the checkpoint's own policy (dance_rl.show: a per-unit checkpoint
    switch); extra_save adds arrays to the npz."""
    import jax
    import jax.numpy as jp
    from dance_rl.env import TERMS

    # placeholder env just to learn T; the real one runs the whole song as one episode
    from dance_rl import song
    from dance_rl.train import load_checkpoint, load_config
    ck = load_checkpoint(ckpt_path)
    cfg0 = load_config(config_path) if config_path else ck["config"]
    T = len(song.load_table(features or cfg0["features"]))
    if setup is None:
        ck, cfg, env, policy, table = _setup(ckpt_path, config_path, features, episode_steps=T)
    else:
        ck, cfg, env, policy, table = setup
    fv = int(cfg.get("features_version", 1))
    track = hasattr(env, "tcfg")
    if mirror_odd:
        mpol = make_mirrored_policy(env, policy, table, mirror_blend)
        print(f"mirror-odd-units on (blend {mirror_blend} s)")

    def body(carry, _):
        st, k = carry
        k, k1 = jax.random.split(k)
        if act_fn is not None:
            act, mw = act_fn(st.obs, k1, st.info["start"] + st.info["ep_step"]), jp.zeros(())
        elif mirror_odd:
            act, mw = mpol(st.obs, k1, st.info["start"] + st.info["ep_step"])
        else:
            act, _ = policy(st.obs, k1)
            mw = jp.zeros(())
        nst = env.step(st, act)
        out = dict(mirror_w=mw, qpos=nst.data.qpos, ee=nst.data.xpos[env._ee], pelvis=nst.data.xpos[env._pelvis], contact=nst.info["prev_contact"],
                   m=nst.info["m_lp"], reward=nst.reward, fell=nst.metrics["fell"], action=act,
                   terms=jp.stack([nst.info["terms"][t] for t in TERMS]),
                   weighted=jp.stack([nst.metrics[f"r_{t}"] for t in TERMS]))
        if track:
            out.update(_track_out(env, nst))
        return (nst, k), out

    @jax.jit
    def run(key):
        st = env.reset_at(key, start=0, track=0)
        _, outs = jax.lax.scan(body, (st, key), None, length=T - 1)
        o0 = jax.tree_util.tree_map(lambda x: x[None], _track_out(env, st)) if track else {}
        return st.data.qpos, st.data.xpos[env._ee], st.data.xpos[env._pelvis], outs, o0

    t0 = time.time()
    q0, ee0, p0, o, o0 = run(jax.random.PRNGKey(seed))
    o = jax.tree_util.tree_map(np.asarray, o)
    track_save = {}
    if track:
        from dance_rl.track_env import TRACK_TERMS
        tr = {k: np.concatenate([np.asarray(o0[k]), o[k]]) for k in o0}
        rnames = env.ref.names + ["IDLE"]
        track_save = dict(ref_qpos=tr["ref_qpos"].astype(np.float32), ref_move=tr["ref_move"].astype(np.int32),
                          ref_move_names=np.array(rnames), track_err=tr["track_err"].astype(np.float32),
                          track_terms=tr["track_terms"].astype(np.float32), track_term_names=np.array(TRACK_TERMS),
                          amp_feat=tr["amp_feat"].astype(np.float32), schedule_lower=env.schedule[0],
                          schedule_upper=env.schedule[1], track_mode=np.bool_(True))
    print(f"full-song rollout {T} frames in {time.time() - t0:.1f}s (incl. compile)")
    qpos = np.concatenate([np.asarray(q0)[None], o["qpos"]])
    ee = np.concatenate([np.asarray(ee0)[None], o["ee"]])
    pelvis = np.concatenate([np.asarray(p0)[None], o["pelvis"]])
    ee_speed = np.zeros(ee.shape[:2], np.float32)
    ee_speed[1:] = np.linalg.norm(np.diff(ee, axis=0), axis=-1) * song.FPS
    pad = lambda x: np.concatenate([np.zeros_like(x[:1]), x])
    np.savez_compressed(
        out, qpos=qpos.astype(np.float32), t=(np.arange(T) / song.FPS).astype(np.float32),
        ee_pos=ee.astype(np.float32), pelvis_pos=pelvis.astype(np.float32), ee_speed=ee_speed, ee_names=np.array(
            ["head", "hand_left", "hand_right", "foot_left", "foot_right"]),
        contacts=pad(o["contact"]).astype(np.float32), motion_energy=pad(o["m"]).astype(np.float32),
        reward=pad(o["reward"]), fell=pad(o["fell"]), actions=pad(o["action"]).astype(np.float32),
        terms=pad(o["terms"]).astype(np.float32), weighted_terms=pad(o["weighted"]).astype(np.float32),
        term_names=np.array(TERMS), features=table[:T], joint_names=np.array(env._joint_names),
        arm_idx=env._arm_idx, leg_idx=env._leg_idx, torso_idx=env._torso_idx,
        left_idx=env._left_idx, right_idx=env._right_idx,
        checkpoint=np.array(os.path.abspath(ckpt_path)), step=np.int64(ck.get("step", 0)),
        fell_any=np.bool_(o["fell"].max() > 0),
        mirror_w=np.concatenate([o["mirror_w"][:1], o["mirror_w"]]).astype(np.float32),
        mirror_odd_units=np.bool_(mirror_odd), mirror_blend=np.float32(mirror_blend),
        features_version=np.int32(fv), beat=np.float32(song.BEAT),
        grid_anchor=np.float64(song.DROP if fv == 1 else song.GRID_ANCHOR_V2),
        **track_save, **(extra_save or {}),
    )
    print(f"wrote {out}; mean reward/step {o['reward'].mean():.3f}; fell during song: {bool(o['fell'].max() > 0)}")


def episodes(ckpt_path, out, n, config_path=None, features=None, seed=0, mirror_odd=False, mirror_blend=0.0):
    import jax

    import jax.numpy as jp
    ck, cfg, env, policy, table = _setup(ckpt_path, config_path, features)
    L = env.episode_steps
    track = hasattr(env, "tcfg")
    if mirror_odd:
        mpol = make_mirrored_policy(env, policy, table, mirror_blend)
        print(f"mirror-odd-units on (blend {mirror_blend} s)")

    def one(key):
        st = env.reset_at(key)

        def body(carry, _):
            st, k, alive, fellc = carry
            k, k1 = jax.random.split(k)
            if mirror_odd:
                act, _ = mpol(st.obs, k1, st.info["start"] + st.info["ep_step"])
            else:
                act, _ = policy(st.obs, k1)
            nst = env.step(st, act)
            if track:                        # done = fall | tracking early termination; keep falls apart
                fell_ = jp.maximum(fellc, alive * nst.metrics["fell"])
            else:
                fell_ = fellc
            alive = alive * (1.0 - nst.done)
            return (nst, k, alive, fell_), (alive, nst.reward * alive)

        (_, _, _, fellc), (alive, rew) = jax.lax.scan(body, (st, key, 1.0, 0.0), None, length=L)
        return st.info["start"], alive, rew, fellc

    t0 = time.time()
    starts, alive, rew, fellc = jax.jit(jax.vmap(one))(jax.random.split(jax.random.PRNGKey(seed), n))
    starts, alive, rew, fellc = map(np.asarray, (starts, alive, rew, fellc))
    ended = alive[:, -1] < 0.5
    fell = (fellc > 0.5) if track else ended
    fall_step = np.where(ended, (alive > 0.5).sum(1), -1)
    extra = dict(terminated=ended) if track else {}
    np.savez_compressed(out, start_time=starts / 50.0, fell=fell, fall_time=fall_step / 50.0,
                        episode_return=rew.sum(1), episode_seconds=L / 50.0, **extra)
    print(f"{n} episodes x {L} steps in {time.time() - t0:.1f}s: fall rate {fell.mean():.3f}, "
          f"mean return {rew.sum(1).mean():.1f}" + (f", early-termination rate {ended.mean():.3f}" if track else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--config", default=None, help="override the config stored in the checkpoint")
    ap.add_argument("--features", default=None)
    ap.add_argument("--episodes", type=int, default=0, help="N random-start episodes (fall rate)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--mirror-odd-units", action="store_true",
                    help="odd 8-count units (within a section): mirrored obs in, mirrored action out (A, A', A, A')")
    ap.add_argument("--mirror-blend", type=float, default=0.0,
                    help="seconds of linear cross-fade between plain and mirrored actions at each switch")
    ap.add_argument("--validate-mirror", action="store_true",
                    help="check the obs mirror against physically mirrored states; --out gets a JSON report")
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    if a.validate_mirror:
        ok = validate_mirror(a.checkpoint, a.config, a.features, a.seed, a.out)
        raise SystemExit(0 if ok else 3)
    mk = dict(mirror_odd=a.mirror_odd_units or a.mirror_blend > 0, mirror_blend=a.mirror_blend)
    if a.episodes:
        episodes(a.checkpoint, a.out, a.episodes, a.config, a.features, a.seed, **mk)
    else:
        full_song(a.checkpoint, a.out, a.config, a.features, a.seed, **mk)


if __name__ == "__main__":
    main()
