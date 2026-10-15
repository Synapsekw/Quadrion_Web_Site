# Quori animated preview

Goal: reproduce the user-approved Quori concept as an expressive interactive character and show a local preview. The user's selection and request to animate the approved visual are the design brief.

Architecture: standalone ES modules under directions/quori. A pure motion controller feeds a Three.js model through an avatar lifecycle wrapper. The preview controls use the same public API a future chatbot would use. Three.js is pinned to the website's existing 0.160.0, vendored for reliable local previews. No chatbot backend or live deployment is part of this preview.

Visual contract: three broad pearl quarter-ring shells, a graphite rounded face, one rounded mint square at lower right, warm oval eyes with dark pupils and mint glints, restrained smile. Sculpted depth and broad studio reflections. The original concept remains available in a comparison dialog. Preview palette follows BRIEF.md; typography IBM Plex Sans; large quiet character stage with a narrow expression library, responsive below 760px.

Task 1: motion and component (motion.mjs, model.js, avatar.js)
- [x] Tests first: reduced motion produces a static finite pose; nonfinite deltas do not poison pose; a gesture returns to its base state; interrupted gestures transition continuously; pause freezes time; invalid state falls back safely.
- [x] Model the shell from densely sampled beveled annular quadrants, rounded mint tile, and convex face with expressive eyes. Motion morphs the same geometry.
- [x] Lifecycle: pause offscreen and when the document is hidden; observe resize and reduced motion; dispose GPU resources; recover context; same-host mount is idempotent.

Task 2: preview (index.html, preview.css, preview.js)
- [x] Eleven everyday expressions and twelve gestures, showcase, pointer gaze, drag rotation, pause, light/dark stage, reference dialog, compact launcher and a clearly labeled simulated chat sequence.
- [x] Timed gestures finish, state selection interrupts the showcase, Escape closes dialogs, motion preference is respected.

Task 3: validation and handoff
- [x] Run motion tests and JavaScript syntax checks.
- [x] Inspect desktop/mobile screenshots against the approved reference; adjust geometry, lighting and framing.
- [x] Exercise every state and action, interruptions, pause, reduced motion, small avatar, mobile overflow, reference and chat controls.
- [x] Fresh code review; record findings and resolve material issues.
- [x] Open the preview and leave it running locally. No push or deploy.

Dependency order: task 1 -> task 2 -> task 3. Model and motion share a pose contract; preview consumes createQuori(host), setState, play, setMotion, setVisible, destroy. Native execution is appropriate because visual tuning is sequential and all files share this contract.


Validation and the requested glow/cuteness refinement are recorded in directions/quori/README.md. Fresh review found a short-screen chat overflow; the panel is now viewport-bound with a scrolling message area. Motion tests: 6/6 passing; JS syntax checks passing. Reduced motion verified at controller level; no OS setting changed.
