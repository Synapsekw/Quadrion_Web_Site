# Quadrion tiered portal implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for implementation in this session, or superpowers:subagent-driven-development if the owner chooses delegation. Steps use checkbox syntax for tracking.

**Goal:** Deliver an invite-only portal with cumulative T1–T3 access, optional private project assignments and a separate owner/admin dashboard.

**Architecture:** Netlify serves lightweight portal/admin bundles and authenticated APIs. Supabase Auth verifies identities; database permission records govern every resource operation; private Storage serves versioned files through expiring links. Admin uploads remain drafts until verification and explicit publication.

**Tech stack:** Existing static HTML/CSS/ES modules and Node >=22 (Netlify Node 24); pinned Supabase JS client; esbuild for portal-only bundles; tus-js-client for resumable uploads; incremental SHA-256 in a Web Worker; Node test runner and existing PGlite test tooling.

**Spec:** docs/superpowers/specs/2026-10-15-private-downloads-design.md

**Status:** Implementation plan for review. The owner confirmed the tier-library plus optional private-assignment model. No portal code, migrations, production secrets or buckets have been applied.

## Global constraints

- Tiers are cumulative.
- Administration is separate from customer tier. Setting a member to T3 never grants administrator rights.
- An assignment never bypasses a tier requirement.
- Account status and expiry apply before tier or assignment.
- Public/anonymous signup stays disabled; email confirmation stays enabled.
- Processing pipelines run on the user's desktop, not on the Micro database instance.
- All files start unpublished.
- Published binaries are immutable.
- Keep secret keys in production-only server configuration.
- No credential/signed-URL logging.
- Exclude portal/admin/API data from PWA caches and the sitemap.
- Preview deployments receive no production secrets or private-file access.
- Keep the bottom demo/free Player buttons removed and public content English-only with GCC SEO.
- Downloads use five-minute signed URLs; previously downloaded files cannot be recalled.
- Use the existing project oxjrkodcmflxejdwsuac, not another Supabase project.
- Do not modify the AIO Software desktop repository or publish its artifacts automatically.

## Review focus

1. A T3 member loses a private assignment while keeping a valid session: list, detail, cover and new download requests must all deny the project.
2. Two administrators edit the same member or the last owner: stale revisions fail and at least one active owner survives.
3. An invite succeeds at Supabase but the response is lost: retries recover the existing identity and never grant a different user or send duplicate invitations automatically.
4. An upload finishes after its administrator is revoked: bytes may arrive through an outstanding upload token, but finalization/publication must fail.
5. A multi-GB project exceeds verification time or the network fails midway: the artifact stays unpublished, memory remains bounded and retry does not create a second published version.

Tests for these conditions belong to Tasks 1, 3, 4 and 5 below.

## Delivery map and interfaces

Use a dedicated portal subsystem; leave Quori's store, migrations and live transport unchanged.

