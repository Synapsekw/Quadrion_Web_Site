# Round 3: The Quarter (D3), refine and extend

The client chose **The Quarter** as the direction. This round polishes it into a near-final landing page and adds two new real datasets, **road** and **facade**, so the story covers six asset types.

Read first: `BRIEF.md` (brand and tone) and `ROUND2.md` (data rules, data layer, shared-browser etiquette). All rules there still apply:
- No video.
- No client, site or asset names or IDs.
- Never use the product's former name.
- Use real data only, and never invent findings for an asset that doesn't have them.

## Start point
Copy `directions/d2-quarter/` to `directions/d3-quarter/` (`index.html`, `d2-story.js` and `d2-gl.js`; renaming the JS files to d3-* is fine) and evolve it there. Leave d2 untouched. Badge: "Direction D3 · The Quarter".

## New datasets (tested, in `data/quadrion-data.js`)

### `loadRoad()` → `{ road, cells, defects, centreline, pciMesh, defectPoints, closeups }`
- **What it is:** an urban ring road, **7.55 km**, in local metres (x east, z south, y = 0).
- **`road`:**
  - `centreline` `[[x,z]...]` with `chainageKm`
  - `stats`:
    - 2,115 defects: 1,896 low, 190 medium, 29 high
    - `byType`: 609 longitudinal cracking, 580 transverse, 526 bleeding, 202 raveling, 85 block, 71 alligator, 25 patching, 8 rutting, 8 potholes, 1 edge
    - 1,783 PCI sample units
  - `pciNetwork` `{low:94.8, medium:87.6, high:77.5}`; `sections` (PCI per 250 m); `ratings` (ASTM D6433 colour scale)
  - `hero.km` = 3.96: the stretch where 6.5 cm ortho tiles exist
- **`roadOrtho(road, z)`** returns lazily-loaded ortho tile planes:
  - z = 3 (52 cm, 64 tiles) or z = 4 (26 cm, 256 tiles) for the whole corridor
  - z = 6 (6.5 cm) only around the hero stretch
- **`pciMesh`:** pavement cells coloured by PCI rating.
- **`defectPoints`:** all 2,115 defects coloured by severity.
- **`closeups`:** 28 real defect close-up photos with the defect outline polygon in image pixels.
- **How to present it:**
  - The road is the asset for **X / distance**: a long linear corridor.
  - Fly low along the centreline. Hand off from the overview ortho to the 6.5 cm tiles at the hero stretch.
  - Let PCI colour sweep along the pavement as a scanline that travels with chainage. A km counter ticks.
  - Defects pop by severity.
  - Show 2–3 close-up cards that draw their outline polygon onto the photo.
- **ASTM note:** severity is a screening grade from the 2D ortho. Say "screening" or "mapped", not "measured depth".

### `loadFacade()` → `{ model, patches, meta, photos, thermal, classColor }`
- **What it is:** a residential tower facade, **74 m** tall, in local metres (Y up).
- **`model`:** the tower massing model, already transformed.
- **`patches`:** one merged mesh of **715 mapped defect areas**, vertex-coloured by class (`patchIndex` attribute → `meta.patches[i]` `{issue, cls, sev, component, center}`).
  - These areas are LARGE and the class colours are loud: yellow soiling, pink cladding.
  - Present them with restraint: low opacity, reveal class by class with a legend, highlight on hover.
  - Never as a permanent highlighter wash.
- **`meta.stats`:**
  - 656 graded issues: 474 minor, 182 moderate
  - 45 uncertain
  - by class: 211 staining, 196 soiling, 155 cladding, 34 loose object, 31 sealant, 14 corrosion, 8 thermal, 6 water, 1 glazing
  - 1,146 RGB + 36 thermal photos
- **`photos`:** 4 curated RGB review photos with a colour class-overlay PNG and findings (class, severity, component, elevation side, height, note).
- **`thermal`:** 2 real thermal frames.
- **How to present it:**
  - The tower is a **Z / height** asset next to the flare.
  - Show photo-to-model linkage: a photo card whose overlay maps to its patch.
  - Include an RGB → THERMAL toggle or wipe on a card; that's a strong moment.

## Story structure for D3
Six assets now map onto the four dimensions, plus one interior chapter. Recommended mapping (refine if you find better):
- **X · Distance** → road (7.55 km corridor)
- **Y · Area** → tank terminal (2.1 × 1 km site)
- **Z · Height** → flare stack (80 m) and tower facade (74 m)
- **T · Time** → stockpile (Survey 1 → Survey 2)
- **Inside** → storage tank interior (LiDAR)

The quadrant windows ("Four dimensions") should show road / terminal / flare / stockpile. The tour then visits all six assets, each entered with a DISTINCT transition built from the mark's geometry where possible (quarter-ring iris, square wipe, ring sweep, quadrant split).

Add a light, always-visible **tour index** ("01 Road · 02 Terminal · 03 Tank · 04 Flare · 05 Facade · 06 Stockpile") that shows progress and lets visitors jump to a chapter.

## Polish list (from review of D2)
1. **Performance:** the flare and stockpile ran at ~30 fps.
   - Lower DPR to 1.25–1.5 during heavy scenes.
   - Dispose or hide off-tour assets.
   - Avoid rendering hidden quadrant windows.
   - Only one heavy asset should be live at a time.
   - Aim for 60 fps on desktop. The road ortho tiles must not stall the main thread.
2. **Tank interior is grainy:** smaller points, intensity contrast, depth fade, and a camera that frames the shell curvature.
3. **The statement section** ("Video, models, point clouds…") is a large empty band. Give it a quiet background: very sparse drifting points from all six assets, or the six assets as tiny silhouettes in a row. Keep the words-light-up effect.
4. **Consistent figures everywhere** (counters, chapters, app window, AI answers). Counters must settle on exact values, never mid-count when the copy is fully in. Official values:
   - plant: 757,579 points, 8 storage tanks
   - tank: 280,000 LiDAR points, 6 findings
   - flare: 78 patches (77 moderate, 1 light)
   - stockpile: 76,199 → 63,402 m³ (−12,797), 19 piles
   - road: 7.55 km, 2,115 defects, PCI 87.6 (medium assumption)
   - facade: 656 graded issues, 715 mapped areas
5. **App window:**
   - The dataset sidebar lists all 6 assets, and clicking one switches the live scene.
   - The issue panel shows real findings for the selected asset: tank findings, flare patches, road close-ups, facade photo findings.
   - The stockpile shows volumes.
   - The terminal shows asset tags (no fake findings).
6. **Horizontal chapters:** add a road chapter (a close-up with outline plus the PCI strip) and a facade chapter (RGB/thermal pair).
7. **Microinteractions:**
   - every link and button has a hover state
   - the nav highlights the current section
   - focus-visible rings
   - the custom cursor shrinks over text
8. **Typography rhythm:** consistent section labels ("0X / NAME"), max line lengths, and no orphans in big headlines.
9. **Mobile:**
   - each tour chapter gets a static-but-beautiful composition
   - no horizontal overflow
   - text never overlaps visuals
10. **Reduced motion:** stills per chapter, no scroll-jacking.

## Delivery
Report back in under 250 words: the structure, the transitions used per asset, measured FPS per chapter, and known issues.

Verify with screenshots at every chapter on desktop 1440 × 900 and mobile 390 × 844. Use your own page via `page.context().newPage()`.
