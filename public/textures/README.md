# Finish textures

Each folder here is one scanned material, and the studio finds it by name: a
profile in `components/design/studio/materials-db.ts` sets `pbr: "<folder>"`.

## What a folder must contain

| file            | what it is | required |
| --------------- | ---------- | -------- |
| `diffuse.jpg`   | scanned colour, sRGB | only for finishes with `albedo: true` |
| `normal.png`    | surface relief, **OpenGL** convention | yes |
| `roughness.png` | gloss variation, read from the **green** channel | yes |

Three details are easy to get wrong and none of them fail loudly:

- **OpenGL, not DirectX.** Poly Haven publishes both; take the one named
  `nor_gl`. The `nor_dx` variant has its green channel inverted, which lights
  every bevel backwards — it looks like a subtly wrong shape, not like a bug.
- **Roughness lives in green.** Three.js samples `roughnessMap.g`. A scan that
  filled only the red channel renders as uniformly glossy, so broadcast red
  across RGB before saving.
- **Normal maps stay lossless.** A normal map is a per-pixel direction, and JPEG
  ringing on an XY vector shows up as faceting across a flat panel. The diffuse
  is a photograph and compresses fine.

## Tiling is relative to the model, not absolute

A profile's `repeat` says how many times its texture should cross a part, but
that only means something against a known unwrap. These models were unwrapped by
different people: three of them carry about 1.0-1.3 UV units per world unit, and
the patio armchair carries **16.5**, because it was unwrapped to tile its own
weave rather than to accept an arbitrary material. `StudioModel.uvScale`
divides that out. Measure a new model before setting it -- the number is the UV
span of a wood part divided by its world size -- rather than tuning `repeat`
until one chair looks right and every other one breaks.

## Check what the file actually is

One of the supplied sets was labelled cane and is vertical-grain bamboo: fine
parallel strands, no basket pattern anywhere in it. Open the diffuse and look
before naming a material after it. A customer who orders "natural cane" and is
sent a bamboo-faced panel has been misled by us, not by whoever made the scan.

## Sizes

1024 for colour and relief, 512 for roughness, which varies slowly. Poly Haven's
4K float EXR set is ~60MB per material; that is a download, not an asset. The
`dark-wood` set here is 2.1MB.

## A pale finish over a dark scan

A finish's `hex` multiplies the map, and multiplication can only darken — so a
pale finish cannot be made from a dark scan by tinting it. `gain` lifts the
result above 1 (the renderer's ACES tone mapping rolls the highlights off), and
`albedo: false` keeps the model's own photographed baseColor and takes only the
relief. Honey oak and Whitewash use both, because `dark-wood` is the only scan
present. A real light-timber scan is the proper fix, and needs no code change:
add the folder and set `albedo: true` on those two profiles.
