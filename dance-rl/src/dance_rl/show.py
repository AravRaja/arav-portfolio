"""Phase 2 finale: a rollout-only "show" config (no training) for the full song.

    python -m dance_rl.show --config configs/s9/c_show.yaml [--out runs/s9_c/rollout.npz] [--plan-only]

Config (top level `mode: show`):
    env_config:   the track config whose env runs the show (obs layout, track flags such as fused_target; it must
                  have fusion_random so the env reads the per-unit upper schedule)
    checkpoints:  {unfused: <pkl>, fused: <pkl>}  -- the policy acting in a unit is switched at the 8-count boundary:
                  `fused` on fused units, `unfused` everywhere else (both checkpoints must have the env's obs size)
    fusion:       {n_units: 4, exclude_breakdown: true, arms: other_genre_next}
    out:          rollout npz (same layout as dance_rl.rollout; + show_* arrays)

Schedule: the choreographer's section_energy schedule (A, A', B, B' per section, ' = mirrored copy) for the legs
of every unit. The `n_units` highest-energy units that are not breakdowns are FUSED: legs = the scheduled move X,
arms (abdomen + arms + head/hand targets) = Y = the next-highest-energy move of the other genre (gLH <-> gMH):
the largest choreographer size below X's among the other genre's moves not used by another fused unit (if none is
smaller, the smallest above). When X is a mirrored copy (a ' unit), Y is mirrored too, so A/A' stays a mirror pair.
"""
from __future__ import annotations

import argparse
import os

import numpy as np


def _genre(name: str) -> str:
    return name.split("_")[0]


def plan(env, n_fused: int = 4, exclude_breakdown: bool = True):
    """(lower (n_units,), upper (n_units,), fused unit list) for the song."""
    from dance_rl import track_ref
    table = np.asarray(env._bank[0])
    n_units, E, B, S = track_ref.song_units(table, env._anchor)
    lower = np.asarray(env.schedule[0]).copy()
    upper = lower.copy()
    ref = env.ref
    names, mir, size = ref.names, ref.mirror_of, ref.size
    base_of = lambda i: int(min(i, mir[i])) if mir[i] >= 0 else int(i)
    cand = [u for u in np.argsort(-E) if not (exclude_breakdown and B[u] >= 0.5)]
    fused = sorted(int(u) for u in cand[:n_fused])
    used = set()
    for u in sorted(fused, key=lambda u: -E[u]):           # highest-energy unit picks first
        x = int(lower[u])
        xb = base_of(x)
        other = [i for i in range(ref.idle) if base_of(i) == i and _genre(names[i]) != _genre(names[xb])
                 and i not in used]
        below = [i for i in other if size[i] < size[xb]]
        y = max(below, key=lambda i: size[i]) if below else min(other, key=lambda i: size[i])
        used.add(y)
        if x != xb and mir[y] >= 0:                         # X is a mirrored copy -> mirror the arms too
            y = int(mir[y])
        upper[u] = y
    return lower.astype(np.int32), upper.astype(np.int32), fused, E, B


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--plan-only", action="store_true", help="print the schedule and exit")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    import jax.numpy as jp
    from dance_rl import rollout, song
    from dance_rl.track_env import make_track_env
    from dance_rl.train import load_checkpoint, load_config, make_policy_fn

    sc = load_config(a.config)
    assert sc.get("mode") == "show", "dance_rl.show needs a `mode: show` config"
    cfg = dict(load_config(sc["env_config"]), music_source="song")
    assert cfg["track"].get("fusion_random"), "env_config needs track.fusion_random (per-unit upper schedule)"
    table = song.load_table(cfg["features"])
    T = len(table)
    env = make_track_env(cfg, feature_bank=table, rollout=True, episode_steps=T)
    fz = dict(n_units=4, exclude_breakdown=True, arms="other_genre_next")
    fz.update(sc.get("fusion") or {})
    assert fz["arms"] == "other_genre_next", fz["arms"]
    lower, upper, fused, E, B = plan(env, int(fz["n_units"]), bool(fz["exclude_breakdown"]))
    env.schedule = (lower, upper)
    env._sched_lo, env._sched_up = jp.asarray(lower), jp.asarray(upper)
    names = env.ref.names
    print("unit  t0(s)  energy  bd   legs (lower)                     arms (upper)")
    for u in range(len(lower)):
        t0 = env._anchor + u * song.EIGHT
        tag = "FUSED" if u in fused else ""
        print(f"{u:4d} {t0:6.2f}  {E[u]:.3f}  {B[u]:.2f}  {names[lower[u]]:<32s} "
              f"{(names[upper[u]] if upper[u] != lower[u] else '='):<32s} {tag}")
    print("fused units:", fused)
    if a.plan_only:
        return

    n_obs, n_act = int(env.observation_size), int(env.action_size)
    pols = {}
    for k in ("unfused", "fused"):
        ck = load_checkpoint(sc["checkpoints"][k])
        assert int(ck["obs_size"]) == n_obs, f"{k} checkpoint obs {ck['obs_size']} != env obs {n_obs}"
        assert int(ck["action_size"]) == n_act
        pols[k] = make_policy_fn(ck, n_obs, n_act, deterministic=True)
        print(f"{k}: {sc['checkpoints'][k]} (step {ck.get('step')}, obs {ck['obs_size']})")
    is_fused = np.zeros(len(lower), bool)
    is_fused[fused] = True
    fused_j = jp.asarray(is_fused)
    anchor = env._anchor

    def act_fn(obs, key, row):
        u = jp.floor((row.astype(jp.float32) / song.FPS - anchor) / song.EIGHT).astype(jp.int32)
        f = (u >= 0) & fused_j[jp.clip(u, 0, len(lower) - 1)]
        a0, _ = pols["unfused"](obs, key)
        a1, _ = pols["fused"](obs, key)
        return jp.where(f, a1, a0)

    ck_main = load_checkpoint(sc["checkpoints"]["unfused"])
    setup = (ck_main, cfg, env, pols["unfused"], table)
    out = a.out or sc["out"]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    extra = dict(show_fused_units=np.asarray(fused, np.int32),
                 show_checkpoints=np.array([sc["checkpoints"]["unfused"], sc["checkpoints"]["fused"]]),
                 show_env_config=np.array(sc["env_config"]))
    rollout.full_song(sc["checkpoints"]["unfused"], out, seed=a.seed, setup=setup, act_fn=act_fn, extra_save=extra)


if __name__ == "__main__":
    main()
