"""Brax PPO training for the dance env.

    python -m dance_rl.train --config configs/stage1_stand.yaml [--init-checkpoint ckpt.pkl]
        [--steps N] [--num-envs N] [--run-name NAME] [--smoke]

Writes runs/<run>/progress.jsonl (one line per eval: reward, per-term per-step means, fall rate,
sps), runs/<run>/checkpoints/ckpt_<step>.pkl + latest.pkl + final.pkl + best.pkl, and
runs/<run>/config.yaml. best.pkl = the trained eval checkpoint (step > 0; step 0 is the untrained
init) with the lowest eval fall_rate, ties -> the latest; checkpoints/best.json records its step
(track mode: lowest term_rate = falls + tracking early terminations; best.json's "fall_rate" field holds it;
`checkpoint.best: term_pose` minimises term_rate + 0.05 * track_pose_err_deg instead).

Phase 2 (config `mode: track`, see dance_rl.track_env): the env is TrackEnv, training wraps it with
wrap_for_track_training (full reset on done), progress also logs the track_* terms / errors, and when the
config has `amp.w_amp > 0` training runs dance_rl.ppo_amp (PPO + discriminator) and every checkpoint gets an
`amp` entry (discriminator params + feature normaliser). A top-level `init_checkpoint:` in the config is used
when --init-checkpoint is not given. Configs without `mode` behave exactly as before.
"""
from __future__ import annotations

import argparse
import functools
import json
import os
import pickle
import shutil
import time

import yaml


