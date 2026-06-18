# Building photo → 3D model spec

You are analyzing Google Street View photos of buildings in the **Mishkenot Zvulun / Nof HaTalmim** neighborhood of **Netanya, Israel**, to produce a 3D-model spec for each building in a low-poly racing game.

## Input
You will be told a chunk file path and an output file path. Read the chunk JSON: it is an array of buildings, each `{id, img, area, levels, dist, conf}` where `img` is the absolute path to the photo, `area` is footprint m² (may be null), `levels` is the OSM floor count (may be null), `dist` is metres from camera.

For **each** building, use the **Read** tool on `img` to view the photo, then decide its spec. The camera is aimed at the building's centroid — focus on the most prominent building near the **center** of the frame. Photos may be partly blocked by trees/walls/cars or show several buildings; do your best and lower `conf` when unsure.

## Output spec — EXACTLY these fields per building
- `floors`: integer 1–25. **If `levels` is given, use it** (authoritative) unless the photo flatly contradicts it. If `levels` is null, estimate from window rows; fall back to: area>250 → 4, else 2.
- `wall`: hex `"#rrggbb"` of the dominant wall colour. Realistic Israeli-residential tones — white `#f2f0ea`, cream `#ece3d0`, beige `#e6d8bd`, light grey `#dfe1e3`, sandstone `#d8cdb5`, ochre `#e3c98f`. Pick the closest (or a nearby hex).
- `roof`: `"flat"` | `"gabled"` | `"hipped"`. Most apartment blocks/towers and many houses are `"flat"`. Red/orange tiled pitched roofs → `"gabled"` (long ridge) or `"hipped"` (4-sided pyramid).
- `roofColor`: hex. Flat ≈ `"#c9cdd2"` (grey). Tiled ≈ `"#b25a3c"` (terracotta).
- `cols`: integer 1–8 = windows per floor across the visible facade width. Towers/blocks 4–6, houses 2–3.
- `balconies`: true if the facade has rows of protruding balconies (typical of apartment blocks/towers); else false.
- `doors`: 2 if clearly a semi-detached pair (two front doors / mirrored houses); else 1.
- `shutters`: true if windows have prominent external shutters/blinds (common on houses); else false.
- `stoneBase`: true if the ground floor/base is clad in stone or a different material from the upper walls; else false.
- `solar`: true if rooftop solar water heaters (white/black cylinders + panels) or rooftop water tanks are visible; else false.
- `style`: `"tower"` (≥8 floors) | `"apartment"` (4–7) | `"house"` (1–3 low/detached) | `"villa"` (1–3 with tiled roof).
- `conf`: `"high"` | `"med"` | `"low"` — how clearly the photo shows THIS building.
- `notes`: ≤8 words.

When the photo is unusable (only trees/wall/sky/road, or clearly a far different building), set `conf:"low"` and choose sensible defaults from area/levels (big+tall → tower/apartment, flat roof, balconies; small → house, flat or tiled roof).

## Write the result
Use the **Write** tool to write the output file path as strict JSON, no prose:
```
{"chunk":<k>,"specs":{"<id>":{ ...spec... }, ...}}
```
Then reply with ONE line only: `chunk <k>: N specs, <#high>/<#med>/<#low> conf`.
