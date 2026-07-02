# Sarcelles-Lochères Building Visual Reference Spec
*For the AniRacers Sarcelles-Lochères kart-racing world (low-poly recreation)*

## Overview
Sarcelles-Lochères is a 1960s French *grand ensemble*: standardized modernist
social housing with repetitive geometric forms — ideal for flat-shaded box models
with simple window-grid textures. Prioritize recognizable silhouettes (long
horizontal slabs) over fine detail.

## Building Types

### 1. BARRES (long apartment slabs) — PRIMARY TYPE
- Height: 8–15 stories (~24–45 m); length 100–200 m; width 12–15 m.
- Ground floor ~3–4 m, upper floors ~3 m each.
- Façade base colors: concrete beige `#E8E0D5`, cooler concrete gray `#D4CFC8`.
- Accent panels: brown `#8B7355`, blue-gray `#4A5F7A`.
- Windows: highly repetitive horizontal grid, ~1.5 m wide × 1.2 m tall, every ~3 m
  horizontally and every floor vertically. Windows dark `#1A1A1A`.
- Balconies: continuous horizontal bands every 2–3 floors, 1–1.5 m deep, railings
  match façade or slightly darker.
- Roof: flat, dark gray `#4A4A4A` / tar `#2B2B2B`, low parapet.
- Ground level: recessed entry alcoves; some pilotis (stilts) and storefronts.

### 2. SCHOOLS (École Maternelle & Élémentaire Jean Macé)
- 2–3 stories (6–9 m); 30–50 m × 20–30 m, L-shaped or rectangular.
- Façade cream `#F5E6D3`, warm accent `#E6A157`; larger classroom windows ~2 m.
- Flat roof (some low shed sections); entry canopy; red/yellow/blue accent panels.
- Fenced playground with colorful ground markings.

### 3. SYNAGOGUE DE SARCELLES
- 2–3 stories (6–10 m), ~20 m × 15 m. Modern/brutalist, white/cream `#F8F5F0`.
- More ornate entrance; Star of David / Hebrew lettering as texture decal; small plaza.

### 4. RÉSIDENCE ANNE FRANK
- Same barre model, different color variant or signage texture.

### 5. GROUND-LEVEL ELEMENTS
- Parking: asphalt `#3D3D3D`, white lines `#FFFFFF`.
- Green spaces: grass `#6B8E4E`, sparse low-poly deciduous trees.
- Playground "Aire de jeux": colorful equipment (red/yellow/blue primaries).
- Streets: asphalt `#4A4A4A`–`#5C5C5C`; sidewalks `#B8B8B8`; curbs ~0.15 m.

## Color Palette Summary
- Façade: beige `#E8E0D5`, gray `#D4CFC8`, school cream `#F5E6D3`, synagogue `#F8F5F0`.
- Accents: brown `#8B7355`, blue-gray `#4A5F7A`, school orange `#E6A157`.
- Infra: roofs `#4A4A4A`/`#2B2B2B`, asphalt `#3D3D3D`–`#5C5C5C`, sidewalk `#B8B8B8`, grass `#6B8E4E`.
- Windows `#1A1A1A`; balcony railings match façade or darker.

## Race-loop street buildings (Google Maps pin route, June 2026)
Loop: START (Aire de jeux, 48.978700/2.374210) → P2 Paul Valéry east (48.980063/2.374902)
→ P3 NW Camus/Valéry (48.980440/2.372210) → P4 Albert Camus west (48.978453/2.371434)
→ P5 Paul Herbé south (48.978110/2.374007) → START.

Street View reference URLs (for manual capture):
- Barre Paul Valéry: https://www.google.com/maps/@48.980063,2.374902,3a,75y,180h,90t
- Synagogue: https://www.google.com/maps/@48.979676,2.372696,3a,75y,90h,90t
- École Jean Macé: https://www.google.com/maps/@48.979300,2.373800,3a,75y,270h,90t
- Playground start: https://www.google.com/maps/@48.978700,2.374210,3a,75y,0h,90t
- Barre Albert Camus: https://www.google.com/maps/@48.978453,2.371434,3a,75y,90h,90t

- **Avenue Paul Valéry (north):** long barres parallel to street, 10–12 stories, parking strips.
- **Rue Robert Desnos (east):** barres perpendicular to street; École Jean Macé complex.
- **Boulevard Albert Camus (west):** barres, some commercial ground floors.
- **Avenue/Rue Paul Herbé (south):** continuing barre pattern; Synagogue nearby.
- **Rue Louis Lebrun (central):** barres both sides; Résidence Anne Frank; central playground.

## Implementation tips
1. One master "barre" box with variable length (stretch along one axis).
2. Window/balcony texture as a repeating grid; tint with vertex colors for variety.
3. 3–4 color schemes, varied lengths/rotation to avoid monotony.
4. Flat roofs with low parapet; optional emissive "lit windows" at night.
5. Bake simple AO in corners / under balconies for distant LOD boxes.

## Reference notes
Based on satellite imagery of 48.978797, 2.374265 and partial Street View
(Google Maps consent dialogs limited full navigation). Architectural style:
1960s *grand ensemble* modernist social housing — extreme repetition, geometric
simplicity. Screenshots in this folder: `satellite-overview-sarcelles-01.png`,
`barre-sarcelles-01.png`.
