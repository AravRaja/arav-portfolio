"""The dance humanoid's MjModel without importing jax (for CPU-only data tools on the Mac).

Same XML + assets as env.load_model (mujoco_playground's dm_control-suite humanoid.xml and its
xmls/common/*), read straight from the installed `playground` package files, so qpos/qvel layout is
identical to the env. `with_markers()` adds retargeting sites (no joints/bodies change, so the
qpos (28) / qvel (27) layout is untouched).
"""
from __future__ import annotations

import importlib.util
import pathlib

import mujoco
import numpy as np


def _xml_dir() -> pathlib.Path:
    spec = importlib.util.find_spec("mujoco_playground")
    if spec is None or spec.origin is None:
        raise ImportError("install the `playground` package (pip install --no-deps playground is enough)")
    return pathlib.Path(spec.origin).parent / "_src" / "dm_control_suite" / "xmls"


def xml_and_assets():
    d = _xml_dir()
    assets = {f.name: f.read_bytes() for f in (d / "common").glob("*") if f.is_file()}
    return (d / "humanoid.xml").read_text(), assets


def load_model() -> mujoco.MjModel:
    xml, assets = xml_and_assets()
    m = mujoco.MjModel.from_xml_string(xml, assets)
    m.vis.global_.offwidth = 1920
    m.vis.global_.offheight = 1080
    return m


# COCO-17 keypoint -> (humanoid body, local position) marker definitions. Positions are where the
# corresponding anatomical joint centre sits on the capsule model (joint anchors from the XML).
COCO = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder",
        "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip",
        "left_knee", "right_knee", "left_ankle", "right_ankle"]
MARKERS = {
    "nose": ("head", (0.085, 0.0, 0.0)),
    "left_shoulder": ("left_upper_arm", (0, 0, 0)), "right_shoulder": ("right_upper_arm", (0, 0, 0)),
    "left_elbow": ("left_lower_arm", (0, 0, 0)), "right_elbow": ("right_lower_arm", (0, 0, 0)),
    "left_wrist": ("left_hand", (0, 0, 0)), "right_wrist": ("right_hand", (0, 0, 0)),
    "left_hip": ("left_thigh", (0, 0, 0)), "right_hip": ("right_thigh", (0, 0, 0)),
    "left_knee": ("left_shin", (0, 0, 0.02)), "right_knee": ("right_shin", (0, 0, 0.02)),
    "left_ankle": ("left_foot", (0, 0, 0.08)), "right_ankle": ("right_foot", (0, 0, 0.08)),
    # not COCO: toe / heel points used for the foot-flat term and contacts
    "left_toe": ("left_foot", (0.14, 0.03, 0.0)), "right_toe": ("right_foot", (0.14, -0.03, 0.0)),
    "left_heel": ("left_foot", (-0.07, 0.01, 0.0)), "right_heel": ("right_foot", (-0.07, -0.01, 0.0)),
}
FIT = ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
       "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]


def with_markers() -> tuple[mujoco.MjModel, dict]:
    xml, assets = xml_and_assets()
    spec = mujoco.MjSpec.from_string(xml, assets)
    for name, (body, pos) in MARKERS.items():
        s = spec.body(body).add_site()
        s.name = "mk_" + name
        s.pos = list(pos)
        s.size = [0.02, 0.02, 0.02]
        s.group = 4
    m = spec.compile()
    m.vis.global_.offwidth = 1920
    m.vis.global_.offheight = 1080
    sid = {n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SITE, "mk_" + n) for n in MARKERS}
    return m, sid


def joint_names(m) -> list[str]:
    return [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, j) for j in range(1, m.njnt)]


def actuator_names(m) -> list[str]:
    return [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, a) for a in range(m.nu)]


def foot_geoms(m):
    def body(n): return mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n)
    return [[g for g in range(m.ngeom) if m.geom_bodyid[g] == body(f"{s}_foot")] for s in ("left", "right")]


def lowest_z(m, d, geoms) -> float:
    """Lowest world z of a set of capsule/sphere geoms (same formula as env._lowest_z_np)."""
    out = np.inf
    for g in geoms:
        r = m.geom_size[g, 0]
        if m.geom_type[g] == mujoco.mjtGeom.mjGEOM_CAPSULE:
            z = d.geom_xpos[g, 2] - abs(d.geom_xmat[g].reshape(3, 3)[2, 2]) * m.geom_size[g, 1] - r
        else:
            z = d.geom_xpos[g, 2] - r
        out = min(out, z)
    return float(out)
