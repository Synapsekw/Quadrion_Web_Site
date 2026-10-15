# Mobile performance, search foundations and PWA implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement and verify each task.

**Goal:** Make the live Quadrion marketing site installable and usable offline, reduce unnecessary initial mobile work, and fix technical search foundations.

**Architecture:** Keep public product copy in static HTML. Progressively load expensive scene data and mobile WebGL. A narrow service worker serves a small branded offline fallback without caching communications or the full inspection datasets.

**Tech stack:** Static HTML/CSS/ES modules, Three.js 0.160, GSAP, Netlify Functions/Forms, Node tests.

**Spec:** User request for mobile/GCC SEO assessment and PWA support, with supplied Lighthouse report (performance 25, 39 MB, no manifest/service worker). Fresh baseline Lighthouse 13.5: performance 39, LCP 5 s, TBT 6.34 s, 12 MB measured before audit cutoff.

## Constraints and review focus

- Preserve Quori appearance, chat/backend connection, demo email destination, and camera travel effects.
- Never cache POSTs, API responses, conversations, or visitor contact details. Never queue/retry enquiries offline.
- Preserve usable static content, reduced motion, keyboard access, small mobile screens and back-scrolling through the tour.
- Do not invent offices, Arabic translations, reviews, clients, pricing or regional rankings.
- Test jumps directly to a later scene, failed/slow assets, chat opened before its avatar loads, service worker updates and offline navigation.

## Tasks

- [x] PWA: manifest, opaque standard/maskable icons, offline page, narrow service worker, deferred registration and optional install control. Test worker isolation, cache lifecycle and manifest/icon requirements.
- [x] Scene performance: replace eager six-dataset loading with prioritised loading near each scene/app selection. Test deduplication, priority and failure behavior. Defer silhouettes to their visible section.
- [x] Initial mobile load: immediate headline, SVG logo while WebGL loads on exploration, deferred Quori 3D enhancement with state-preserving proxy. Test delayed state, destroy and failure behavior.
- [x] Search/mobile integration: canonical and social metadata, truthful structured data, sitemap/robots, noindex prototypes, visible GCC context, generous mobile tap targets and safe areas.
- [ ] Verify: full Node suite, public-secret scan, syntax/diff checks, browser mobile/desktop/chat/tour smoke checks, comparable fresh Lighthouse report, service worker control and offline fallback.
- [ ] Review, PR/deploy preview, publish through existing Netlify workflow, verify production and document measured outcomes/remaining regional content work.
