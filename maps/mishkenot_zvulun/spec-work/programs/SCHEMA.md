# Scene-program schema v3 (docs/exact-geometry-program-plan.md)

One JSON per building = the FULL frame of its restyled ref: the building (volumes,
per-facade openings, balconies, roof forms, materials) plus its frontage environment
(compound wall, gates, sidewalk, verge, road band) and global style samples. All colours
are hex strings **pixel-sampled from the ref** (scripts/sample-colors.mjs) — agents must
not invent colours. Distances in metres; positions inside a volume use fractions 0..1 of
the footprint OBB (x along the street-facing width, z into the lot, front = z0 side).

```jsonc
{
  "id": "556597974",
  "refs": { "scene": "restyled/bld_<id>.png", "iso": "restyled/iso/bld_<id>.png" },
  "footprint": "obb",              // "obb" (fit rectangle) | "poly" (extrude real polygon)
  "floorH": 3.0,
  "volumes": [{                     // additive boxes over the footprint
    "name": "main",
    "x0": 0.0, "x1": 0.62,          // fraction of OBB width
    "z0": 0.0, "z1": 1.0,           // fraction of OBB depth (0 = street side)
    "floors": 2,
    "wall": "#fbf6d9",
    "bands": [{ "floor": 1, "y0": 0.15, "y1": 0.95, "color": "#a89a7e", "style": "slats" }],
    "roof": { "form": "flat", "fascia": { "h": 0.55, "color": "#f4ecd2", "overhang": 0.35 } }
  }],
  "openings": [{                    // per volume+facade; grid or singles
    "volume": "main", "facade": "front",   // front|back|left|right
    "type": "window",               // window|door|garage|opening
    "floor": 1, "cols": 2, "at": [0.3, 0.7],  // fractions along that facade
    "w": 1.5, "h": 1.4, "glass": "#4b5058", "frame": "#f4f1e8", "recessed": true
  }],
  "terraces": [{                    // balcony/terrace slabs with rails
    "onVolume": "wing", "side": "top",       // top = roof terrace; or facade name
    "parapet": { "h": 0.9, "color": "#fbf6d9" },
    "rail": { "type": "bars", "h": 0.35, "color": "#3f3c34" }
  }],
  "props": [{ "type": "ac", "volume": "main", "facade": "left", "floor": 1, "at": 0.4 },
            { "type": "lamp-globe", "volume": "main", "facade": "front", "at": 0.55 }],
  "frontage": {                     // between footprint front edge and the road
    "wall": { "type": "brick", "color": "#949688", "mortar": "#b5b7ab", "h": 1.9 },
    "gates": [{ "kind": "vehicle", "w": 5.5, "style": "ornate-arch", "color": "#5a564b" },
              { "kind": "pedestrian", "w": 1.2, "style": "ornate-arch", "color": "#5a564b" }],
    "sidewalk": { "material": "stone-slabs", "color": "#a89d8b", "joint": "#8d8474", "w": 3.0 },
    "verge": { "grass": "#a0b663", "grassDark": "#6c7c57",
               "flowers": { "palette": ["#e04438", "#f2d24b", "#f6f3ea"], "perM2": 0.15 } },
    "road": { "surface": "asphalt", "color": "#8f9296" }
  },
  "sky": { "top": "#5ea2db", "horizon": "#9fcfe4", "cloud": "#f4f6f6" },
  "notes": "free text for the critic loop"
}
```

Factory contract: scripts/house-factory.js `makeBuildingV3(program, obb)` builds the
building group; `makeFrontageV3(program, frontLine)` builds wall/gates/sidewalk/verge.
Every element is crisp Box/Prism geometry with MeshLambert flat colours — no textures.
The critic loop (plan: acceptance gate) edits THESE fields only; geometry code stays fixed.
