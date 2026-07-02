# Sarcelles circuit — Street View harvest kit

Produces a folder of Street View "contact sheets" (8 directional views per
location, yaw 0–315°, exactly like the reference image) for the *Elemental Tag*
course loop, with **every image georeferenced to its exact panorama GPS**.

This kit gives you the pipeline + all the pre-computed route points. It does
**not** include the photos themselves — Google Street View imagery has to be
pulled from Google's servers with your own API key (it can't be fetched here).

---

## What's in this folder

| file | what it is |
|---|---|
| `harvest_streetview.py` | the pipeline — run this with your key |
| `route_points.csv` / `.json` | the 42 sampled GPS points (5 waypoints + walk-between), pre-computed |
| `LAYOUT_PREVIEW.png` | a mock contact sheet showing the exact output layout (no real imagery) |
| `README.md` | this file |

After you run the script it creates `sarcelles_panoramas/`:

```
sarcelles_panoramas/
├── 001_<panoid>.jpg        ← contact sheet (8 yaws + GPS caption)
├── 002_<panoid>.jpg
├── ...
├── tiles/                  ← every individual view as its own jpg
│   ├── 001_<panoid>_yaw000.jpg
│   ├── 001_<panoid>_yaw045.jpg
│   └── ...
├── manifest.json           ← full machine-readable index
└── manifest.csv            ← same, flat
```

---

## Setup & run

```bash
pip install requests pillow

# Google Cloud: create a key, enable "Street View Static API", turn on billing
export GOOGLE_MAPS_API_KEY="AIza...your_key"
# optional but recommended for volume — URL signing secret:
export GOOGLE_MAPS_SIGNING_SECRET="your_secret"

python harvest_streetview.py
```

Tune the constants at the top of the script: `STEP_M` (sample spacing),
`YAWS`, `FOV`, `PITCH`, `TILE` size, `RADIUS` (snap distance).

**Cost / volume.** Metadata calls (used to snap + dedupe) are free. Image
calls are ~ $7 / 1000. Expect roughly 40–70 unique panoramas × 8 tiles ≈
**320–560 image requests** for this loop — a few cents. Standard tier caps
tiles at 640 px; raise `TILE` only if your account allows larger.

**Coverage.** The interior pedestrian paths of the estate may have gaps in
Street View; the script reports every point where no panorama was found and
simply skips it, so you'll see exactly what's missing.

---

## For the downstream / world-build agent

Read `manifest.json`. Schema:

```jsonc
{
  "crs": "WGS84",
  "fov_deg": 90,            // horizontal field of view of each tile
  "pitch_deg": 0,
  "yaws_deg": [0,45,90,135,180,225,270,315],
  "tile_px": [640, 400],
  "panoramas": [
    {
      "index": 1,
      "pano_id": "....",
      "lat": 48.9787,        // EXACT panorama position (snapped), not requested
      "lon": 2.37421,
      "date": "2024-10",     // capture month — watch for mixed dates / seasons
      "leg": "A_start->B_cp1",
      "nearest_waypoint": "A_start",
      "heading_is": "true-north compass degrees (0=N, 90=E)",
      "sheet": "001_....jpg",
      "tiles": { "0": "tiles/001_..._yaw000.jpg", "45": "...", ... }
    }
  ]
}
```

Key facts for reconstruction:
- The 8 tiles at one `index` share the same `lat`/`lon`; they differ **only**
  by `heading` (= the yaw key), measured in **true-north compass degrees**.
  So yaw 0 looks north, 90 looks east, etc. Use this to orient facades.
- `lat`/`lon` is the *real snapped panorama* location, which can be a few
  metres off the requested route point — always trust the snapped value.
- Tiles are **rectilinear crops** (gnomonic), not equirectangular, so adjacent
  yaws overlap by `FOV` logic; fine for reference, not for seamless stitching.
- `date` can vary between panoramas — buildings/foliage/cars may differ
  between adjacent locations captured in different months.

Route geometry (for context) is in `route_points.csv`: the loop is
`A → B → C → D → E → A`, ~849 m, sampled every 20 m.
