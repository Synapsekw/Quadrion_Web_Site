# Quadrion tiered portal and administration design

Quadrion will provide an invite-only user portal and an administrator dashboard on its existing Netlify website. Supabase will hold accounts, permissions, release records and private files. Administrators can invite people, assign T1–T3 access, publish software updates and upload .aio project datasets without editing the website.

Status: revised design for owner review, 15 October 2026. The owner requested administrator/user pages and three access tiers. The Supabase project exists and public registration is disabled. Portal code, database tables and private file buckets have not been deployed.

## Access model

Tiers are cumulative. They govern the online distribution library; they do not change desktop project permissions or introduce a desktop licence requirement.

| User tier | App and pipeline downloads/updates | Basic project datasets | All project categories, including oil and gas |
| --- | --- | --- | --- |
| T1 | Yes | No | No |
| T2 | Yes | Yes | No |
| T3 | Yes | Yes | Yes |

Published installers and processing modules require at least T1. Basic .aio datasets require T2 or T3. Oil-and-gas and other restricted datasets require T3. New projects begin as unpublished T3 drafts until an administrator classifies them deliberately. Oil-and-gas classification cannot be saved with a lower minimum tier.

The proposed project audience model offers **Tier library**, available to active users meeting the minimum tier, and **Selected users**, available only to named users who also meet that tier. An assignment never bypasses a tier requirement. T3 is eligible for every project category but does not bypass a selected-users restriction. The owner has been asked to confirm this model; this document enables no actual project access.

Account status and expiry apply before tier or assignment. A suspended, revoked or expired account receives no content, including metadata and previews. Missing permission records deny access.

## Administrative roles

Administration is separate from customer tier. Setting a member to T3 never grants administrator rights.

| Role | Authority |
| --- | --- |
| Member | Access entitled downloads/projects; manage their own profile, password and session. |
| Admin | Invite/manage members, assign tiers, suspend/revoke access, upload/publish releases and projects, manage project assignments and inspect activity. Cannot create admins or modify owner/admin privileges. |
| Owner | All admin functions, plus appoint/revoke administrators and manage portal settings. |

Bootstrap the initial owner through a trusted setup operation bound to a verified Supabase Auth user ID, never by accepting a role from a signup request. Require authenticator-app MFA before owner/admin API access. The server verifies current role, account status and session assurance. Preserve at least one active owner. Recovery uses the Supabase organization owner's trusted administrative access, not a public bypass.

## User pages

| Route | Contents |
| --- | --- |
| /portal/ | Sign-in when logged out; otherwise account tier, current releases and eligible recent projects. |
| /portal/downloads/ | App installers, processing modules, version history, platform, size, SHA-256, release notes and compatibility instructions. |
| /portal/projects/ | Authorized library with search, categories, thumbnails, versions and required application version. T1 sees an explanation of library access without restricted project details. |
| /portal/projects/:id/ | Authorized project description, included datasets, version notes and .aio download. Missing and unauthorized IDs have the same outward response. |
| /portal/account/ | Profile, tier/status/expiry, password change, MFA settings where applicable, and sign out. Users cannot edit their tier or role. |

Invitation and reset flows return to exact approved portal URLs. No public registration form. Reset responses do not disclose account membership. Invited people set their own passwords; administrators never see passwords. Include accessible errors, keyboard navigation, loading/empty/denied states and responsive layouts.

Match the public site's dark palette, typography and teal accents, with a quiet application layout rather than its heavy 3D tour. Add a discreet Client login link in the navigation/footer. Keep the bottom demo/free Player buttons removed and public content English-only with GCC SEO.

## Admin pages

| Route | Capabilities |
| --- | --- |
| /admin/ | Active users by tier, pending invitations, published releases/projects and recent activity. |
| /admin/users/ | Search; invite with tier/optional expiry; resend invitations; change tier; suspend/reactivate/revoke; manage project assignments. |
| /admin/releases/ | Upload installers/pipelines; set version/platform/compatibility/notes; inspect validation; publish or retire. |
| /admin/projects/ | Upload .aio packages and cover images; set title, category, description, version, minimum app version, tier/audience; publish, update or archive. |
| /admin/activity/ | Filter invitations, permission changes, publication actions and download-link issuance by user/resource/time. |
| /admin/settings/ | Owner-only administrator management and portal operational settings. No service keys or SMTP passwords displayed. |

Invitations bind the intended tier/expiry to the Auth user ID returned by Supabase. Show invited, active, suspended and revoked states. Delivery failures or incomplete database writes remain recoverable and grant no access. Idempotent retries must not create duplicate users or repeatedly send mail. First verified sign-in activates an invited member only while the invitation grant remains valid.

