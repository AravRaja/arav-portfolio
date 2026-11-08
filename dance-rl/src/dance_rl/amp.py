"""Adversarial motion prior (Peng et al. 2021) for phase 2.

Discriminator D: MLP 2 x 512 (ReLU) -> 1 over a W = 10 frame window (0.2 s at 50 Hz) of per-frame features
(track_ref.AMP_FEAT_DIM = 67: joint positions 21, joint velocities 21, root height 1, gravity in the torso
frame 3, end effectors (head, hands, feet) in the torso frame 15, root linear + angular velocity in the torso
frame 6), normalised with the library's per-feature mean / std (fixed, stored in the checkpoint).

  loss   = E_ref[(D - 1)^2] + E_pol[(D + 1)^2] + (w_gp / 2) E_ref[|grad_x D|^2]      (least-squares GAN, w_gp 10)
  r_amp  = max(0, 1 - 0.25 (D - 1)^2)
  reward = task reward + w_amp * r_amp

Reference windows: a random library move (or, with probability `idle_frac`, the IDLE standing reference so the
pre-drop wait is not "fake") and a random start in [0, L - W]. Policy windows: the env's `amp_obs` (the last W
frames of the episode, initialised from the reference at reset). Config block `amp:` (DEFAULT_AMP).
"""
from __future__ import annotations

from typing import Any, Sequence

import flax.linen as nn
import jax
import jax.numpy as jp
import numpy as np
import optax

from dance_rl import track_ref

DEFAULT_AMP = dict(
    w_amp=0.0,                  # 0 = AMP off
    window=10,
    hidden=[512, 512],
    learning_rate=1e-4,
    w_gp=10.0,
    disc_batch=4096,            # policy windows (and as many reference windows) per discriminator step
    disc_minibatches=4,         # discriminator steps per PPO epoch (x num_updates_per_batch per PPO update)
    idle_frac=0.05,
    std_floor=0.05,
    restore=True,               # load the discriminator from init_checkpoint when it has one
    features="full",            # "full" = all 67 per-frame features; "lower" = leg joints q / qd (12 + 12), root z,
                                # gravity + root lin / ang velocity in the torso frame (34): fusion's upper body
                                # (arms of another move) is not judged by the discriminator
)


def feature_cols(features: str, joint_names) -> np.ndarray | None:
    """Per-frame feature columns the discriminator sees (None = all). Layout: track_ref.AMP_FEAT_DIM."""
    if features == "full":
        return None
    if features != "lower":
        raise ValueError(f"amp.features must be full|lower, got {features!r}")
    _, lo = track_ref.upper_lower_sets(joint_names)
    return np.concatenate([lo, 21 + lo, [42], [43, 44, 45], np.arange(61, 67)]).astype(np.int32)


def select(x, cols, W: int):
    """(..., W * F) windows -> (..., W * len(cols)) (numpy or jax)."""
    if cols is None:
        return x
    sh = x.shape[:-1]
    return x.reshape(sh + (W, -1))[..., cols].reshape(sh + (W * len(cols),))


class Discriminator(nn.Module):
    hidden: Sequence[int] = (512, 512)

    @nn.compact
    def __call__(self, x):
        for h in self.hidden:
            x = nn.relu(nn.Dense(h)(x))
        return nn.Dense(1)(x)[..., 0]


def amp_reward(d):
    return jp.maximum(0.0, 1.0 - 0.25 * (d - 1.0) ** 2)


