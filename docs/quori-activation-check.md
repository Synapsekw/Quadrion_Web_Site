# Quori live Grokbot check — 15 October 2026

The owner explicitly requested a real Grokbot test. Quori's private webhook URL and key were compared with Orbi's existing local configuration and match. Only equality checks were printed; credentials were not exposed or changed.

One live enquiry was submitted through the connected widget at `http://127.0.0.1:5186/quori/`, using **Contact the team → Review request → checkbox confirmation → Confirm & send**. This exercised the actual browser, local backend, encrypted delivery store and shared Grokbot webhook, with mock mode disabled.

- Test name: `Quori integration test`
- Dummy contact: `quori-test@example.invalid`
- Marker: `QUORI-LIVE-20261015-A`
- Reason explicitly states this is an internal test, not a customer enquiry, and no customer callback or email is required.
- Event type: `quori.contact.requested`
- Source: `Quadrion website / Quori`
- Receipt: `7de978332baf`
- Webhook result: accepted (the handler maps HTTP 200 to this state).

Quori displayed **Request submitted**. Reloading the page and reopening Quori restored the same receipt and reference without resubmitting the enquiry. No browser warnings or errors were reported. Existing chat history was preserved. No production deployment or configuration change was made.

The owner confirmed receipt in the usual Grokbot chat on October 15, 2026: “Yes, it arrived.” This verifies the complete local widget → backend → shared Grokbot routine → owner notification path for Quori, alongside receipt persistence after reload. Production deployment remains separate.

## Production deployment — 15 October 2026

PR #1 was merged into `main` as `65ef8cb` and published automatically by the existing `quadrionai` Netlify project. Netlify reported the database migration applied successfully. The live page is `https://quadrionai.netlify.app/d3-quarter/`; the character launcher has no visible caption and retains its accessible name, glow, and static fallback.

The production status endpoint returned HTTP 200 with `mode: live`, `test_mode: false`, and `callbacks_enabled: true`, plus a Secure session cookie and `Cache-Control: no-store`. A real chat exchange correctly described Quadrion and explained that website chat cannot access local files. The deploy-preview endpoint remained in `preview` mode.

A single reviewed production enquiry used the name `Quori Netlify production test`, dummy contact `quori-test@example.invalid`, and marker `QUORI-NETLIFY-20261015-A`, explicitly saying TEST ONLY and no callback/email required. The real webhook accepted it with reference `ca13ece94442`. The owner confirmed “Yes, it arrived” in the usual Grokbot chat, verifying the full published website → Netlify Functions/database → Grokbot → owner notification path.

Private values are secret entries scoped to production Functions only. The production encryption secret is distinct from the local one. Allowed origins include the Netlify hostname plus `https://quadrion.ai` and `https://www.quadrion.ai`. During the final check, both custom-domain HTTPS URLs resolved successfully to `https://quadrion.ai/d3-quarter/`, and the custom-domain API returned live mode with enquiries enabled. No DNS records were changed in this task.
