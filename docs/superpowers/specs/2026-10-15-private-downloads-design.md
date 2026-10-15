# Quadrion private downloads design

Quadrion will keep its public website on Netlify and use the owner's new Supabase project for invited accounts, download permissions and private release files. Selected people can sign in and download the Windows application and its compatible processing modules. The owner can revoke access without redeploying the website.

Status: proposed portal design for owner review. Project provisioning is complete; the portal is not implemented or connected yet.

## Confirmed scope

- Keep the website English-only, with GCC SEO. Do not add Arabic pages.
- Use the existing Netlify website and the new **Quadrion** Supabase project, `oxjrkodcmflxejdwsuac`, in Mumbai on Micro compute.
- Allow access only to people selected by the owner. No public registration, anonymous accounts or shared download password.
- Host installers and processing modules privately. Logging in alone is insufficient: the account must also have current download approval.
- Keep the bottom demo and free Player buttons removed.

## Hosting decision

Use **Supabase Auth, Postgres and private Storage** together for the initial selected-user group. This keeps the account and operating workflow in the service the owner already uses. Netlify functions validate download requests; the files transfer directly from Storage so large downloads do not pass through a function.

An alternative is Supabase Auth/Postgres with Cloudflare R2 for files. That may be useful if download bandwidth becomes substantial, but adds another account and storage integration. An all-Netlify/public-file solution does not meet the requirement: hiding links behind a login does not protect publicly accessible files.

Monitor storage and egress against the organization's shared Supabase allowance before broadening distribution. Compute size does not set the download file size limit.

## User experience

Add `/downloads/` with Quadrion's existing dark background, typography, teal accent and restrained lighting. The portal is a simple responsive page without the heavy 3D tour. A discreet **Client login** link in the main navigation and footer opens it.

An invited person follows their email invitation, chooses their own password, and can subsequently sign in with email and password. Include password reset, sign out, loading states, expired-link recovery and an accessible error message. There is no create-account form. Return generic responses to password-reset requests so the page does not disclose account membership.

Approved accounts see release cards with product/module name, version, supported operating system, file size, SHA-256, release notes and compatibility instructions. The installer and its matching processing pack appear together. An authenticated account without approval sees an access-pending message and the existing contact address. Mobile visitors can inspect the catalogue and see that Windows software needs a Windows computer.

## Owner workflow

For this initial small cohort, manage accounts in the existing Supabase dashboard instead of creating another administration website:

1. Invite the selected email address from Authentication.
2. Grant that account download access in the `download_access` table. Records are tied to the immutable Auth user ID, not a client-supplied email.
3. Revoke access by setting `enabled` to false. Optional `expires_at` supports time-limited access.
4. Upload a release to the private bucket, record its metadata as a draft, verify its checksum and compatibility, then mark it available.

Provide a short operator guide with screenshots and exact fields. No invitations are sent to customers until the owner supplies the recipients. A separate custom administrator UI is outside this first release.

## Authentication and authorization

Use the official Supabase JavaScript client, pinned and bundled locally on the portal page only. Store the browser session in sessionStorage, clear it on logout, and consume/remove invitation and reset tokens from the address bar immediately. Never log passwords, session tokens or signed download URLs. The portal has a restrictive Content Security Policy and no third-party tracking or chat script.

Every catalogue and download request must validate the bearer token with Supabase Auth and fetch current approval from the database. Reject absent, invalid, expired, banned or deleted accounts and revoked/expired approvals. Ignore user-editable metadata for authorization. Database outages fail closed.

The server selects the file from a release ID; it never signs an arbitrary object path supplied by the browser. Only published release records are downloadable. Use a fixed private bucket, `quadrion-releases`, and a five-minute signed URL. Limit issuance per account and record user ID, release ID and issue time; do not record tokens or full signed URLs.

Revocation prevents new URLs immediately on the next authorization check. Previously issued URLs may work until their five-minute expiry. A downloaded installer cannot be recalled; this is controlled distribution, not desktop licensing or DRM.

Keep all service/secret keys in Netlify server-only environment variables. Only the Supabase project URL and publishable key may reach the browser. Preview deployments must not inherit production secrets or issue production downloads.

## Database and files

- `download_access`: Auth user ID primary key, enabled flag, optional expiry and grant/update timestamps. Only the project owner or trusted server can modify grants.
- `download_releases`: ID, product/module kind, version, platform, private object path, display filename, byte count, SHA-256, compatibility notes, release notes, draft/published status and publication timestamp.
- `download_events`: user ID, release ID and URL-issue timestamp. Used for issuance limits and a basic access audit; not proof that a transfer completed. Retain for 90 days.

Enable RLS on every portal table and deny direct anonymous/client writes. Do not grant browser roles direct object access. Access to the catalogue and file signing goes through the authorized Netlify endpoints. Privileged access remains on the server.

Store objects under immutable versioned paths such as `windows/0.14.0/QuadrionAI-0.14.0-win-x64-setup.exe`. Do not overwrite an already published file. Use resumable uploads for large artifacts and verify stored bytes against local SHA-256 before publication. Set both project and bucket file limits to accommodate approved artifacts; an initial 1 GB cap fits the existing installer, module and kit.

## Release selection

The local artifact inspection found an approximately 206 MB Windows installer at version 0.14.0, a 449 MB processing pack at version 0.7.0, and a 656 MB team kit. The built installer is unsigned. The working source now describes processing pack 0.8.0, which must not be substituted for an older built pair without release verification.

Prepare the catalogue without automatically publishing those files. The owner must identify the release pair intended for distribution. Private preview builds must be labelled as previews; do not claim code signing. Do not upload internal handover reports, build notes, source code or unrelated project data. Desktop automatic updates and third-party ODM distribution are outside this portal implementation.

## Email and production configuration

Custom SMTP is currently disabled in the new project. The owner needs to identify the sending provider and enter its credentials through the provider/Supabase settings, not in chat. Configure the verified sender, invitation and reset templates, and exact `https://quadrion.ai/downloads/` redirects. Do not allow wildcard production redirects.

Keep public sign-up and anonymous sign-in disabled and email confirmation enabled. Test invitation delivery and the complete sign-in flow with an explicitly authorized test recipient before inviting real users. Supabase's default sender is restricted to project team addresses and is not a production delivery solution.

Portal HTML and APIs use `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `noindex` where applicable. Keep portal routes out of the sitemap. The existing service worker only intercepts listed public landing-page routes; add regression coverage proving it never caches or serves auth pages, tokens, catalogue responses or download URLs.

## Acceptance checks

- Anonymous, invalid-token, unapproved, expired and revoked accounts cannot list releases or obtain URLs, including direct API requests.
- Browser clients cannot self-grant access, alter releases or read objects directly through Supabase.
- An approved account can download only a published release. Invalid IDs, altered paths and draft releases fail closed.
- Private object/public-URL attempts fail. A valid signed URL downloads the expected bytes; expiry and fresh authorization after revocation behave as described.
- Invitation, password setup, login, reset, logout, expired-link handling and accessible keyboard/mobile layouts work end to end.
- Rate limits, upstream failures and audit cleanup behave predictably without leaking secrets.
- Existing Quori/demo tests and public-artifact secret scanning pass. The landing page does not gain portal dependencies or lose current mobile/PWA behavior.
- Production completion requires a successful authorized invitation, approved download with checksum verification, and a denied request after revocation.

## Sources

- [Supabase private buckets and signed URLs](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase authentication configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase custom SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
