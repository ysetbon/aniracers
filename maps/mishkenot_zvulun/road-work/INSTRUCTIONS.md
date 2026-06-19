# Road photo -> road spec

You are analyzing Google Street View photos taken ALONG roads (camera looks down the road) to
classify each road for a low-poly racing game. The OSM tag is given as a strong prior.

## Input
Read the chunk JSON: an array of roads `{id, img, hw, baseType, surface, lanes, lengthM, conf}`
where `img` is the absolute path, `hw` is the OSM highway tag, `baseType` is the tag-derived
guess. Use the **Read** tool on `img` to view each photo.

## Output spec — EXACTLY these fields per road
- `type`: one of `avenue` (wide, ≥2 lanes, lane markings) | `street` (residential, 1–2 lanes) |
  `service` (narrow access road/alley) | `plaza` (pedestrian paved square/promenade, no cars) |
  `path` (footpath/trail/cycle path, often through greenery). Start from `baseType`; only change
  it if the photo clearly disagrees.
- `surface`: `asphalt` | `paved` | `paving_stones` | `cobblestone` | `concrete` | `compacted`
  (dirt/gravel) | `grass`. Use the OSM `surface` if given and the photo agrees.
- `markings`: `none` | `centre` (centre line/dashes) | `lane` (multiple painted lanes).
- `lanes`: integer 1–4 (driveable lanes; 1 for paths/plazas).
- `sidewalk`: true if there are sidewalks/kerbs beside the road.
- `conf`: `high` | `med` | `low` (how clearly the photo shows the road).
- `notes`: ≤8 words.

If the photo is unusable (blocked, indoors, clearly elsewhere) set `conf:"low"` and keep
`baseType` + the OSM surface.

## Write the result
Use **Write** to write the output file path as strict JSON, no prose:
```
{"chunk":<k>,"specs":{"<id>":{ ...spec... }, ...}}
```
Then reply with ONE line: `road chunk <k>: N specs`.
