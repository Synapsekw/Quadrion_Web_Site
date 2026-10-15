# Quadrion AI website

Marketing site prototypes for Quadrion AI, the offline drone inspection and survey workspace by Synapse Solutions.

The selected direction is **The Quarter** (`directions/d3-quarter/`). The other folders under `directions/` are earlier explorations, kept for comparison.

## Run locally

```bash
node directions/serve.mjs
```

Then open:
- http://127.0.0.1:5180/ for the overview of all directions
- http://127.0.0.1:5180/d3-quarter/ for the current page

There is no build step. Pages load three.js, GSAP and Lenis from pinned CDN versions.

## Deploy

Netlify publishes `directions/` as configured in `netlify.toml`, with no build step:
- `/` redirects to `/d3-quarter/`
- the overview of all directions is at `/overview`

## Layout

| Path | Contents |
| --- | --- |
| `directions/d3-quarter/` | The current page (The Quarter, round 3) |
| `directions/a*`, `b*`, `c-field`, `d-quarter`, `d2-quarter` | Earlier direction rounds |
| `directions/data/` | Survey datasets and the shared loader `quadrion-data.js` (road, terminal, tank, flare, facade, stockpile) |
| `directions/assets/` | Brand kit files (mark, lockups, favicon) |
| `directions/*.md` | Design briefs for each round |
