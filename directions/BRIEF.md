# Quadrion AI website: shared brief for the visual direction prototypes

## Product
Quadrion AI is made by Synapse Solutions. It is an offline-first Windows desktop app for drone inspection and survey teams.
It fuses everything a drone job produces into one georeferenced 3D scene with one timeline:
- 3D models, point clouds, orthomosaics and offline maps
- drone video synced to its flight log and projected onto the 3D model from the drone's own position
- 360 panoramas and photos
- annotated issues with severity grades, and comparison across survey dates

Buyers are inspection, survey, construction and asset-integrity teams in oil and gas, utilities, government and construction. The first market is the GCC, and many customers work on restricted networks.
Key promises:
- runs fully offline, data stays on your disks, no telemetry, no account
- optional NVIDIA GPU processing, about 20x faster photo matching
- an AI agent in every window, using your own key, off by default
- free Player for read-only client packages (.aio)
- exports to Civil 3D, TBC and 12d

Tagline: **"Four dimensions. One view."** (x, y, z + time)
Tone: serious, calm, precise, defence-grade. Never neon, never gamer, never generic "AI startup" gradients or purple.

## Fixed brand (do not change)
- Mark ("the Quarter"): three white quarter-ring segments plus a mint square tail.
  - Files: `assets/quadrion-symbol-on-dark.svg`, `assets/quadrion-symbol-on-light.svg`, `assets/quadrion-horizontal-on-dark.svg`, `assets/quadrion-horizontal-on-light.svg`, `assets/favicon.svg`.
  - Symbol path data, 60x60 viewBox:
    - `M4.06 25.28A23 23 0 0 1 25.28 4.06A1.6 1.6 0 0 1 27 5.66L27 15.01A1.6 1.6 0 0 1 25.61 16.59A10.5 10.5 0 0 0 16.59 25.61A1.6 1.6 0 0 1 15.01 27L5.66 27A1.6 1.6 0 0 1 4.06 25.28Z`
    - `M32.72 4.06A23 23 0 0 1 53.94 25.28A1.6 1.6 0 0 1 52.34 27L42.99 27A1.6 1.6 0 0 1 41.41 25.61A10.5 10.5 0 0 0 32.39 16.59A1.6 1.6 0 0 1 31 15.01L31 5.66A1.6 1.6 0 0 1 32.72 4.06Z`
    - `M25.28 53.94A23 23 0 0 1 4.06 32.72A1.6 1.6 0 0 1 5.66 31L15.01 31A1.6 1.6 0 0 1 16.59 32.39A10.5 10.5 0 0 0 25.61 41.41A1.6 1.6 0 0 1 27 42.99L27 52.34A1.6 1.6 0 0 1 25.28 53.94Z`
    - mint square: `M36.6 35H54.4A1.6 1.6 0 0 1 56 36.6V54.4A1.6 1.6 0 0 1 54.4 56H36.6A1.6 1.6 0 0 1 35 54.4V36.6A1.6 1.6 0 0 1 36.6 35Z`
- Dark palette:
  - backgrounds: bg0 #0B0F13, bg1 #11161C, bg2 #1E2630
  - line: #2A3340
  - text: text0 #EEF2F5, text1 #C5CDD6, text2 #8E99A6
  - accent mint: #5ED1B3
- Light palette:
  - backgrounds: bg0 #F1F4F5, bg1 #FFFFFF, bg2 #E8EDEF
  - line: #D6DEE2
  - text: text0 #11161C, text1 #33404C, text2 #5D6B78
  - accent: #1A8C70
- Severity colours, used sparingly as data colours only: red #E5484D, orange #F2994A, yellow #E8C547, blue #5B9BD5.
- Fonts: IBM Plex Sans (400/500/600), IBM Plex Sans Condensed, IBM Plex Mono. Load them from Google Fonts for these prototypes.
- Mint is the ONLY brand accent. Use it with restraint.

## Real app screenshots (fictional "Demo tank farm" data, safe to show)
- `assets/app-scene-3d.png` (1292x806): the main 3D scene with a drone video panel, telemetry, issue pins, timeline and stockpile volumes. This is the best hero product shot.
- `assets/app-issues.png`: issue register
- `assets/app-issue-card.png`: one issue with photos
- `assets/app-reports.png`: report builder
- `assets/app-settings-ai.png`: AI provider settings
- `assets/app-package-export.png`: client package export

Never write real client or site names. Never use the product's former name.

## Technical rules
- Each direction is ONE self-contained file, `directions/<slug>/index.html`, with inline CSS and JS. Reference assets as `../assets/...`.
- Allowed CDNs, pinned versions only:
  - three.js through an importmap: `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js` and `.../three@0.160.0/examples/jsm/`
  - GSAP and ScrollTrigger: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js` and `ScrollTrigger.min.js`
  - Lenis smooth scroll: `https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js`
  - Google Fonts
- Generate all 3D procedurally: point clouds, terrain, tanks, flight paths. Do not load external models.
- Build the prototype as a real landing page:
  - sticky nav
  - hero
  - at least 3 scroll sections that show off the direction's signature motion system
  - a feature section with rich hover states
  - an offline/security trust section
  - a CTA ("Request a demo" / "Download the free Player")
  - a footer
- Must work at 1440px desktop and 390px mobile with no horizontal scroll.
- Respect `prefers-reduced-motion`: provide static fallbacks and turn off the scroll-jacking feel.
- Performance:
  - cap devicePixelRatio at 2
  - pause the render loop when the canvas is off-screen (IntersectionObserver)
  - no layout thrash
- Add a small fixed badge at bottom-left reading "Direction X · Name", linking back to `../index.html`.
- Polish bar: this should feel like an award-level site, with deliberate easing (expo/quart out), staggered reveals, crisp 1px hairlines, tabular mono numerals and considered hover states on every interactive element. Avoid templated SaaS clichés: no purple gradients, no generic glassmorphism cards in a 3-column grid, no emoji icons.
