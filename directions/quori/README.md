# Quori character preview

Run from the repository root in PowerShell:

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:5186/quori/. The studio includes 11 expressions, 12 gestures, a showcase, pointer gaze and drag rotation, motion pause, light/dark backgrounds, the approved concept, and a connected chat widget. See [chat setup and verification](../../docs/quori-chat.md) for the provider and Grokbot handoff.

The model preserves the three pearl arcs, graphite face, mint square, and warm oval eyes. The October 15 refinement adds larger eye catchlights, soft cheek warmth, pearl materials, mint rim lighting, and a ground glow that softens as Quori rises. Both avatar sizes use the same model and lighting.

## Component API

```js
import { createQuori } from './avatar.js';
const quori = createQuori(element, { compact: false, interactive: true });
quori.setState('listening');
quori.play('hello');
quori.setMotion(false);
quori.setVisible(false);
quori.destroy();
```

The host needs an explicit width and height. `motion.mjs` exports supported `STATES`, `GESTURES`, and `GESTURE_DURATIONS`. Gestures return to the selected expression. The controller respects device reduced motion, pauses when hidden/offscreen, and cleans up listeners and GPU resources on destruction. Three.js 0.160.0 and its MIT license are vendored in `vendor/`.

## Verification

- `node --test tests/quori-motion.test.mjs`: 6 passing tests for finite poses, gesture completion/interruption, pause, reduced motion, and input fallback.
- JavaScript syntax checks pass for model, avatar, and preview.
- Browser inspection covered every expression/gesture control, showcase interruption, pause/resume, reference dialog and Escape, live English/Arabic replies, restored history, reset, simulated contact review/receipt, light/dark stages, and compact WebGL avatars, with no reported browser warnings/errors.
- Mobile portrait checked at 390×844 with no horizontal overflow. At 667×375 the new chat remains inside the viewport (top 24px, bottom 351px, composer bottom 322px); its message area scrolls and close control remains reachable.
- Independent review findings were resolved and verified: ambiguous callback acknowledgements remain non-retryable, recovery buttons invoke their stated action, and contact navigation uses a working destination. `npm test`: 33/33 passing. `npm run check:public` passes. Device reduced-motion behavior is covered by motion tests, not OS preference switching.

Quori is also published on the existing Quadrion Netlify website. See [deployment and live handoff verification](../../docs/quori-activation-check.md) for the production checks, including owner-confirmed Grokbot delivery.
