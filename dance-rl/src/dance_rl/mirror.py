"""Left/right mirror map of the humanoid's joint vector (pure numpy, shared by env.py and metrics.py).

Under the reflection y -> -y (a rotation axis is a pseudovector, so a mirrored rotation turns about the
reflected axis by the opposite angle):
  - paired joints whose left/right XML axes are reflections of each other WITHOUT a sign change mirror with
    q_L = -q_R: shoulder1 L (2,-1,1) / R (2,1,1); shoulder2 L (0,1,1) / R (0,-1,1); ankle_x L = R = (1,0,.5)
  - the other paired joints (hip_x/z: axis negated, hip_y/knee/ankle_y: same y axis, elbow L (0,-1,-1) /
    R (0,-1,1)) mirror with q_L = +q_R
  - unpaired torso joints: abdomen_z (yaw) and abdomen_x (roll) change sign, abdomen_y (pitch) keeps it.
"""
from __future__ import annotations

import numpy as np

MIRROR_FLIP = ("shoulder1", "shoulder2", "ankle_x")
MIRROR_FLIP_TORSO = ("abdomen_z", "abdomen_x")


def mirror_perm_sign(joint_names):
    """(perm, sign) with (M q)[i] = sign[i] * q[perm[i]]: left <-> right swapped, MIRROR_FLIP and
    MIRROR_FLIP_TORSO negated."""
    names = [str(n) for n in joint_names]
    perm = np.arange(len(names))
    sign = np.ones(len(names), np.float32)
    for i, n in enumerate(names):
        if n.startswith("left_"):
            perm[i] = names.index("right_" + n[5:])
        elif n.startswith("right_"):
            perm[i] = names.index("left_" + n[6:])
        if n in MIRROR_FLIP_TORSO or any(n.endswith("_" + k) for k in MIRROR_FLIP):
            sign[i] = -1.0
    return perm, sign