Audit permission/publication changes with actor, target and safe before/after values. Revision checks prevent stale tabs from overwriting newer changes. Commit permission changes and their audit events together. Record invitation dispatch separately from confirmed email delivery.

Retain administrative audit events for 365 days and download-link issuance events for 90 days. Automated retention cleanup runs with server authority; ordinary admins cannot edit or erase audit events. Use server-side quotas for invitations, upload sessions and download-link issuance so UI throttling is not the only control.

Archiving immediately removes a resource from the member catalogue and blocks new links. Retain files/version history for recovery; permanent deletion is a separate owner operation. Published binaries are immutable. New project versions inherit the parent project's current access policy.

## Hosting and desktop boundaries

Use the existing Quadrion Supabase project, oxjrkodcmflxejdwsuac, on Micro compute in Mumbai, with Netlify serving pages and authorization APIs. Large files transfer directly to/from Storage. Processing pipelines run on the user's desktop, not on the Micro database instance.

Supabase Auth, database and Storage are the initial hosting choice. Supabase plus Cloudflare R2 remains an alternative if bandwidth economics later justify another provider. Public Netlify files would not satisfy private access.

The portal offers versioned app and pipeline updates for installation through existing desktop workflows. Automatic authenticated in-app updates, browser project rendering, collaborative editing and billing/subscriptions are separate features, not promised by this implementation.

The .aio format is confirmed in desktop source as a portable project package. The website distributes the file for opening in the desktop app. Preserve package encryption/export restrictions; do not extract its contents into public assets.

Admin uploads deliberately place a copy in Mumbai. The portal never scans or automatically uploads desktop projects. Upload only owner-selected datasets suitable for that hosting location. Existing desktop documentation describes local storage and no hosted customer-data service; website/privacy/help copy must distinguish the optional hosted library from local desktop work before publication. Projects requiring another storage location need an appropriate destination.

## Database structure

These are proposed migration entities, not existing tables.

| Entity | Responsibility and key fields |
| --- | --- |
| portal_members | Auth user ID, role, member tier 1–3, status, optional expiry, display name/company, inviter, timestamps and revision. Authoritative permissions. |
| portal_invitations | Normalized email, intended tier/role/expiry, inviter, resulting Auth ID, idempotency key and delivery/status timestamps. Admin-only. |
| software_releases | App/module kind, version, platform, app/pipeline compatibility, notes, draft/published/retired status and publication time. |
| projects | Title, description, category, minimum tier, audience mode, draft/published/archived status, current published version and revision. |
| project_versions | Project ID, version, minimum app version, dataset summary, notes and publication state. Immutable after publication. |
| project_assignments | Project ID/member ID pair, optional expiry, granting actor and timestamps. Restricts selected-users projects. |
| artifact_files | Exactly one release or project-version parent, bucket/path, display filename, bytes, MIME type, SHA-256 and upload/verification state. |
| upload_sessions | Admin ID, intended artifact/path, expected size/checksum, expiry and finalization state. Authorizes one destination. |
| portal_events | Actor/subject/resource, action, safe before/after values and time. Link issuance is not reported as a completed transfer. |

Use foreign keys, enum/check constraints and uniqueness for versions, assignments and object paths. Transactions enforce owner invariants and publish operations. Covers/previews inherit project permissions. No file can belong to both a software release and project version.

Enable RLS throughout. Anonymous roles get no portal records; browser clients cannot write privileges, assignments, publication flags or audit events. APIs authorize every list, count, search, detail, preview, download, upload and administration request. Service-key access must still pass the application's current permission checks.

## Private file lifecycle

Use private buckets named quadrion-releases, quadrion-projects and quadrion-project-previews. Generate immutable paths from IDs and versions. All files start unpublished. Public bucket access and anonymous object reads stay disabled.

Admins upload using resumable TUS transfers with progress/retry controls. Server-authorized upload sessions are tied to one generated path with overwrite disabled. No service key reaches the browser. An upload token cannot publish content. Completion rechecks the administrator and expected object metadata. A revoked administrator cannot finalize/publish even if an older upload token has not expired.

Hash the source incrementally without loading the entire file into browser memory. A background verification job streams the stored object and checks its size/SHA-256 before marking it verified. Jobs use bounded retries and idempotent status updates. Failure/timeout leaves an unpublished file with a retry action. An administrator explicitly publishes a verified version; upload completion never publishes automatically. Checksums are not a malware-scanning or publisher-signing claim.

