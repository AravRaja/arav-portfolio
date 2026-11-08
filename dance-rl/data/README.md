# Phase-2 motion data: AIST++ hip-hop on the capsule humanoid

Reference trajectories for the S5 to S8 stages in PLAN §14. Real hip-hop 8-counts from AIST++ are
retargeted onto the env's humanoid, time-warped to the song tempo (112.94 BPM) and cut on downbeats.

## Where things are

| path | what | in git? |
|---|---|---|
| `raw/aistpp/keypoints3d/*.pkl` | AIST++ 3D keypoints (COCO-17, 60 fps, cm), genres gMH, gLH and gHO only | no (`data/.gitignore`) |
| `raw/aistpp/motions/*.pkl` | AIST++ SMPL pose params for the same genres. The v1.0 `motions.zip` holds only about 43 sequences per genre. **Unused.** | no |
| `raw/aistpp/ignore_list.txt` | AIST++ list of bad sequences. One gHO clip is skipped. | no |
| `interim/retarget/<clip>.npz` | per-clip IK result at 60 fps: `qpos60`, `fk_err` (cm per marker), `targets`, `planted`, `bpm`, … | no |
| `library/moves.npz` | **the library**: 602 moves of 213 frames at 50 Hz, plus mirrored copies | no (the repo's `*.npz` rule; regenerate it or `git add -f`) |
| `library/manifest.json` | per-move metadata, per-clip retarget error and beat check, conventions | yes |
| `library/gallery/<id>.png` | contact sheet with 16 tiles over the 2 bars. Rows: humanoid front, the dancer's keypoints, humanoid side. | yes |
| `library/gallery/<id>.mp4` | 640x480 at 50 fps: the move twice, then its mirror, over a click track (high click on beat 1) | no (`*.mp4`) |
| `library/gallery/selection.json` | which 8 moves were rendered and why | yes |

The code is in `src/dance_rl/`: `aistpp_download.py`, `retarget.py`, `build_motion_lib.py`,
`motion_gallery.py`, `motion_lib.py` (the loader), `humanoid_model.py` (the env's MjModel without jax)
and `safe_pickle.py` (an unpickler restricted to numpy, for the downloaded `.pkl` files).

## Genre note

PLAN §14 says "hip-hop (gHO)", but in AIST++ **gHO is House**. The hip-hop genres are **gMH** (Middle
Hip-hop) and **gLH** (LA-style Hip-hop). The library is built from gMH and gLH. gHO is downloaded and
retargeted too (140 clips, mean FK error 1.59 cm). To add it, run `--genres gMH,gLH,gHO` in
`build_motion_lib`. House music ids map to 110 to 135 BPM (mHO0..5, step 5), not 80 to 130.

## Licence

- **AIST++ annotations** (keypoints3d, motions, cameras, splits) are licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: Li et al., *AI Choreographer:
  Music Conditioned 3D Dance Generation with AIST++*, ICCV 2021,
  https://google.github.io/aistplusplus_dataset/. Anything derived from them must keep the attribution,
  and that includes `moves.npz`, the renders and trained policies.
- The **AIST Dance Video Database** videos and music are research-use only under AIST's terms of use
  (https://aistdancedb.ongaaccel.jp/). **Neither was downloaded.**
- The **SMPL body model** was not downloaded. It needs registration, and nothing here uses it.
- The release assets were fetched anonymously from
  `github.com/google/aistplusplus_dataset/releases/download/v1.0/`. No account or token was used.
  `aistpp_download.py` reads each zip's central directory with HTTP range requests and pulls only
  the `g??_*` members.

## How the library is built

1. **Download.** `aistpp_download.py --genre gMH` (repeat for gLH and gHO). Each genre has 141
   sequences: 120 `sBM` (basic, 16 beats long) and 21 `sFM` (advanced, 64 beats). They come at 6 tempos,
   mXX0..5 = 80, 90, …, 130 BPM. The clip lengths are exact whole numbers of beats, and pelvis-height
   autocorrelation confirms that mapping.
2. **Retarget** (`retarget.py`, about 95 s for 422 clips on 7 cores):
   - Keypoints are low-passed at 8 Hz, zero phase.
   - Axes are mapped from AIST (x = dancer's left, y up, z forward) to the humanoid world (x forward,
     y left, z up) as `(z, x, y) / 100`.
   - The data's bone directions are rebuilt with the humanoid's bone lengths: hip width 0.20 m,
     hip-centre to shoulder-centre 0.525, shoulder width 0.34, thigh 0.383, shin 0.33, upper arm 0.312,
     forearm 0.312. The hip-centre path is scaled by humanoid leg / dancer leg.
   - IK is damped Gauss-Newton over all 28 qpos, using `mj_kinematics` + `mj_comPos` + `mj_jacSite`.
     The 13 marker sites sit at the joint anchors of the XML. An active set keeps joints inside their
     XML ranges. Extra terms keep the feet flat and pull hip_z, the ankles and the abdomen weakly to 0
     (COCO-17 has no toes, and abdomen pitch is redundant with torso pitch plus hip flexion). A
     smoothness term ties each frame to the previous one, and each solve is warm-started from it.
   - A 10 Hz zero-phase low-pass follows.
   - A ground offset (smoothed root z) puts the lowest point of each planted foot on z = 0 and keeps
     both feet above the floor.
3. **Beat-align and segment** (`build_motion_lib.py`, about 10 s):
   - Each clip is uniformly time-warped: `t_song = t_src · bpm / 112.94`. That is 1.41x faster for
     80 BPM clips and 0.87x for 130 BPM clips.
   - Clip t = 0 is beat 1 of an 8-count, because every clip is a whole number of 8-counts long. As a
     check, pelvis-height minima land on average 0.07 to 0.17 beat after the grid beat in all four
     genre/style groups (resultant length R ≈ 0.3 across clips). Clips starting at random offsets
     would give R ≈ 0. That lag is the dancers' "down" landing just after the beat (the pocket), so
     the grid is **not** shifted. Per-clip values are in `manifest.clips[*].beat_check`.
   - Each 8-count becomes one move: 213 frames at `t = 4.25 k + i/50`.
   - Each move is re-rooted so that root xy = 0 and the torso faces +x at frame 0.
   - qvel is a central difference (±5 ms) of the continuous spline/slerp trajectory.
   - A foot is in contact when its lowest point is below 3 cm and the slower of its toe/heel points
     moves under 0.8 m/s horizontally.
4. **Filter and dedupe.** A segment is dropped if its IK error exceeds 6 cm or its motion energy is
   below 0.25 m/s; neither filter removed anything. Moves are then kept greedily, best IK error first,
   unless the frame-aligned RMS distance of [21 joints, 2 × torso height, torso up-vector] to a kept
   move is below 0.25. Same-clip repeats of a basic move have a median distance of 0.28; different
   dancers doing the same basic, 0.45; freestyle pairs, 0.54. Result: **816 segments → 602 moves**
   (gMH sBM 119, gMH sFM 166, gLH sBM 150, gLH sFM 167). Each move's merged duplicates are listed in
   the manifest.

## Conventions (identical to `env.py` and `mirror.py`)

- `qpos` (28) = `data.qpos` of the env model: `[0:3]` root position, `[3:7]` root quat (w, x, y, z),
  `[7:28]` hinges in XML order. The root is the **torso (chest)** body, not the pelvis. The hinges are:
  `abdomen_z, abdomen_y, abdomen_x, right_hip_x, right_hip_z, right_hip_y, right_knee, right_ankle_y,
  right_ankle_x, left_hip_x, left_hip_z, left_hip_y, left_knee, left_ankle_y, left_ankle_x,
  right_shoulder1, right_shoulder2, right_elbow, left_shoulder1, left_shoulder2, left_elbow`.
- `qvel` (27) = `data.qvel`: root linear velocity (world frame), root angular velocity (body frame),
  then the 21 hinge rates. The actuator order is different (`abdomen_y` comes first, and `ankle_x`
  comes before `ankle_y`); it is stored as `actuator_names`.
- Signs follow the XML. Flexion is negative for `hip_y`, `knee` and `abdomen_y`, so a forward trunk
  bend is `abdomen_y < 0` (range -75..30 deg). Knee range is -160..2 deg.
- **Mirror.** Joints use `mirror.mirror_perm_sign(joint_names)`: left and right are swapped, and
  shoulder1, shoulder2, ankle_x, abdomen_z and abdomen_x are negated. The root reflects in y:
  pos y → -y, quat (w,x,y,z) → (w,-x,y,-z), linear velocity vy → -vy, body angular velocity
  (wx,wy,wz) → (-wx,wy,-wz). Contacts swap [L,R] → [R,L]. FK check: the mirrored qpos reproduces the
  reflected, L/R-swapped marker positions exactly (max error 0.0 m).
- **Upper/lower split** for fusion. Upper = abdomen (3) + shoulders and elbows (6), at qpos indices
  `upper_qpos_idx`. Lower = hips, knees and ankles (12), at `lower_qpos_idx`. The free root (the chest)
  belongs to neither half. `MotionLibrary.fuse` takes the root from the lower-body move.
- **Phase.** Move phase p in [0, 1] covers the 2 bars, so frame = 212.5 p,
  `beat_phase = 8p mod 1` and `bar_phase = 2p mod 1`.

## Retarget accuracy (FK error, humanoid marker vs limb-scaled target, cm)

| group | clips | mean | best–worst clip | mean per-clip p95 |
|---|---|---|---|---|
| gMH sBM | 120 | 1.98 | 1.19–3.46 | 6.9 |
| gMH sFM | 21 | 2.24 | 1.78–2.71 | 8.1 |
| gLH sBM | 120 | 1.94 | 1.26–3.49 | 7.2 |
| gLH sFM | 21 | 2.31 | 2.01–2.64 | 8.7 |

Per-marker means (cm): hips 0.5, ankles 0.5, knees 1.0, shoulders 1.9, wrists 2.0, elbows 4.5,
nose 5.3. The elbow error comes from the 2-dof shoulder: the arm has no twist joint, and the elbow
axis is fixed. The nose error comes from the missing neck: the head is welded to the chest. Against the
dancer's own keypoints scaled uniformly, the mean error is 5.5 cm, which mostly reflects differences in
body proportions. Per-clip numbers are in `manifest.clips[<clip>].fk_err_cm`.

## Known limitations

- Foot skating is not removed (there is no foot-lock IK). About 17% of frames have neither foot
  flagged in contact. Some of those are hops and some are slides or retarget drift. The physics
  tracker will have to absorb this.
- After the warp, the 80 BPM clips play 1.41x faster than the dancer performed them. The peak hinge
  speed in the library is 64 rad/s (arms), and the 99th percentile of per-move peaks is 52 rad/s.
  That is high, but these are reference targets.
- 129 of the 602 moves take the pelvis below 0.7 m at some point (minimum 0.31 m; the median
  per-move minimum is 0.74 m). Those are deep grooves, squats and kneels. The env's `fall_height`
  (pelvis z < 0.7 ends the episode) would cut them off, so a tracking stage needs a lower threshold
  or a termination relative to the reference. Per-move values are in `manifest.moves[*].pelvis_z_min`.
- `loopability = exp(-loop_dist / 0.5)`, where loop_dist = RMS joint difference between the last and
  first frame (rad) + 2·|Δz| + |Δ torso-up|. Only about a quarter of the moves score above 0.3, so
  most 8-counts are not seamless loops on their own. Use `next_segment_id` for the natural successor
  from the same clip.

## Regenerate

```bash
cd dance-rl
/opt/homebrew/bin/python3.13 -m venv .venv-data
.venv-data/bin/pip install mujoco numpy scipy imageio imageio-ffmpeg matplotlib tqdm requests pillow
.venv-data/bin/pip install --no-deps playground          # only for the humanoid XML (no jax needed)
export PYTHONPATH=src
for g in gMH gLH gHO; do .venv-data/bin/python -m dance_rl.aistpp_download --out data/raw/aistpp --genre $g; done
.venv-data/bin/python -m dance_rl.retarget --genres gMH,gLH,gHO          # -> data/interim/retarget
.venv-data/bin/python -m dance_rl.build_motion_lib --genres gMH,gLH       # -> data/library/{moves.npz,manifest.json}
MUJOCO_GL=cgl .venv-data/bin/python -m dance_rl.motion_gallery           # -> data/library/gallery (egl on Linux)
```

On the GPU box, `motion_lib.py` needs only numpy:
`MotionLibrary.load("data/library/moves.npz").get(move_id, phase)`.
