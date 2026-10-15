# Quori conversational widget

User brief: inspect Aria, Mono and Orbi; give Quori the same chat experience and capabilities, connected to the existing Grokbot handoff, tailored to Quadrion.

The live references share an animated compact character in a header, a welcome message and three suggested questions, a scrollable text conversation, a composer, reset/retry/reconnect, and a visitor-reviewed contact flow. Aria and Orbi use OpenAI for answers and Grokbot for confirmed team enquiries. Quori will reuse that architecture with isolated sessions and storage.

Design: graphite #0B0F13, raised #11161C, line #2A3340, pearl #EEF2F5, muted #A5B2BC, mint #5ED1B3. IBM Plex Sans. A 410px desktop panel with a 76px animated Quori header and a mobile modal. Welcome: “What would you like to explore?” Suggested starts: the 3D workspace, changes over time, offline workflow. No changes to the unselected marketing page.

Implementation:
- Adapt the inspected Orbi client/contact flow and Node/Netlify backend, including encrypted transactional sessions, server-owned history, origin/CSRF validation, limits, stable request IDs and contact delivery receipts.
- Scope knowledge and navigation to verified Quadrion material. Distinguish the offline desktop product from this online website assistant. No invented release date, prices, downloads or access to visitor project data.
- Reuse the existing private provider/Grok connection locally; generate a separate Quori session secret and database. Keep credentials outside the static publish directory and Git. Do not send test notifications.
- Replace the scripted demo with the reusable widget; retain the animation studio and all approved visual refinements.
- Validate adapted backend contracts with mocked upstreams, client tests, desktop/mobile browser interactions and a local real reply. Prepare Netlify activation documentation; no public deploy.

Completed: 33 automated tests pass, public artifact credential scan passes, live English/Arabic follow-up and history restoration verified. Mobile contact review and simulated receipt verified at 390×844; chat/composer bounds checked at 667×375. Independent review findings corrected and rechecked. Shared Grokbot wiring is configured privately, but no real bot notification was sent. Production activation is documented in docs/quori-chat.md.
