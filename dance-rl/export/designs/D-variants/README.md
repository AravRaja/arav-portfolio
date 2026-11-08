# D-variants: the low-poly person, more realistic and in outfits

Six variants of design D on the same animation (`public/dance/finale.{json,bin}`, the same FK over the 21
hinges as A-D), selectable in the lab at `/dance-lab`: keys `5`-`9`, `0` (or the buttons, or
`?design=D1`..`D6`). They default to caption 4, `[RL] FIRST JUST THE SONG, THEN REAL DANCERS`, and every
capture here uses it.

- D1-D3 use **route 1**: real rigged, clothed characters (Microsoft Rocketbox, MIT) retargeted onto the rig.
- D4-D6 use **route 2**: procedural bodies and outfits, built in code with no assets.

Per variant: `still_portrait_1080x1920_41.04s.png` (phone), `still_landscape_1920x1080_41.04s.png` (laptop),
both frozen on the 41.04 s clap, and `clip_720p_38.38-46.38s.mp4` (8 s, song audio muxed in afterwards; the
frames were rendered frozen, so nothing was played). `overview_portrait_41.04s.png` shows the original D
followed by D1-D6. `verify_41.04s.png` shows the pose check in dance-rl's contact-sheet camera: B (the MuJoCo
capsule body itself) | D1 | D2 | D3 | D4 | D5 | D6.

## How the retarget works (both routes)
`src/danceLab/designs/dvariants/retarget.js` is a single retargeter for any skinned skeleton whose bones
are tagged with roles (hips, spine, spine1, chest, thighs, calves, feet, upper arms, forearms). It
transfers rotation only, as world rotation relative to the rig's zero pose:

    bone_world(t) = body_world(t) · body_world(zero)⁻¹ · Δ_b · bone_bind_world

`body_world` comes from `rig.js`, so the hinge angles are already composed in XML joint order
(abdomen_z, y, x; hip_x, z, y; knee; ankle_y, x; shoulder1, 2; elbow). `Δ_b` takes the bone from the
character's own bind pose (Rocketbox A-pose, or the procedural A-pose) to the rig's zero pose (the
dm_control "boxer" pose with the forearms up):
- Torso and feet: Δ = I, since both stand upright facing +z.
- Legs: the bone direction (joint to child joint) is aligned with the rig segment's, keeping "forward",
  so the knee bends the right way.
- Arms: the bone direction plus the elbow hinge axis are aligned (upper arm × forearm in the rig; upper
  arm × forward for an arm that hangs straight), so the elbow folds in the rig's plane.

