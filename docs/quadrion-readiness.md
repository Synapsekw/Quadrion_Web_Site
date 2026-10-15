# Quadrion website readiness — 15 October 2026

The supplied Lighthouse 9.6.8 report found performance 25, approximately 39 MB transferred, and no installable PWA. A fresh Lighthouse 13.5.0 mobile baseline against quadrion.ai measured performance 39, LCP 5.0 s, total blocking time 6.34 s and 12,306 KiB transferred before its collection ended. Scores across Lighthouse versions are not directly comparable.

## Implemented

- Install manifest, standard/maskable/apple icons, optional browser-offered install button and root-scoped service worker.
- Offline navigation returns a small inline branded page. It clearly distinguishes the online marketing PWA from the offline desktop product. The service worker caches only that page and four public icons; chat, API calls, POSTs and inspection datasets are never cached or queued.
- Mobile starts with the SVG mark and animated lightweight Quori; the scene renderer starts when the visitor explores, and Quori's 3D renderer loads on intent. Headline and actions are visible immediately.
- Detailed 3D datasets load by active chapter, with one adjacent preload and one build at a time. Ready datasets remain available for reverse scrolling. Tiny 320 px WebP previews (59 KB together) preserve the four introductory windows; they were rendered from the existing project cameras, not fabricated assets.
- Fonts are self-hosted under their SIL Open Font License. Road evidence photos follow scene demand. Reduced-motion stills wait for their imagery.
- Mobile controls have larger hit areas, the narrow header fits, and the compact launcher avoids the main actions.
- Canonical and social metadata, truthful organization/software structured data, sitemap and robots file. Old design directions and the character studio are noindex. Apex redirects permanently to the current canonical page; the production Netlify hostname redirects to quadrion.ai.
- Visible GCC context names UAE, Saudi Arabia, Kuwait, Qatar, Bahrain and Oman. No invented offices, translations, reviews or local business claims.

## Verification

- 67 Node tests pass, including service-worker isolation/cache lifecycle, deferred-avatar lifecycle, loader priority/deduplication and reduced-motion tile readiness.
- Public-artifact scan and JavaScript/diff checks pass.
- Production mobile Lighthouse 13.5.0 after deployment: performance 98, accessibility 100, best practices 100, technical SEO 100; FCP 1.8 s, LCP 2.0 s, TBT 60 ms, CLS 0, initial transfer 304 KiB. Measured at 2026-10-15 11:59 UTC using the same default mobile emulation and headless/disable-gpu flags as the fresh baseline; no audit warnings. This measures initial landing-page loading, not the entire interactive tour.
- Separate production Lighthouse 11.7.1 PWA checks all pass, including installable manifest/service worker, splash screen, theme colour, maskable icon and viewport. Lighthouse 13 no longer includes a PWA category. This does not replace physical iOS/Android installation testing.
- Browser: 390 px and 360 px layouts, 360×640 short-screen layout, demo dialog, live local Quori connection, direct product view and four preview windows.
- Real offline test: stopped the local origin server, reloaded the controlled landing page, observed the branded offline fallback, restarted the server and followed Try again successfully. No enquiry was sent during this verification.
- PR #4 merged and production verified on quadrion.ai: manifest, icons, worker headers, sitemap/robots, canonical, permanent redirects and indexing headers. The production mobile demo dialog fits and Quori reaches its connected AI-assistant state without console errors. No test enquiry was sent.

## Remaining SEO and device validation

A perfect Lighthouse SEO score is a technical checklist, not a measure of GCC rankings. The quadrion.ai Domain property is verified in Google Search Console through a Netlify DNS TXT record. Google processed https://quadrion.ai/sitemap.xml successfully and discovered the canonical homepage. Its live URL inspection on 15 October 2026 reports "URL is available to Google" and "Page can be indexed". The manual Request indexing action failed because Google's reCAPTCHA service could not connect; indexing itself is not yet confirmed. Keep the verification TXT record in place.

Real visitor Core Web Vitals, actual iOS/Android installation and field-device GPU performance still need observation. All six full scenes remain substantial if the visitor explores the entire tour.

The owner's confirmed direction is English-only GCC SEO; an Arabic version is out of scope. For stronger regional discovery, develop useful English industry pages and genuine regional case studies. Add local business/office data only for locations the company actually operates. Do not create six duplicate keyword pages.

Installation is browser-dependent: supported Chromium browsers expose Install Quadrion when available; iOS users can add the site through Safari's Add to Home Screen. The web app offers a launch shortcut and offline fallback, not offline chat or the full desktop application.

## Private portal — deployed, authenticated acceptance pending

Login, member/admin interfaces, T1–T3, private assignments, manually created tester passwords and a 100 GB per-project limit were deployed through PR #5. At the Owner's explicit request, PR #6 replaced mandatory MFA with email/password access and one public Log in entry; it is live at production commit `9b3915f`. Owners/admins are routed to administration and members to their library. All 132 automated tests pass, and earlier PostgreSQL concurrency scenarios and desktop/360px preview checks passed. Supabase migrations 001–007 and both private buckets are live. The migration 007 audit confirms Owner access at `aal1`, ten forced-RLS tables, no direct browser portal RPC grants and private storage. Auth URLs and the global 100,000,000,000-byte Storage limit are configured. All production function settings are saved and portal access is enabled. Production login renders, deployed portal bundles match the build, privacy headers pass, anonymous member/admin API requests return 401, and the deploy preview is denied production access. The live Owner sign-in attempt reached Supabase but returned `invalid_credentials`; the account holder must complete sign-in with the password entered at account creation or recover the account. Authenticated user/file acceptance remains pending; no full-size 100 GB transfer has been tested. See `portal-operations.md`.
