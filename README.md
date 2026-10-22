# Quadrion AI website

Marketing site prototypes for Quadrion AI, the offline drone inspection and survey workspace by Synapse Solutions.

The animated **Quori chat** is integrated into `/d3-quarter/`, with its character studio at `/quori/`. Run `npm ci` then `npm run dev` and open `http://127.0.0.1:5186/d3-quarter/`. See [Quori chat setup](docs/quori-chat.md) for the private backend, Grokbot handoff, embedding and production activation. The animation studio retains 11 expressions and 12 gestures.

The selected direction is **The Quarter** (`directions/d3-quarter/`). The other folders under `directions/` are earlier explorations, kept for comparison.

## Run locally

```bash
node directions/serve.mjs
```

Then open:
- http://127.0.0.1:5180/ for the overview of all directions
- http://127.0.0.1:5180/d3-quarter/ for the current page

There is no bundling step. The Quarter loads three.js, GSAP and Lenis from self-hosted, versioned copies under `directions/vendor/` (earlier directions still use the CDN).

The Netlify build also runs `npm run build:data`, which writes a gzip sibling (`*.glb.gz`, `*.bin.gz`) next to each binary dataset, because Netlify does not compress those types. `quadrion-data.js` prefers the sibling and falls back to the original file, so local previews work without it. After changing photos, run `npm run build:thumbs` to regenerate the WebP thumbnails; after changing the plant cloud, run `npm run pack:plant-cloud`.

## Deploy

Netlify checks the public files, publishes `directions/`, bundles the Quori functions, and provisions/migrates its database as configured in `netlify.toml`:
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