| Files | Responsibility |
| --- | --- |
| supabase/migrations/202610150001_portal.sql | Tables, constraints, deny-by-default RLS and service-only database routines |
| netlify/lib/portal/policy.mjs | Pure role/tier/assignment decisions; no network or UI |
| netlify/lib/portal/config.mjs | Environment validation, enabled flag and production gate |
| netlify/lib/portal/supabase.mjs | Auth/claims verification and private database/storage adapter |
| netlify/lib/portal/http.mjs | Bounded JSON, origin/method checks, error mapping and private-response headers |
| netlify/lib/portal/member-api.mjs | Config, account, catalogue, project and signed-download actions |
| netlify/lib/portal/admin-api.mjs | Dispatch authorized administration actions |
| netlify/lib/portal/members.mjs | Invitations, membership changes, owner invariants and assignments |
| netlify/lib/portal/catalog.mjs | Release/project editing and publication |
| netlify/lib/portal/uploads.mjs | Scoped upload sessions, verification state machine and streamed hashing |
| netlify/functions/portal.mjs | /api/portal wrapper |
| netlify/functions/portal-admin.mjs | /api/portal-admin wrapper |
| netlify/functions/portal-verify.mjs | Background verification wrapper |
| netlify/functions/portal-cleanup.mjs | Retention and abandoned-upload cleanup |
| portal/src/auth.mjs, api.mjs, router.mjs, ui.mjs | Shared frontend auth, HTTP client, routing and safe DOM primitives |
| portal/src/member.mjs, admin.mjs | User/admin page controllers |
| portal/src/upload.mjs, hash-worker.mjs | Resumable upload UI and incremental file hashing |
| portal/src/portal.css | Shared responsive portal visual system |
| directions/portal/index.html, directions/admin/index.html | Separate static application shells |
| directions/assets/portal/* | Generated local bundles, including worker |
| scripts/build-portal.mjs, scripts/bootstrap-portal-owner.mjs | Build and trusted owner bootstrap |
| tests/portal-*.test.mjs, tests/netlify/portal-*.test.mjs | Policy, database, API, upload and frontend contract tests |
| docs/portal-operations.md | Owner operation, recovery, deployment and verification guide |

Member shape: userId, role ('member'/'admin'/'owner'), tier (1/2/3 for members), status ('invited'/'active'/'suspended'/'revoked'), expiresAt (ISO string or null), revision (integer).

Project shape: id, category ('basic'/'oil_gas'/'restricted'), minimumTier (2/3), audience ('tier'/'assigned'), status ('draft'/'published'/'archived'), currentVersionId, revision.

Assignment shape: projectId, userId, expiresAt (ISO string or null). Timestamps are compared against a server-supplied clock; invalid dates deny access.

Artifact shape: id, releaseId or projectVersionId (exactly one), bucket, objectPath, filename, bytes, sha256, state ('uploading'/'verifying'/'verified'/'failed'), revision. Cover artifacts also have a project-version parent.

All internal IDs are UUIDs. SQL object names use the names defined in the spec. API DTOs never return private object paths, service keys, invitation tokens or unrestricted Auth user records.

## Task 1: Permission policy and database foundation

**Files:** policy.mjs; the Supabase migration; tests/portal-policy.test.mjs; tests/portal-database.test.mjs; tests/helpers/portal-db.mjs.

**Produces:** activeMember(member, now); canReadProject({member, project, assignment, now}); canAdminister({member, aal, now}); a migration with all nine spec entities and atomic permission/publication routines.

- [ ] Write the first failing permission tests using explicit fixtures:

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadProject, canAdminister } from '../netlify/lib/portal/policy.mjs';
const now = Date.parse('2026-10-15T12:00:00Z');
const member = { userId: 'u1', role: 'member', tier: 3,
  status: 'active', expiresAt: null, revision: 1 };
const project = { id: 'p1', category: 'oil_gas', minimumTier: 3,
  audience: 'assigned', status: 'published', currentVersionId: 'v1', revision: 1 };
test('private assignment intersects the tier requirement', () => {
  const assignment = { userId: 'u1', projectId: 'p1', expiresAt: null };
  assert.equal(canReadProject({member, project, assignment, now}), true);
  assert.equal(canReadProject({member, project, assignment: null, now}), false);
  assert.equal(canReadProject({member: {...member, tier: 2},
    project, assignment, now}), false);
});
test('T3 does not confer administration', () => {
  assert.equal(canAdminister({member, aal: 'aal2', now}), false);
});
~~~

- [ ] Run: node --test tests/portal-policy.test.mjs. Expected: missing module/export failure before implementation.
- [ ] Implement the predicates with explicit enum/numeric validation, server clock, strict expiry boundary and default-deny behavior. Never derive access from user metadata or an unverified decoded JWT.
- [ ] Extend tests to all T1/T2/T3 x resource categories, tier versus assigned audience, null/mismatched/expired assignment, exact expiry instant, missing/invalid member, unconfirmed account at the API boundary, draft/archived resource, downgraded membership, and admin/owner without aal2.
- [ ] Create the migration for the nine entities in the spec. Enforce primary/foreign keys, per-project version uniqueness, artifact-parent exclusivity, immutable object paths, required tier for oil_gas, and member-tier validity. Use database timestamps and integer revision counters.
- [ ] Enable RLS; revoke browser-role writes and direct private reads. Revoke PUBLIC execution on privileged routines and grant only the server service role. Avoid automatic broad grants to authenticated.
- [ ] Add atomic routines for member changes, assignment replacement, publishing/archiving and quota reservation. Each receives a server-verified actor ID, rechecks the live actor/member state, compares expected revision, writes the mutation and audit event in one transaction. Serialize owner-role changes to prevent concurrent removal of the final active owner.
- [ ] In the PGlite helper create test-only auth.users and anon/authenticated/service_role fixtures before applying the migration. Test actual role permissions and constraints, not SQL source-string patterns. Test rollback on audit failure, stale revision conflict, duplicate version, T2 oil_gas classification and member self-grant attempts.
- [ ] Run: node --test tests/portal-policy.test.mjs tests/portal-database.test.mjs. Then npm test.
- [ ] Commit: git commit -m "Add portal permission model and protected schema"

## Task 2: Authenticated member API and private downloads

**Files:** config.mjs; supabase.mjs; http.mjs; member-api.mjs; functions/portal.mjs; tests/netlify/portal-member.test.mjs; .env.example; scripts/check-quori-public.mjs.

**Consumes:** Task 1 predicates and schema. **Produces:** createMemberHandler({config, backend, clock}) returning (request, context) => Promise<Response>.

Backend contract: verifyUser(token) -> {userId, emailConfirmed, aal}; activateInvitedMember(userId); member(userId); updateProfile(userId,{displayName,company}); listReleases(userId, cursor); listProjects(userId, filters, cursor); project(userId,id); authorizedArtifact(userId,id); reserveDownload(userId,artifactId); signDownload(artifact,300). Every permission lookup uses current records.

- [ ] Add denied-request tests before implementing the handler. A request without a token returns 401 and invokes no storage signing. A T2 token requesting a T3 artifact returns the same 404 body as an unknown artifact, even when its JWT/user metadata claims tier 3.
- [ ] Run: node --test tests/netlify/portal-member.test.mjs. Expected: missing handler before implementation.
- [ ] Configure exact env names: PORTAL_ENABLED=false by default, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, PORTAL_ALLOWED_ORIGIN=https://quadrion.ai. Include PORTAL_VERIFY_SECRET only for internal verification dispatch. Never expose secret values in errors.
- [ ] Permit production access only with trusted Netlify published-production metadata, following isPublishedProduction(context). Local development needs an explicit loopback-only mode; inherited env or request headers cannot activate preview production access.
- [ ] Pin the official Supabase client. Per request verify the token using Auth getUser and cryptographically verified claims, including aal, issuer and expiry. Do not trust a plain base64 payload. Read fresh membership afterward; use no shared mutable end-user auth client.
- [ ] Implement GET actions config, me, releases, projects and project; POST action download accepts only {artifactId}, and updateProfile accepts only {displayName,company} with server length limits. Config returns only enabled/project URL/publishable key when enabled. Whitelist filters and use bounded pagination (maximum 50).
- [ ] Before returning me, a verified email identity may activate its own unexpired invited membership through activateInvitedMember. This atomic transition changes only invited -> active and audits activation; it never creates a missing membership or reactivates suspended/revoked/expired access. Profile updates cannot change email, role, tier, status or expiry.
- [ ] Enforce methods, JSON Content-Type, 32 KiB body limit, exact allowed Origin for mutations, bounded upstream timeouts and no redirects to unknown services. No permissive CORS. Return no-store/no-referrer/nosniff headers and consistent 401/403/404/409/429/503 errors.
- [ ] Recheck authorization for list/detail/cover/download independently. Project counts include authorized rows only. Return no object paths before authorization. Private covers use the same five-minute mechanism.
- [ ] Reserve a transactional issuance slot before signing; start with 30 links per account per hour. Audit issued links without storing their URL/token. Distinguish reservation, successful issuance and failure; never describe an issuance as a completed download.
- [ ] Add tests for fresh revocation/assignment removal on the same token, forged role claims, unauthenticated config disclosure limits, expired/deleted/banned users, draft files, path injection, unknown IDs, upstream failure, rate-limit races and unpublished Netlify deployments.
- [ ] Extend public scanning to configured Supabase/verification secrets and sb_secret_ patterns. A publishable key is allowed; server keys are never ignored by the scanner.
- [ ] Run handler tests, npm test and npm run check:public.
- [ ] Commit: git commit -m "Add authenticated portal catalogue and download API"

## Task 3: Member portal and account flows

**Files:** shared frontend modules; member.mjs; portal.css; portal/index.html; build-portal.mjs; package.json; netlify.toml; tests/portal-client.test.mjs; tests/pwa.test.mjs.

**Consumes:** /api/portal; Supabase Auth SDK. **Produces:** the five user routes in the spec, bundled separately from the marketing site.

- [ ] Write failing client tests for unauthorized catalogue responses clearing prior content and for sign-out removing session/account/project state. Test the API client with real Request/Response values and a supplied fetch function.
- [ ] Run: node --test tests/portal-client.test.mjs.
- [ ] Add pinned build dependencies and a build:portal script. Build member, admin and hash-worker entries independently with no remote CDN code. Keep marketing bundles unchanged.
- [ ] Implement createPortalApi({fetcher,getToken}) with explicit action methods; never put bearer credentials in query strings. Distinguish session expiry (return to sign-in) from denial (clear resource and show unavailable) and network errors (retry without exposing stale privileged data).
- [ ] Use sessionStorage for Supabase session persistence. Implement invitation/password setup, login, password reset/change, sign out and token-fragment cleanup. Redirect targets are fixed same-origin portal paths; do not accept arbitrary next URLs.
- [ ] Implement overview, versioned app/pipeline downloads, authorized project search/detail and account pages. Render server text through textContent or safe DOM constructors, never concatenated HTML. Display compatibility and platform instructions; do not claim the portal knows the desktop's installed version.
- [ ] Add static noindex shells and scoped /portal/* rewrites. Set no-store/no-referrer/nosniff and a CSP allowing only bundled code and the fixed Supabase service origins. Do not add chat/analytics to account pages.
- [ ] Add PWA tests that /portal/, /admin/, /api/portal, auth callback URLs and signed downloads are never intercepted or cached.
- [ ] Test reset/invitation errors, reload/session restoration, invalid route IDs, no accessible projects, narrow layouts, keyboard focus and an interrupted download-signing request. Verify 360 px and desktop in the supported browser tool; save screenshots.
- [ ] Run npm run build:portal, client/PWA tests, npm test and npm run check:public.
- [ ] Commit: git commit -m "Build member portal and account experience"

## Task 4: Administration APIs, invitations and owner safeguards

**Files:** members.mjs; catalog.mjs; admin-api.mjs; functions/portal-admin.mjs; scripts/bootstrap-portal-owner.mjs; tests/netlify/portal-admin.test.mjs.

**Consumes:** verified Auth context, Task 1 atomic routines and shared HTTP validation. **Produces:** createAdminHandler({config,backend,clock}) returning the same request-handler contract; authenticated administrative actions.

- [ ] Start with tests proving a T3 member and an admin with aal1 cannot call any admin action. An admin with aal2 still cannot grant admin/owner roles or edit privileged accounts.
- [ ] Run: node --test tests/netlify/portal-admin.test.mjs.
- [ ] Implement GET actions overview, members, releases, projects, project, activity and settings. Implement POST actions invite, resendInvitation, updateMember, setAssignments, saveRelease, saveProject, publish, archive and updateAdminRole.
- [ ] Validate every action against an allowlisted payload. updateMember uses {userId,tier,status,expiresAt,expectedRevision}; setAssignments uses {projectId,userIds,expiresAt,expectedRevision}. IDs are validated and the server derives actor identity from the verified token.
- [ ] Use atomic DB changes and role checks for all mutations. Owner-only role edits preserve the final active owner. General admins may update members only. Return 409 on stale revision and ask the UI to reload current values.
- [ ] For invites, persist an idempotency intent before contacting Auth. Bind only the provider-returned user ID. On an ambiguous provider response, reconcile the intended email/identity before retry; never blindly resend. Failed binding leaves no active membership. Resend is an explicit rate-limited action.
- [ ] Set invitation quotas of 10/hour per administrator and one resend per recipient per 10 minutes; count failed attempts toward abuse limits. Use server database time, not per-function memory.
- [ ] Bootstrap accepts an explicit verified Auth user UUID through a local trusted script; it checks that no owner already exists before a transactional insert. No public bootstrap endpoint and no bootstrap from arbitrary matching email.
- [ ] Validate project category/minimum-tier combinations and publication state. Private assignments remain an intersection with tier. Reject selected-users publication with an empty audience and require an explicit audience change before publication.
- [ ] Test ambiguous invitation success/reconciliation, duplicate idempotency keys, self-escalation, owner removal races, stale edits, deleted recipients, assignment expiry and archived content. Audit state changes in the same transaction.
- [ ] Run admin/API/database tests and npm test.
- [ ] Commit: git commit -m "Add administrator APIs and controlled invitations"

## Task 5: Upload sessions, verification and publication

**Files:** uploads.mjs; functions/portal-verify.mjs; functions/portal-cleanup.mjs; frontend upload.mjs/hash-worker.mjs; tests/portal-uploads.test.mjs; tests/netlify/portal-upload-api.test.mjs.

**Consumes:** admin authority, artifact/upload-session tables, private Storage. **Produces:** beginUpload(actor,input), completeUpload(actor,sessionId), verifyUpload(jobId) and cleanup(now).

beginUpload input: parent kind/ID, filename, bytes, expected SHA-256 and MIME type. Output: upload session ID, immutable generated destination and scoped signed-upload token. It never accepts an arbitrary bucket or path.

- [ ] Write a failing test against completeUpload showing that an administrator revoked after beginUpload cannot finalize. Add a verified-byte mismatch test that can never transition an artifact to verified.
- [ ] Run: node --test tests/portal-uploads.test.mjs tests/netlify/portal-upload-api.test.mjs.
- [ ] Implement the state transitions uploading -> verifying -> verified or failed. Persist a unique job claim and revision. Duplicate completion/verification requests return the existing result rather than duplicating publication.
- [ ] Add authenticated admin POST actions beginUpload, completeUpload and retryVerification to the dispatcher. Map them to the functions above after the same current-role and MFA checks as other administration actions; retries may only address existing failed jobs owned by the authorized portal workflow.
- [ ] Generate paths from trusted parent/version/artifact UUIDs. Disable upsert and prevent reuse of published destinations. Restrict cover uploads to JPEG/PNG/WebP and release/package extensions to the appropriate parent type. Do not accept SVG/HTML as previews.
- [ ] Validate requested size against separately configured release/project limits before allocating a token. Start release limit at 1,000,000,000 bytes; project uploads remain disabled until a project maximum is selected and verified. Limit concurrent uploads to three per administrator.
- [ ] Compute source SHA-256 incrementally in a worker; upload via TUS directly to the project's storage host. Show hash/upload/verification phases, retry and cancellation, using scoped tokens rather than service credentials. Resuming may require a new authorized session if the prior token has expired.
- [ ] Verify completion against actual Storage metadata. Dispatch only an authorized stored job ID to the background function with a server-only verification secret. The worker independently claims the stored job; reject caller-supplied URLs/paths.
- [ ] Stream the object through Node createHash('sha256'), count bytes and abort before the platform time limit. Do not Buffer.concat a whole artifact. Use at most three attempts, and leave failed/timed-out jobs unpublished with a retry control.
- [ ] Before publish, atomically require verified state, matching immutable object identity, complete metadata and still-valid administrator privileges. Overwrite is disabled throughout, preventing verification/publish races.
- [ ] Add cleanup for expired upload sessions and audit retention: administrative events 365 days, link issuance 90 days. Remove only abandoned, unpublished objects referenced by expired sessions; never remove published artifacts or unrelated buckets.
- [ ] Test mid-stream failure, wrong size/hash, duplicate completion, revoked admin, expired session, path traversal, retry exhaustion, concurrent verification and attempted overwrite. Use bounded generated streams rather than storing giant fixture files.
- [ ] Run upload tests, all API tests, npm test and public scanning.
- [ ] Commit: git commit -m "Add resumable private uploads and verified publication"

## Task 6: Admin interface and project publishing workflow

**Files:** admin.mjs; shared router/ui/auth modules; admin/index.html; portal.css; tests/portal-admin-client.test.mjs.

**Consumes:** Task 4/5 APIs and shared session handling. **Produces:** all six admin routes in the spec.

- [ ] Write failing tests for rendering a stale-revision conflict without overwriting the updated user, and for clearing admin data on lost MFA/role.
- [ ] Run: node --test tests/portal-admin-client.test.mjs.
- [ ] Implement owner/admin MFA enrollment/challenge before fetching any admin data. Show a challenge path rather than repeatedly logging an aal1 administrator out.
- [ ] Build searchable member management, invitations, tier/status/expiry editing and per-project assignments. Show the selected recipient/project and resulting access before a consequential edit; never show passwords.
- [ ] Build release/project editors with explicit draft, upload, validation and published states. Default new projects to draft/T3. Category restrictions are visible in the form and independently enforced by the API.
- [ ] Audience control has two options: Tier library and Selected users. Selected users are filtered by minimum tier, with clear notices for existing assignments made ineligible by a later downgrade. Do not automatically upgrade users.
- [ ] Integrate upload progress/retry, immutable version history, explicit publish/archive controls and the filtered activity page. Owner settings expose admin assignments but never SMTP/service credentials.
- [ ] Use responsive forms/tables, accessible labels and focus management. Do not add a framework solely for dashboard layout.
- [ ] Browser-test a complete draft/upload/publish/edit/archive workflow against controlled local fixtures. Test 360 px forms, keyboard operation, interrupted sessions and failed saves. Save user/admin screenshots for review.
- [ ] Run build, client/API tests, npm test, public scan and git diff --check.
- [ ] Commit: git commit -m "Build administration and publishing interface"

## Task 7: Production setup, end-to-end verification and handover

**Files:** netlify.toml; .env.example; scripts/quori-server.mjs; directions/d3-quarter/index.html; server/knowledge.txt; docs/portal-operations.md; docs/quadrion-readiness.md; deployment verification scripts kept outside public output.

- [ ] Add loopback-only local routing for the new APIs with separate portal fixtures. Preserve the existing Quori local/live safeguards and keep real invitations disabled in local fixtures.
- [ ] Obtain the email-provider selection through the existing pending question. Configure verified SMTP and exact invitation/reset redirects through approved service settings; never request secrets in chat.
- [ ] Apply the migration only to oxjrkodcmflxejdwsuac. Confirm all RLS/grant checks with actual anonymous/authenticated requests, not just local tests. Create private buckets and verify public reads fail.
- [ ] Set production-only server secrets and project config in Netlify. Confirm the current plan supports background functions before enabling uploads. Choose/test the project maximum using owner-approved sample sizes.
- [ ] Bootstrap the owner against the verified invited identity, complete MFA with the owner, and verify that no member can invoke bootstrap or owner APIs.
- [ ] Use explicitly authorized test addresses for T1/T2/T3. Publish only approved fixture datasets/builds. Verify invitation/password flow, every tier boundary, private assignment removal, account downgrade/revocation and direct file access denial.
- [ ] Download through a valid signed URL and compare the complete file SHA-256. Verify expiration and resumable transfer behavior for the largest approved file. Record results without recording bearer URLs.
- [ ] Add Client login to the main navigation/footer only when the portal is operational. Update privacy/help/Quori knowledge to distinguish local desktop work from deliberate online portal uploads. Keep the English GCC copy and removed bottom CTAs.
- [ ] Validate production no-store/noindex/CSP headers, PWA isolation, mobile navigation and no new portal scripts in the marketing document. Run npm test, npm run build:portal, npm run check:public and git diff --check.
- [ ] Request a whole-change review, fix actionable findings, then publish through the repository's existing Netlify workflow. Attach any created PR to this chat and verify the published production deployment.
- [ ] Write the operator guide with exact invite, tier, private assignment, upload/version, publish/archive, revoke and owner recovery steps. Include real screenshots and tested limits. Document incomplete prerequisites honestly; do not call the rollout complete until the live access matrix passes.
- [ ] Commit: git commit -m "Integrate and document the production client portal"

## Validation and release gates

Automated policy/API/database tests must pass before any live grants. The existing website regression suite remains part of acceptance. UI tests must exercise denial/error paths, not merely happy-path screenshots. Local simulations cannot prove SMTP delivery, real Supabase RLS, production deployment isolation or large-file performance; those receive explicit live checks.

Unresolved external inputs are the SMTP provider, authorized owner/test recipients, release pair and representative project sizes/files. These do not block building the permission model or local interface, but they block claims of a complete production rollout.

Recommended execution is native in this chat with a whole-change review: the tasks share one authorization model and schema, so keeping their implementation together reduces integration risk. Delegated implementation remains an option if the owner prefers it.
