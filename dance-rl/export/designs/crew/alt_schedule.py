"""Alternate crew schedules without touching dance_rl: the finale show (configs/s9/c_show.yaml) with the
section_energy choreographer's per-tier move cursors started at CHOREO_OFF instead of 0, so every section
gets a different A/B move pair (same tiers, same A A' B B' structure, same fused-unit rule). Same
deterministic policies, no training.

    cd dance-rl && CHOREO_OFF=2 PYTHONPATH=src .venv-train/bin/python export/designs/crew/alt_schedule.py \
        --config configs/s9/c_show.yaml --out runs/crew/rollout_off2.npz [--plan-only]
"""
import os
import sys

import numpy as np

from dance_rl import song, track_ref

OFF = int(os.environ.get("CHOREO_OFF", "0"))


def choreograph(table, ref, mode="section_energy", seed=0, anchor=song.GRID_ANCHOR_V2):
    # = track_ref.choreograph with cursor = [OFF] * 3
    n_units, E, B, S = track_ref.song_units(table, anchor)
    N = ref.idle
    mir = ref.mirror_of
    base = np.array([i for i in range(N) if mir[i] < 0 or i < mir[i]])
    order = base[np.argsort(ref.size[base], kind="stable")]
    tiers = [t if len(t) else order for t in np.array_split(order, 3)]
    hi_e = np.quantile(E, 2.0 / 3.0)
    cursor = [OFF, OFF, OFF]
    lower = np.zeros(n_units, np.int32)
    sec_start, pair = 0, None
    for u in range(n_units):
        if u == 0 or S[u] != S[u - 1]:
            sec_start = u
            su = S == S[u]
            tier = 0 if B[su].mean() > 0.5 else (2 if E[su].mean() >= hi_e else 1)
            tl = tiers[tier]
            pair = (tl[cursor[tier] % len(tl)], tl[(cursor[tier] + 1) % len(tl)])
            cursor[tier] += 2
        k = u - sec_start
        mv = pair[(k // 2) % 2]
        if k % 2 == 1 and mir[mv] >= 0:
            mv = mir[mv]
        lower[u] = mv
    rng = np.random.default_rng(seed + 1)
    upper = rng.choice(base, size=n_units) if len(base) else lower.copy()
    return lower, upper.astype(np.int32)


track_ref.choreograph = choreograph

if __name__ == "__main__":
    from dance_rl import show
    show.main()