def load_config(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def save_checkpoint(path: str, params, cfg: dict, step: int, obs_size: int, action_size: int,
                    extra: dict | None = None):
    import jax
    import numpy as np

    params = jax.tree_util.tree_map(lambda x: np.asarray(x), params)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(dict(params=params, config=cfg, step=int(step), obs_size=obs_size,
                         action_size=action_size, **(extra or {})), f)
    os.replace(tmp, path)


def load_checkpoint(path: str) -> dict:
    with open(path, "rb") as f:
        return pickle.load(f)


def pad_obs_params(params, new_obs: int, new_var: float = 0.5):
    """Grow a (normalizer, policy, value) param tuple to `new_obs` inputs; new inputs are appended.

    The new first-layer kernel rows are zero, so the networks ignore the new inputs and the
    padded checkpoint acts exactly like the parent at step 0. The normalizer gets mean 0 and
    variance `new_var` (0.5 = variance of a uniformly sweeping sin/cos) for the new dims, with
    summed_variance = new_var * count so Welford updates continue smoothly from the old count.
    """
    import numpy as np

    norm, pol, val = params[0], params[1], params[2]
    old = int(np.asarray(norm.mean).shape[-1])
    k = new_obs - old
    if k == 0:
        return params
    assert k > 0, f"checkpoint has {old} obs inputs, env has {new_obs}: can only grow"
    c = norm.count
    cnt = float(c.hi) * 2.0 ** 32 + float(c.lo) if hasattr(c, "hi") else float(c)
    cat = lambda a, v: np.concatenate([np.asarray(a), np.full(k, v, np.asarray(a).dtype)])
    norm = norm.replace(mean=cat(norm.mean, 0.0), std=cat(norm.std, np.sqrt(new_var)),
                        summed_variance=cat(norm.summed_variance, new_var * cnt))

    def grow(net):
        net = {"params": dict(net["params"])}
        h0 = dict(net["params"]["hidden_0"])
        kern = np.asarray(h0["kernel"])
        h0["kernel"] = np.concatenate([kern, np.zeros((k, kern.shape[1]), kern.dtype)], 0)
        net["params"]["hidden_0"] = h0
        return net

    return (norm, grow(pol), grow(val)) + tuple(params[3:])


def make_networks_factory(ppo_cfg: dict):
    from brax.training.agents.ppo import networks as ppo_networks

    return functools.partial(
        ppo_networks.make_ppo_networks,
        policy_hidden_layer_sizes=tuple(ppo_cfg["policy_hidden_layer_sizes"]),
        value_hidden_layer_sizes=tuple(ppo_cfg["value_hidden_layer_sizes"]),
    )


def make_policy_fn(ckpt: dict, obs_size: int, action_size: int, deterministic: bool = True):
    """Rebuild the PPO inference function from a checkpoint -> policy(obs, key) -> action."""
    from brax.training.acme import running_statistics
    from brax.training.agents.ppo import networks as ppo_networks

    nets = make_networks_factory(ckpt["config"]["ppo"])(
        obs_size, action_size, preprocess_observations_fn=running_statistics.normalize)
    infer = ppo_networks.make_inference_fn(nets)
    p = ckpt["params"]
    return infer((p[0], p[1]), deterministic=deterministic)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--init-checkpoint", default=None)
    ap.add_argument("--steps", type=float, default=None, help="override ppo.num_timesteps (env steps)")
    ap.add_argument("--num-envs", type=int, default=None)
    ap.add_argument("--run-name", default=None)
    ap.add_argument("--runs-dir", default="runs")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--smoke", action="store_true", help="tiny run for testing")
    a = ap.parse_args()

    import jax

    from dance_rl import compat  # noqa: F401  (jax/brax version shim)
    from brax.training.agents.ppo import train as ppo
    from mujoco_playground import wrapper

    from dance_rl.env import TERMS, make_env

    cfg = load_config(a.config)
    track_mode = cfg.get("mode", "dance") == "track"          # phase 2 (default: phase-1 path unchanged)
    if track_mode:
        from dance_rl.track_env import TRACK_METRICS, TRACK_TERMS, make_track_env, wrap_for_track_training
        make_env = make_track_env                                # noqa: F811
        TERMS = TERMS + TRACK_TERMS                              # noqa: N806
    if a.init_checkpoint is None and cfg.get("init_checkpoint"):
        a.init_checkpoint = cfg["init_checkpoint"]
    pc = dict(cfg["ppo"])
    num_evals = int(cfg.get("checkpoint", {}).get("num_evals", 10))
    if a.smoke:
        pc.update(num_envs=64, batch_size=64, num_minibatches=4, unroll_length=10,
                  num_eval_envs=16, num_timesteps=20_000)
        if not a.init_checkpoint:   # keep the real layer sizes so a checkpoint can be restored
            pc.update(policy_hidden_layer_sizes=[32, 32], value_hidden_layer_sizes=[32, 32])
        num_evals = 3
    if a.steps is not None:
        pc["num_timesteps"] = int(a.steps)
    if a.num_envs is not None:
        pc["num_envs"] = a.num_envs
        pc["batch_size"] = min(pc["batch_size"], a.num_envs)
        pc["num_eval_envs"] = min(pc.get("num_eval_envs", 128), a.num_envs)
    cfg["ppo"] = pc

    run = a.run_name or (cfg["name"] + ("_smoke" if a.smoke else "") + time.strftime("_%m%d_%H%M%S"))
    run_dir = os.path.join(a.runs_dir, run)
    ck_dir = os.path.join(run_dir, "checkpoints")
    os.makedirs(ck_dir, exist_ok=True)
    with open(os.path.join(run_dir, "config.yaml"), "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    print("devices:", jax.devices(), flush=True)
    print("run dir:", run_dir, flush=True)

    env = make_env(cfg)
    eval_env = make_env(cfg)
    obs_size, act_size = int(env.observation_size), int(env.action_size)
    ep_len = int(pc["episode_length"])
    assert ep_len == env.episode_steps, "ppo.episode_length must equal env episode_seconds * 50"
    print(f"obs {obs_size} act {act_size} substeps {env.n_substeps} ep_len {ep_len}", flush=True)

    restore = None
    if a.init_checkpoint:
        ck = load_checkpoint(a.init_checkpoint)
        restore = ck["params"]
        print("init from", a.init_checkpoint, "step", ck.get("step"), flush=True)
        old_obs = int(ck.get("obs_size", obs_size))
        if old_obs != obs_size:
            restore = pad_obs_params(restore, obs_size)
            print(f"padded checkpoint obs {old_obs} -> {obs_size} (zero first-layer rows)", flush=True)

    log_path = os.path.join(run_dir, "progress.jsonl")
    t0 = time.time()
    state = {"last_t": t0, "last_step": 0, "best_step": None, "best_fall": float("inf")}
    # checkpoint.best: "term_rate" (default; track mode, phase 1: fall_rate) | "term_pose" (track mode: minimise
    # term_rate + 0.05 * track_pose_err_deg of the eval; step 0 is never picked)
    best_mode = cfg.get("checkpoint", {}).get("best", "term_rate")
    assert best_mode in ("term_rate", "term_pose"), best_mode
    best_path = os.path.join(ck_dir, "best.pkl")

    def update_best(step, fall):
        """Called after the eval of `step` (brax saves the step's params before evaluating them)."""
        src = os.path.join(ck_dir, f"ckpt_{int(step):012d}.pkl")
        if step <= 0 or fall is None or not os.path.exists(src) or fall > state["best_fall"]:
            return
        tmp = best_path + ".tmp"
        shutil.copyfile(src, tmp)
        os.replace(tmp, best_path)
        state.update(best_step=int(step), best_fall=float(fall))
        with open(os.path.join(ck_dir, "best.json"), "w") as f:
            json.dump({"step": int(step), "fall_rate": float(fall)}, f)
        print(f"best.pkl <- step {int(step)} (eval {best_mode if track_mode else 'fall_rate'} {fall:.4f})", flush=True)

    def progress(step, metrics):
        now = time.time()
        rec = {"step": int(step), "wall_s": round(now - t0, 1)}
        dt = now - state["last_t"]
        if step > state["last_step"] and dt > 0:
            rec["sps_window"] = round((step - state["last_step"]) / dt)
        state.update(last_t=now, last_step=step)
        for k, v in metrics.items():
            try:
                rec[k] = float(v)
            except (TypeError, ValueError):
                pass
        L = rec.get("eval/avg_episode_length")
        if L:
            for k in TERMS + ["motion_energy"]:
                key = f"eval/episode_r_{k}" if k != "motion_energy" else "eval/episode_motion_energy"
                if key in rec:
                    rec[f"per_step/{k}"] = rec[key] / L
            if track_mode:
                for k in TRACK_METRICS:
                    if f"eval/episode_{k}" in rec:
                        rec[f"per_step/{k}"] = rec[f"eval/episode_{k}"] / L
                if "eval/episode_terminated" in rec:      # falls + tracking early terminations
                    rec["term_rate"] = rec["eval/episode_terminated"]
            if "eval/episode_reward" in rec:
                rec["per_step/reward"] = rec["eval/episode_reward"] / L
            if "eval/episode_fell" in rec:
                rec["fall_rate"] = rec["eval/episode_fell"]
        sel = rec.get("term_rate") if track_mode else rec.get("fall_rate")
        if best_mode == "term_pose" and sel is not None and "per_step/track_pose_err" in rec:
            import math
            sel = sel + 0.05 * math.degrees(rec["per_step/track_pose_err"])     # term_rate + 0.05 x pose err (deg)
            rec["best_score"] = sel
        with open(log_path, "a") as f:
            f.write(json.dumps(rec) + "\n")
        update_best(step, sel)
        short = {k: rec[k] for k in ("step", "wall_s", "sps_window", "eval/episode_reward",
                                      "eval/avg_episode_length", "fall_rate",
                                      "per_step/upright") if k in rec}
        if track_mode:
            short["term_rate"] = rec.get("term_rate")
            short.update({k: rec[k] for k in ("per_step/track_pose", "per_step/track_pose_err", "best_score",
                                              "per_step/track_tilt", "per_step/track_yaw",
                                              "training/amp_r", "training/d_ref", "training/d_pol") if k in rec})
        print(json.dumps(short), flush=True)

    amp_setup = None
    if track_mode:
        import numpy as np
        from dance_rl import amp as amp_mod
        amp_setup = amp_mod.make_setup(cfg, env)
        if amp_setup is not None and a.init_checkpoint and amp_setup.cfg["restore"]:
            amp_ck = load_checkpoint(a.init_checkpoint).get("amp")
            same = amp_ck is not None and np.array_equal(
                np.asarray(amp_ck.get("cols", [])), np.asarray([] if amp_setup.cols is None else amp_setup.cols))
            if amp_ck is not None and not same:
                print("discriminator NOT restored: init_checkpoint's D uses other features (amp.features)", flush=True)
            elif amp_ck is not None:
                amp_setup.restore_params = amp_ck["params"]
                print("discriminator restored from", a.init_checkpoint, flush=True)

    def save_params(step, make_policy, params, disc_params=None):
        extra = None if disc_params is None else {"amp": amp_setup.to_checkpoint(disc_params)}
        p = os.path.join(ck_dir, f"ckpt_{int(step):012d}.pkl")
        save_checkpoint(p, params, cfg, step, obs_size, act_size, extra)
        save_checkpoint(os.path.join(ck_dir, "latest.pkl"), params, cfg, step, obs_size, act_size, extra)

    train_kw = dict(
        environment=env, eval_env=eval_env, wrap_env_fn=wrapper.wrap_for_brax_training,
        num_timesteps=int(pc["num_timesteps"]), num_envs=int(pc["num_envs"]),
        episode_length=ep_len, action_repeat=1, unroll_length=int(pc["unroll_length"]),
        batch_size=int(pc["batch_size"]), num_minibatches=int(pc["num_minibatches"]),
        num_updates_per_batch=int(pc["num_updates_per_batch"]),
        discounting=float(pc["discounting"]), learning_rate=float(pc["learning_rate"]),
        entropy_cost=float(pc["entropy_cost"]), clipping_epsilon=float(pc["clipping_epsilon"]),
        max_grad_norm=float(pc["max_grad_norm"]), reward_scaling=float(pc["reward_scaling"]),
        normalize_observations=bool(pc["normalize_observations"]),
        num_eval_envs=int(pc["num_eval_envs"]), num_evals=num_evals, seed=a.seed,
        network_factory=make_networks_factory(pc), progress_fn=progress,
        policy_params_fn=save_params, restore_params=restore,
    )
    extra = None
    if track_mode:
        train_kw["wrap_env_fn"] = wrap_for_track_training
    if amp_setup is not None:
        from dance_rl import ppo_amp
        make_inference_fn, params, _, disc = ppo_amp.train(**train_kw, amp=amp_setup,
                                                           restore_disc_params=amp_setup.restore_params)
        extra = {"amp": amp_setup.to_checkpoint(disc)}
    else:
        make_inference_fn, params, _ = ppo.train(**train_kw)
    final = os.path.join(ck_dir, "final.pkl")
    last = max(state["last_step"], int(pc["num_timesteps"]))
    save_checkpoint(final, params, cfg, last, obs_size, act_size, extra)
    save_checkpoint(os.path.join(ck_dir, "latest.pkl"), params, cfg, last, obs_size, act_size, extra)
    if state["best_step"] is None:          # no trained eval reported a fall rate: best = final
        shutil.copyfile(final, best_path)
        state.update(best_step=last, best_fall=float("nan"))
    total = time.time() - t0
    print(f"done in {total:.0f}s; final checkpoint {final}", flush=True)
    print(f"best.pkl is from step {state['best_step']} (eval {'term_rate' if track_mode else 'fall_rate'} "
          f"{state['best_fall']:.4f})", flush=True)


if __name__ == "__main__":
    main()
