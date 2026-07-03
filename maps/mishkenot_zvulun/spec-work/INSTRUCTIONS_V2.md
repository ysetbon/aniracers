# Building spec v2 — vision extraction instructions (pilot: HaRav Toledano)

You are given, per building: several RAW Street View photos (different angles) and ONE
RESTYLED reference (the same scene redrawn as clean game art with cars/foliage removed).

Rule of thumb: **read geometry and counts from the RESTYLED image, verify colours against the
RAW photos** (the restyle preserves layout best but can drift hues; raw photos are the colour
ground truth). If views disagree, trust the closest/clearest raw photo.

These are 1–3 storey Israeli residential villas/duplexes. Write one JSON object per building:

```json
{
  "floors": 2,                     // visible storeys (count window rows / door height)
  "wall": "#e8e0cf",               // dominant facade colour (hex)
  "accent": "#b0a890",             // secondary facade colour or null
  "roof": "flat",                  // flat | gabled | hipped
  "roofColor": "#c96a45",          // tile colour if pitched, parapet colour if flat
  "cols": 3,                       // window columns on the street facade
  "windowStyle": "framed",         // plain | framed (visible frames/lintels) | horizontal (wide strip windows)
  "shutters": false,               // exterior roller shutters visible?
  "balconies": false,
  "doors": 1,                      // 1 or 2 street entrances (2 = duplex)
  "solar": true,                   // rooftop solar water heater / panels
  "stoneBase": false,              // stone-clad plinth at ground level
  "fence": { "type": "slat", "color": "#d8d2c0", "height": 1.6 },
                                   // type: slat (horizontal metal slats — very common here)
                                   //       stone | hedge | metal (bars) | none
  "gate": { "color": "#d8d2c0" },  // driveway/pedestrian gate, or null if none visible
  "style": "villa",                // villa | duplex | cottage
  "conf": "high",                  // high | med | low (occlusion, distance, disagreement)
  "notes": "orange tree in yard"   // <=8 words, anything distinctive
}
```

Constraints: floors 1..3, cols 1..6, fence.height 0.8..2.2, all colours hex. If the building
is almost fully hidden in every view, still emit your best guess with `"conf":"low"`.

Output: write `specs_v2_<k>.json` (k = your chunk number) into this directory, shaped as
`{"<buildingId>": {spec}, ...}` — nothing else. Reply with one line: chunk id + building count.
