# Dancer on the music stage: four character designs

All four use the same rig and the same animation: the finale (`configs/s9/c_show.yaml`) exported to
`public/dance/finale.{json,bin}` and posed in the browser by forward kinematics over the MuJoCo body
tree. The only thing that changes between options is the skin. Live at `/dance-lab` on the dev server
(`npm run dev`, then http://localhost:5173/dance-lab). Keys `1`–`4` switch design, `C` switches caption,
`Space` plays from the drop.

Per option: `still_portrait_1080x1920_41.04s.png` (phone), `still_landscape_1920x1080_41.04s.png`
(laptop), both frozen on the 41.04 s clap, and `clip_720p_38.38-46.38s.mp4`, 8 s with the song's audio
(fused 8-count 7, then the start of 8-count 8). Every capture uses caption 1. `overview_portrait_41.04s.png` puts the four phone stills side by side, and `captions.png` shows the four caption variants. `verify_41.04s.png` shows the
pose check: dance-rl's GPU contact-sheet tile | MuJoCo render of the exported rollout | the browser's FK.

Perf was measured in headless Chrome (ANGLE Metal, M1 Pro) at 1920×1080 with 2× pixel ratio, playing
the dance: all four hold 60 fps (p95 frame time 16.8 ms). None of them uses post-processing or a shadow
render pass. Nothing third-party is used beyond what the site already depends on (three, @react-three/fiber,
@react-three/drei), and all geometry is generated in code, so there is no asset licence to track.

## A. Ink figure (`src/danceLab/designs/InkFigure.jsx`)
A line drawing on the blue page. Every body part is filled with the page's own blue and outlined by a
white back-face shell pushed out in screen space, so the figure reads as pen strokes. Where a limb
crosses the body, its outline draws over the torso. The strokes taper and wobble, and they re-draw 8
times a second ("boil"), the way hand-drawn animation looks when it's redrawn every other frame. A
hatched pen-scribble ellipse is the floor shadow. It's the closest match to the site's flat, white-on-blue
header, the outlined space key and the visitor drawings, and it's the least "3D" of the four. Cost: 2
meshes per body part (39 draw calls) with trivial shaders. Licence: original code, nothing third-party.

## B. Capsule mannequin (`src/danceLab/designs/CapsuleMannequin.jsx`)
The simulation body exactly as it trained: MuJoCo's 20 capsules and spheres, matte, all in the site's
yellow (#f0ff18). A white sky and blue ground light bounce the stage colour into the shadows, and a soft
blob shadow sits under the feet and hips. This is the honest "this is the simulation" option: it's the
same body as the dance-rl renders, recoloured to the About page's yellow-on-blue. Cost: 20 meshes,
Lambert shading, 22 draw calls (the cheapest). Licence: original code; the body is the MuJoCo /
dm_control humanoid (Apache-2.0), rebuilt from its dimensions.

## C. Neon wire (`src/danceLab/designs/NeonWire.jsx`)
Glowing tubes on a darker club stage: the same blue, dimmed towards the edges, with a perspective grid
floor fading out. Each capsule is a rim-lit shell (bright yellow at the silhouette, nearly clear in the
middle) plus a wider halo shell that adds light, which fakes bloom without a post-processing pass. A thin
white edge cage runs over each part, and a glow pool sits under the dancer. Glow and floor kick on every
beat after the drop. It carries the DJ build-up straight into the drop and has the most club energy,
though it's the furthest from the flat page style. Cost: 3 layers per body part (58 draw calls) with
additive overdraw. It renders at up to 1.5× pixel ratio (the glow is soft anyway), which keeps it at 60 fps
on a 4K-class buffer. Licence: original code.

## D. Low-poly rigged character (`src/danceLab/designs/LowPolyCharacter.jsx`)
The most "person-like" option: a faceted, flat-shaded figure in a white hoodie, navy trousers and white
trainers with yellow soles, wearing yellow DJ headphones. It's built procedurally in code and skinned to
the 16 MuJoCo bodies (one bone each, posed by the same FK). Rings shared by two bones get split weights,
so knees, elbows, shoulders and the waist bend like fabric rather than coming apart. Reads as "a person
dancing" at a glance, and the headphones tie it to the DJ deck. Cost: 1 skinned mesh (767 triangles,
Lambert, flat shading) plus the blob shadow, 4 draw calls. Licence: original procedural geometry, no
third-party model.

## Caption variants (`src/danceLab/captions.js`)
One type treatment for all of them: the welcome page's bracketed mono labels. IBM Plex Mono, 10 px,
uppercase, 0.18 em tracking, white at 72 %, with a yellow `[RL]` tag, sitting centred above the space key.

1. `[RL] RL-TRAINED HUMANOID · 602 HIP-HOP MOVES`
2. `[RL] TRAINED, NOT ANIMATED`
3. `[RL] A POLICY, DANCING`
4. `[RL] FIRST JUST THE SONG, THEN REAL DANCERS`: the story in 7 words. Phase 1 learned from the
   music alone with no motion data; phase 2 imitated AIST++ dancers.

## Data
- `public/dance/finale.json` (16 kB): header with fps 30, 4255 frames, drop 8.37 s, beat grid, joint
  names, the 32 8-count units (legs / arms move ids, FUSED flag, mirrored flag), the body tree (parents,
  local pos/quat, hinge anchors/axes/ranges, capsule/sphere sizes) and one verification frame with
  MuJoCo's own body positions.
- `public/dance/finale.bin` (494 kB): float32, 29 values per frame (song time, root xyz, root quat
  wxyz, 21 hinge angles).
- Made by `PYTHONPATH=src .venv-train/bin/python -m dance_rl.export_web --rollout runs/s9_c/rollout_cpu.npz
  --out ../public/dance/finale --seed 2`.
- The rollout was re-rolled on this Mac's CPU (`python -m dance_rl.show --config configs/s9/c_show.yaml
  --seed 2 --out runs/s9_c/rollout_cpu.npz`, 16 s), because the GPU `rollout.npz` was never pulled. With
  seed 0 the CPU run diverges chaotically from the GPU one and falls at 103.5 s (fused 8-count 22). Seeds
  1 to 4 all dance the whole song upright and match the GPU metrics: pose error 2.58° vs 2.584°, end-effector
  error 2.63 cm vs 2.634 cm. Seed 2 has the best mean reward (3.54).
