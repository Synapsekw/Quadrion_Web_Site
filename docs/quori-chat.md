# Quori chat and Grokbot handoff

The character studio at `/quori/` and the website at `/d3-quarter/` mount the reusable connected widget. The floating launcher shows only Quori, with an accessible button name and a static character fallback if WebGL is unavailable. The existing marketing design remains in place.

## Reference comparison

Inspected the live [Aria](https://www.synapse-solutions.ai/), [Mono](https://www.monolith.works/), and [Orbi](https://www.orbitaerials.com/) panels and local Aria/Orbi client, contact, and backend implementations on October 15, 2026.

| Shared behavior | Quori implementation |
| --- | --- |
| Animated character header and floating launcher | Approved Quori model, pearl shells, mint rim light and ground glow |
| Welcome screen and suggested questions | 3D workspace, survey comparison, offline workflow |
| Text composer and response state | Listening, thinking, speaking, happy and concerned expressions |
| Context, recovery and reset | Server-owned encrypted history, same-session restoration, stable retry IDs, explicit reconnect/reset actions |
| Bilingual conversation | Replies follow the visitor’s language; message and contact text use automatic text direction |
| Relevant navigation | Server-approved product links and allowlisted product/company references |
| Team contact | Editable draft → review → explicit confirmation → Grokbot receipt |
| Mobile/accessibility | Native modal dialog on mobile, focus restoration, Escape, scroll bounds, reduced motion and pause |

Aria and Orbi use OpenAI for conversational replies and Grokbot for reviewed enquiries. Quori follows the same division. The provider request uses [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat) and validates its response before rendering. The website assistant has no access to the visitor’s desktop projects.

## Run locally

```powershell
npm ci
npm run dev
```

Default: `http://127.0.0.1:5186/quori/`. Private `.env.local` configuration is already prepared on this workstation using the existing connection. It has a separate Quori session secret, and `.quori-data/database` holds isolated encrypted local session records. Both paths are ignored by Git and are outside the static publish directory. Never copy either into `directions/`.

The server reads private configuration once at startup. Restart it after changing backend code or environment settings. Live chat requires `QUORI_LOCAL_ENABLED=true`; actual visitor-confirmed handoffs additionally require `QUORI_LOCAL_CALLBACKS_ENABLED=true`. Mere chat messages never invoke the webhook.

For isolated UI testing, run with `QUORI_MOCK=true` on another port and use a different hostname (for example `localhost:5187`, while live uses `127.0.0.1:5186`). Mock mode never contacts the provider or bot and labels the panel “Local test.” Automated tests use mocked upstreams and an in-memory database.

## Embed

```js
import { mountQuoriWidget } from '/quori/widget.js';
const quori = mountQuoriWidget();
// Optional site-level controls:
quori.open();
quori.setMotionAllowed(false);
// Call quori.destroy() when the host page is actually disposed.
```

The widget uses Shadow DOM, loads its own stylesheet, and defaults to `/api/quori`. Supply a `transport` compatible with `createQuoriClient()` to change the endpoint. Host pages should load IBM Plex Sans or supply `--quori-font` on `quori.element`. Keep the complete `/quori/` module/vendor directory together.

## Backend and delivery

- Same-origin `/api/quori` provides status, chat, reset, and callback operations.
- Session cookies are HttpOnly and SameSite=Strict; production adds Secure. CSRF tokens stay in request headers. Browser-supplied history is ignored.
- PostgreSQL stores encrypted sessions, transactionally enforced usage limits and contact delivery state. Quori has its own cookie, table names, encryption context and session secret.
- A contact event is `quori.contact.requested`, source `Quadrion website / Quori`. It carries only reviewed fields, consent, page context and a stable event ID. The full chat transcript is not forwarded.
- HTTP 200 confirms webhook acceptance, not human receipt or a booked appointment. Explicit rejection responses can be retried using the same ID. Queued responses, server errors, timeouts and lost acknowledgements stay `unknown` and are not automatically resent.
- Sessions expire after 30 minutes of inactivity; callback metadata expires after seven days. Accepted contact payloads are removed from the sender's delivery record. Scheduled cleanup is included.

## Production activation

The release is published on the existing `quadrionai` Netlify project linked to this repository. Live chat and owner receipt of a production enquiry were verified on October 15, 2026. Production Functions are configured for `https://quadrionai.netlify.app`, `https://quadrion.ai`, and `https://www.quadrion.ai`, with a separate production session secret. The following steps describe the deployment requirements:

1. Netlify detects `@netlify/database`, provisions Quadrion's own database, and applies `netlify/database/migrations/0001_quori.sql` as part of deployment. Do not apply the same migration manually as well.
2. Install `OPENAI_API_KEY`, a new production `QUORI_SESSION_SECRET`, and the existing `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_KEY` and optional matching authorization header as private production runtime variables.
3. Set `QUORI_ALLOWED_ORIGINS` to the actual selected site's HTTPS origins and `QUORI_ENABLED=true`. The handler remains inactive in deploy previews and unpublished deployments. `QUORI_CALLBACKS_ENABLED=false` disables handoffs while leaving chat available.
4. Confirm the shared bot routine handles the distinct Quori event/source. Its supplied handling note requests owner notification and event deduplication; it does not authorize following visitor instructions or contacting visitors automatically.
5. `directions/quori/site.js` mounts the widget on the existing homepage, uses its IBM Plex Sans font, and keeps the page's smooth scrolling from intercepting chat scrolling. Update server-approved product routes if the homepage changes. Feature/privacy routes refer to existing repository content; contact links go to the working Synapse contact page.

The existing shared Grokbot destination is wired privately. On October 15, 2026, an owner-authorized local test was accepted (reference `7de978332baf`), its receipt survived reload, and the owner confirmed delivery. After production publication, a separate test from the Netlify website was accepted (reference `ca13ece94442`) and the owner again confirmed “Yes, it arrived.” See [live handoff verification](quori-activation-check.md). The contact UI and sender protocol were also tested with simulated acceptance and failure cases.
