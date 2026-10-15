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

Owner notification receipt is awaiting confirmation. The owner was asked to check the usual Grokbot chat for the test name, marker and reference. Until that confirmation is recorded, this verifies webhook acceptance and receipt persistence, not final owner delivery.