Run verification in an authenticated Netlify background function, invoked only for an authorized stored job ID. Do not accept arbitrary fetch URLs or file paths. Confirm background-function availability on the deployed plan before enabling uploads; its 15-minute limit must accommodate the approved maximum file size. If validation cannot finish, leave the object unpublished rather than skipping the check.

Initially allow release files up to 1 GB, sufficient for the inspected artifacts. Project limits are configured separately after inspecting the intended .aio sizes. Show the actual limit before upload rather than assuming datasets fit the installer limit. Test the largest approved project against deployed upload, background-validation and download limits before production. Monitor shared organization storage and egress.

## Download policy

A member project request requires: verified current Auth account, active/unexpired membership, published project/version, sufficient tier and an unexpired assignment when selected-users mode applies. Software requests require the same account checks, at least T1 and a published verified release. Admin access is a separate role/MFA path.

The server accepts a catalogue ID, derives the object path from trusted records, validates the token with Supabase, reads current permissions, limits URL issuance, records the event and returns a five-minute signed URL. Never accept arbitrary client bucket/path values. Do not expose restricted titles, previews, sizes or counts through other endpoints.

Downgrades, expiry, reassignment and suspension block new links on the next request. Existing signed URLs may work until expiry; downloaded files remain with their recipient. The portal is controlled distribution, not remote erasure or offline licence revocation.

Keep secret keys in production-only server configuration. Only the project URL/publishable key reach public code. Use a pinned official Supabase client, sessionStorage sessions, restrictive CSP, no-referrer, no-store and noindex. Remove consumed invite/reset tokens from the address bar. No credential/signed-URL logging. Exclude portal/admin/API data from PWA caches and the sitemap. Preview deployments receive no production secrets or private-file access.

## Release and email prerequisites

Inspected local artifacts: installer 0.14.0 (205,886,813 bytes), processing pack 0.7.0 (449,151,926 bytes), team kit 0.14.0 (656,440,025 bytes). The installer is unsigned; current source describes processing pack 0.8.0. The owner selects a compatible tested pair before publication. Label previews accurately and exclude internal handover reports/source files.

Custom SMTP is not configured. The owner has been asked which provider to use. Configure a verified sender, invitation/reset templates and exact redirect URLs. Credentials go through service settings, never chat. Public/anonymous signup stays disabled; email confirmation stays enabled. Real invitations need explicitly authorized recipients.

## Delivery sequence

1. Shared foundation: schema, RLS, permission policy, sessions, invitations and owner bootstrap. Test tier/role decisions independently of UI.
2. User portal: login/account, software releases and project library, all filtered by the shared policy.
3. Admin portal: users, uploads, publication, tier/audience controls and audit history; owner-only admin management and admin MFA.
4. Production: SMTP, private storage, approved files, responsive review and end-to-end invitation/download/revocation tests.

The foundation supports all tiers from the beginning. These are delivery checkpoints, not permission to expose a partial dashboard with placeholder authorization.

## Acceptance checks

- T1 downloads published app/pipeline updates and cannot discover project records, covers or files.
- T2 accesses basic datasets but cannot discover/download T3/oil-and-gas content by UI, guessed IDs or direct Supabase calls.
- T3 accesses every allowed category; selected-users restrictions still apply.
- Assigning a T3 project to T1/T2 never bypasses its tier. Downgrades and assignment expiry affect new requests immediately.
- Members cannot self-promote or call admin endpoints. Admins cannot promote themselves or change the owner. Missing/invalid MFA blocks administration.
- Unconfirmed, revoked, expired, deleted, invalid-token and missing-membership accounts fail closed. Outages do not return stale entitlements.
- Private files/previews/drafts fail public URL access. Valid signed downloads match expected bytes and expire.
- Interrupted uploads, duplicate completion, timeouts, checksum mismatch, conflicting edits and failed invitations recover without unauthorized publication.
- Activity records permission/publication changes and labels issuance versus completed downloads accurately.
- Invitation, reset, login/logout, library and admin forms work on mobile and desktop with keyboard access.
- Existing Quori/demo tests, public secret scanning and PWA isolation pass. Marketing pages gain no portal dependency weight.
- Live acceptance covers one authorized test user per tier, an MFA administrator, invitation delivery, checksum-verified downloads and denied access after revocation. Only owner-approved addresses/files are used.

## Sources

- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Supabase authentication configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Netlify background functions](https://docs.netlify.com/build/functions/background-functions/)
- Desktop repository: apps/desktop/src/main/packages.ts, docs/release/README.md and docs/release/SECURITY-AND-DATA.md.