class AmpSetup:
    """Everything ppo_amp needs: the network, the fixed normaliser, the reference-window sampler, the config."""

    def __init__(self, cfg: dict, env):
        c = dict(DEFAULT_AMP)
        c.update(cfg or {})
        unknown = set(cfg or {}) - set(DEFAULT_AMP)
        if unknown:
            raise ValueError(f"unknown amp options: {unknown}")
        self.cfg = c
        self.w_amp = float(c["w_amp"])
        self.W = int(c["window"])
        assert env.amp_window == self.W, "env amp window != amp.window"
        ref = env.ref
        self.cols = feature_cols(c["features"], env._joint_names)
        self.F_full = ref.amp.shape[-1]
        self.F = self.F_full if self.cols is None else len(self.cols)
        self.in_dim = self.W * self.F
        n = ref.idle
        frames = np.concatenate([ref.amp[i, :ref.length[i]] for i in range(n)], 0)
        if self.cols is not None:
            frames = frames[:, self.cols]
        mean = frames.mean(0)
        std = np.maximum(frames.std(0), float(c["std_floor"]))
        self.mean = np.tile(mean, self.W).astype(np.float32)
        self.std = np.tile(std, self.W).astype(np.float32)
        self.net = Discriminator(tuple(int(h) for h in c["hidden"]))
        self.opt = optax.adam(float(c["learning_rate"]))
        self._ref_amp = jp.asarray(ref.amp)
        self._len = jp.asarray(ref.length)
        self._n, self._idle = n, ref.idle
        self.restore_params = None

    # ---------------------------------------------------------------- pure functions (jit/pmap safe)
    def init(self, key):
        return self.net.init(key, jp.zeros((1, self.in_dim)))

    def norm(self, x):
        return (select(x, self.cols, self.W) - self.mean) / self.std

    def apply(self, params, x):
        return self.net.apply(params, self.norm(x))

    def sample_ref(self, key, n):
        k1, k2, k3 = jax.random.split(key, 3)
        m = jax.random.randint(k1, (n,), 0, self._n)
        m = jp.where(jax.random.uniform(k3, (n,)) < self.cfg["idle_frac"], self._idle, m)
        hi = jp.maximum(self._len[m] - self.W + 1, 1)
        s = jp.floor(jax.random.uniform(k2, (n,)) * hi).astype(jp.int32)
        idx = s[:, None] + jp.arange(self.W)[None]
        return self._ref_amp[m[:, None], idx].reshape(n, -1)

    def loss(self, params, x_ref, x_pol):
        f = lambda x: self.net.apply(params, x)
        xr, xp = self.norm(x_ref), self.norm(x_pol)
        d_ref, d_pol = f(xr), f(xp)
        g = jax.vmap(jax.grad(lambda x: self.net.apply(params, x[None])[0]))(xr)
        gp = jp.mean(jp.sum(g ** 2, -1))
        ls = jp.mean((d_ref - 1.0) ** 2) + jp.mean((d_pol + 1.0) ** 2)
        loss = ls + 0.5 * self.cfg["w_gp"] * gp
        return loss, dict(disc_loss=loss, disc_ls=ls, disc_gp=gp, d_ref=jp.mean(d_ref), d_pol=jp.mean(d_pol))

    # ---------------------------------------------------------------- checkpoint
    def to_checkpoint(self, params) -> dict:
        out = dict(params=jax.tree_util.tree_map(np.asarray, params), mean=self.mean, std=self.std,
                   window=self.W, feat_dim=self.F, hidden=list(self.cfg["hidden"]), config=dict(self.cfg))
        if self.cols is not None:
            out["cols"] = np.asarray(self.cols)
        return out


# ---------------------------------------------------------------------- numpy inference (metrics)
def d_numpy(amp_ck: dict, x: np.ndarray) -> np.ndarray:
    """D(x) for (n, W * F) windows with a checkpoint's `amp` entry, in numpy (no jax needed)."""
    p = amp_ck["params"]["params"]
    if amp_ck.get("cols") is not None:
        x = select(x, np.asarray(amp_ck["cols"]), int(amp_ck["window"]))
    h = (x - amp_ck["mean"]) / amp_ck["std"]
    k = 0
    while f"Dense_{k + 1}" in p:
        h = np.maximum(h @ p[f"Dense_{k}"]["kernel"] + p[f"Dense_{k}"]["bias"], 0.0)
        k += 1
    return (h @ p[f"Dense_{k}"]["kernel"] + p[f"Dense_{k}"]["bias"])[..., 0]


def windows(feat: np.ndarray, W: int) -> np.ndarray:
    """(T, F) per-frame features -> (T - W + 1, W * F) sliding windows (oldest frame first)."""
    T = len(feat)
    idx = np.arange(T - W + 1)[:, None] + np.arange(W)[None]
    return feat[idx].reshape(len(idx), -1)


def make_setup(cfg: dict, env) -> AmpSetup | None:
    a = cfg.get("amp") or {}
    if float(a.get("w_amp", 0.0)) <= 0.0:
        return None
    return AmpSetup(a, env)


AMP_FEAT_DIM = track_ref.AMP_FEAT_DIM
__all__ = ["AmpSetup", "DEFAULT_AMP", "Discriminator", "amp_reward", "d_numpy", "make_setup", "windows",
           "AMP_FEAT_DIM", "Any"]