Mapping: pelvis → Pelvis and Spine (the Biped's thighs hang off Spine, so it must follow the pelvis),
lower_waist → Spine1, torso → Spine2/chest, thigh/shin/foot → Thigh/Calf/Foot, upper/lower arm →
UpperArm/Forearm. Clavicles, neck, head, hands, toes, fingers and face bones keep their bind offsets
(the rig has no joints for them). The character keeps its own bone lengths. The hips are placed so the
hip midpoint follows the rig's, scaled by k = character leg length / rig leg length. They are then
lifted so the lowest heel or toe point sits where the rig's lowest sole point is (× k), which keeps the
feet planted. The contact shadow follows the character's own feet.

**Verification at 41.04 s** (`verify.mjs`, measured in the page) compares the character's joint-to-joint
directions with the rig's joint centres (hinge anchors):

| segment | error |
|---|---|
| upper arms, forearms | 0.00° |
| thighs | 0.07° |
| shins | 1.1–1.2° (the rig's two ankle hinges sit at different heights; the 8 cm anchor is used) |
| pelvis → chest | 1.0–1.3° (the characters' bind spines are slightly curved) |

Which leg is back matches in all six. The left foot is 0.204–0.218 m behind the right; the rig's is
0.208 m. `verify_41.04s.png` shows the same pose side by side with the capsule body.

**Perf** was measured in headless Chrome (ANGLE Metal, M1 Pro), playing the dance by driving the clock
from rAF (no audio):
- 1920×1080 at 2× pixel ratio: all six hold 60 fps, p95 frame time 16.7–16.8 ms.
- Portrait phone, 390×844 at 3× (the lab caps it at 2×): D1 and D4 hold 60 fps.

No post-processing and no shadow pass. The contact shadow is the same 3 blurred quads as A-D.

| | route | source / licence | asset | tris | draw calls | fps (1080p@2×) |
|---|---|---|---|---|---|---|
| D1 | 1 | Rocketbox `Male_Adult_18`, MIT | 423 kB GLB | 7,496 (incl. 1.1k headphones) | 6 | 60 |
| D2 | 1 | Rocketbox `Male_Adult_17`, MIT | 503 kB GLB | 7,090 | 5 | 60 |
| D3 | 1 | Rocketbox `Female_Adult_12`, MIT | 889 kB GLB | 8,780 | 6 | 60 |
| D4 | 2 | original code | none | 8,619 (incl. headphones) | 5 | 60 |
| D5 | 2 | original code | none | 6,618 | 4 | 60 |
| D6 | 2 | original code | none | 8,127 (incl. headphones) | 5 | 60 |

## Route 1: Rocketbox characters (D1-D3)
**Source.** [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox): 115
rigged, clothed avatars built over 10 years.

**Licence.** MIT. The library was first released in March 2020 for research and academic use only. The
repository README records *"12/2020: Updated license to MIT"* and a *"November 2020 License Update"*,
the repo's `LICENSE.md` is the MIT licence, and GitHub reports it as MIT. Each
`public/dance/characters/rocketbox-*/LICENSE.md` cites the source avatar, the licence history, the full
MIT text (including the copyright notice the licence asks to keep) and what was changed.

**Conversion.** Blender 3.0, FBX → GLB. Kept: the skinned `hipoly_81_bones` mesh and the 80-bone 3ds Max
Biped skeleton. Dropped: animation, facial blendshapes, and the normal and specular maps. Textures were
downscaled: body 1024 px JPEG, head 512 px JPEG, and a 512 px PNG alpha map for hair and lashes where
there is one. Materials are swapped for Lambert plus a stage-blue rim at load. Each asset is well under
2 MB.

**D1 · grey hoodie + phones** (`rocketbox-male-18`): hood up, black trousers, dark trainers. The yellow
DJ headphones are added in code and fitted to the head from its skinned vertices; they sit over the
hood. This is the closest "real" version of D.

**D2 · track jacket + jeans** (`rocketbox-male-17`): a blue/white hooded track jacket, baggy jeans, white
trainers and a cap. It looks the most like a street dancer.

**D3 · black hoodie + shorts** (`rocketbox-female-12`): a black zip hoodie with green trim, denim shorts
and trainers. This is the female option.

**Known issues (route 1)**
- Linear-blend skinning plus undriven clavicles cause some shoulder pinch and sleeve stretch when the
  arms go overhead (for example the ~20 s arms-up move), and a little crotch collapse in deep lunges.
- The characters keep their own proportions: 1.82 m (D1, D2) and 1.67 m (D3), against the rig's ~1.56 m
  with a short trunk. Joint angles match, but at the clap the hands meet a little higher on the body.
- Fingers stay in the bind pose (relaxed, straight) and the faces don't animate.
- The textured, photo-real look is a step away from the site's flat style. The rim light helps it sit
  on the blue.
- Rocketbox's other avatars convert the same way. A red tracksuit (`Male_Adult_10`) and a hoodie under
  a jacket (`Male_Adult_04`) also converted cleanly, but weren't wired in (the 6-slot limit).

## Route 2: procedural (D4-D6)
**Code.** `src/danceLab/designs/dvariants/proceduralBody.js` builds a smooth-shaded body with human
proportions: 1.78–1.84 m, hip joints at 0.93 m, thigh 0.42 m + shin 0.415 m, so k = 1.053. The root
motion is scaled by k, so steps are 5% longer and the feet still plant. Head, nose, ears, hair, neck and
mitten hands are layered under clothes built from superellipse lofts:
- hoodie or track jacket: boxy trunk, sleeves with cuffs, a rolled hood, kangaroo pocket, drawstrings,
  zip ribbon, side stripes;
- trousers: seat and legs, cargo pockets, tapered cuffs;
- chunky trainers: a rounded upper, laces and a thick slab sole;
- hats: bucket hat or cap.

All of it is skinned to its own 22-bone biped (blended weights around the knees, elbows, shoulders and
waist) and driven by the same retargeter. It is vertex-coloured (flat colours, no textures) with a
3-step toon ramp and a Fresnel rim in stage blue, merged into one skinned mesh (one draw call). The
headphones are a second mesh on the head bone. Wrist and sock fillers close the cuffs so the stage
never shows through a sleeve.

**D4 · oversized hoodie + cargos**: an off-white oversized hoodie with yellow drawstrings, olive baggy
cargos with pockets, chunky white trainers on yellow soles, and yellow headphones. It is D, upgraded.

**D5 · tracksuit + bucket hat**: a red tracksuit (it echoes the red space key) with white side stripes
on the sleeves and legs, a zip, a stand collar, a cream bucket hat and white trainers.

**D6 · all black + yellow**: a black hoodie and slim black trousers with site-yellow accents
(drawstrings, belt, soles, laces) and yellow headphones. The rim light keeps the silhouette readable on
the blue.

**Known issues (route 2)**
- Faceless mannequin head and mitten hands, by design: a mannequin, not a portrait.
- Still a stylised look (clean, toy-like), not photo-real.
- In the deepest lunges and high knees, a thigh can graze through the hoodie hem (the hem is skinned to
  the hips).
- Linear-blend skinning shows a slight candy-wrapper twist at the waist at full abdomen_z (±45°).

## Files
- `src/danceLab/designs/index.js`: registry of D1-D6. DanceLab.jsx spreads it into its design table
  (digit keys extended to 1-9, 0; the default caption is per design).
- `src/danceLab/designs/dvariants/`:
  - `retarget.js`: the retargeter;
  - `RiggedCharacter.jsx`: route 1;
  - `ProceduralDancer.jsx` and `proceduralBody.js`: route 2;
  - `shared.jsx`: lights, rim, foot shadow, headphones.
- `public/dance/characters/rocketbox-{male-18,male-17,female-12}/{model.glb,LICENSE.md}`.
