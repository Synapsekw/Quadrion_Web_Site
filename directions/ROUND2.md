# Round 2 brief: Directions A, B and D with real data

Read `directions/BRIEF.md` first. Brand, tone, fonts, CDN rules, accessibility and performance rules all still apply. This file overrides it where they differ.

## Client feedback on round 1
- A (Mission Control) and B (Layer Stack) were loved; the client called their animations "really, really nice". D (The Quarter) stays in. C is dropped.
- **The demo project data looks weak.** Stop using `assets/app-*.png` (fictional "Demo tank farm" screenshots) as hero or feature imagery. Show the REAL project data below instead.
- **The big ask:** the page should travel through the different asset types, each arriving with its own distinct, beautiful transition. Plant cloud → tank LiDAR → flare corrosion → stockpile change. Lean hard into this.
- More polish and more ambition. These are landing pages that must wow.

## Hard rules for real data
- **NO VIDEO of any kind.** Do not use any .mp4 or video element showing real footage. Stills are fine: finding photos, corrosion photos, the orthomosaic.
- **Never show a client, site or asset name or ID.** Use only neutral labels:
  - "Tank terminal"
  - "Storage tank interior"
  - "Flare stack, 80 m"
  - "Stockpile yard"
  - Neutral regional wording such as "GCC" is OK. No country, city or company names.
- Do not show the stockpile survey dates as real dates. Present them as "Survey 1" and "Survey 2, 10 days later".
- Never use the product's former name.

## The data layer: `directions/data/quadrion-data.js` (tested, works)
Import it from your page as `../data/quadrion-data.js`. Your page needs this importmap:

```html
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
```

Read the file header; it documents every export. Summary:

- **`load(name)` / `loadPlant()` / `loadTank()` / `loadFlare()` / `loadStockpile()`** return three.js objects in each asset's native metric frame (Y up). Results are cached, so calling twice is free.
  - **plant:**
    - `{ model, cloud, ortho }`
    - `cloud` is 378,789 real photogrammetry points with linear RGB `color`. The site is about 2.1 km × 1 km × 88 m and has 8 large storage tanks plus a jetty.
    - `model` is the engineering model, but it contains a huge flat sea plane (6000 × 4000 m) and a land plane. Hide every mesh whose bounding-box diagonal is over about 1500 m, or whose bbox height is under 0.5 m while its width is over 800 m.
    - `ortho` is the real orthomosaic on a ground quad.
  - **tank:**
    - `{ model, cloud, findings }`
    - `cloud` is 280k interior LiDAR points with `intensity` and grey `color`. The tank is about 4.7 m across and 9.5 m tall.
    - `findings` has 6 real findings: `{ id, title, severity 1–5, class, area, description, position: Vector3, photo: url }`.
  - **flare:**
    - `{ model, patches, records }`
    - `model` is a textured 80 m stack.
    - `patches` holds 78 mapped corrosion patches. Each is `{ mesh, record, center: Vector3, photo, mask }`, with the photo as .webp and the mask as .png. Add `patch.mesh` to the scene in the same frame as `model`.
    - Each `record` has `{ id, title, description, component, zone, severity 1–3, classId, coverage, camera }`.
  - **stockpile:**
    - `{ e1, e2, volumes }`
    - `e1` and `e2` are two survey dates of a real ~470 × 515 m yard: textured terrain plus yellow pile outlines.
    - `volumes.piles[i].epochs.e1/e2` gives real per-pile `areaM2`, `heightM` and `volumes.tin.{ fill, cut, net }`.
- **`samplePoints(name, N, radius)`** resamples ANY asset into exactly N points, normalised onto a common stage. The asset is centred on x/z, sits on y = 0, and has a max half-extent of `radius`. It returns `{ positions, colors (linear), heights (0..1), center, scale, size }`.
  - Because N is the same for every asset, **one THREE.Points with a custom shader can morph between assets** by lerping position/colour attributes. That's the backbone for the asset-to-asset transitions.
  - Sampling takes about 50–300 ms per asset at 120k points. Sample assets lazily, ahead of when they're needed.
- **`stageTransform(name, radius, N)`** returns a Matrix4 that places native objects (model, cloud, patches) onto that same stage. Use it to cross-fade from the morphing points to the real mesh or cloud.
- `ASSETS` holds neutral labels and stats.
- Data weight:
  - plant ≈ 11 MB
  - flare ≈ 19 MB (mostly 78 photos and masks; load those only on demand)
  - tank ≈ 5 MB
  - stockpile ≈ 6 MB
- Show tasteful loading states, and never block first paint on data. Render the hero with whatever is ready, procedural if needed, and swap the real data in.
- `directions/data/test.html?a=plant&m=points|model` is a minimal working example.

## Transition vocabulary
Use these between assets; each direction picks its own subset:
- **Point morph:** particles fly from asset A's surface to asset B's surface with staggered per-particle delays, some curl-noise turbulence, then settle.
- **Scan resolve:** a horizontal scanline sweeps and converts points into the solid textured mesh behind it.
- **Dissolve and fall:** points drop out by height or by noise threshold.
- **Slice and section:** a clipping plane cuts into the tank to reveal the interior scan.
- **Patch ignition:** corrosion patches light up in severity order along the flare's height, and leader lines open with the real photos.
- **Epoch wipe:** a scrubbed divider between Survey 1 and Survey 2, with a cut/fill colour diff and volumes counting.
- **Exploded layers (B):** each asset gets its own stack (ortho, terrain, cloud, mesh, issues) that fuses, then the next asset's stack unfolds.

## Product UI
Do not use the demo screenshots. When you need to "show the app", build an HTML/CSS recreation of the app chrome around the live WebGL canvas, rendering real data:
- left dataset sidebar
- top bar
- timeline with tracks along the bottom
- right issue panel showing the real findings and photos
- the AI agent box

Follow the brand tokens. It's more impressive than a screenshot, and it is real data.

## Delivery
- **Round 1 must survive.** Put your work in a NEW folder: A → `directions/a2-mission/`, B → `directions/b2-layers/`, D → `directions/d2-quarter/`. Start from a copy of your round 1 `index.html` and evolve it. Keep what the client loved: A's HUD, callouts and scroll flight; B's fuse-on-scroll and bento tilt. Upgrade everything else.
- Splitting JS into a sibling `.js` file is fine if the page gets large.
- Badge bottom-left: "Direction A2 · Mission Control" (or B2/D2), linking to `../index.html`.
- A preview server already runs at http://127.0.0.1:5180/ (root = `directions/`). Do NOT start, stop or restart it.
- Other agents share the Playwright browser. In `browser_run_code_unsafe`, open your own page with `const p = await page.context().newPage()` and close it when done. Don't navigate the shared default page.
- Verify:
  - no console errors
  - desktop 1440 × 900 and mobile 390 × 844, with no horizontal scroll
  - reduced motion works
  - every asset actually renders; look at your screenshots
  - FPS is reasonable: cap DPR at 2, use fewer points on mobile (≈ 60k), and pause rendering off-screen
