# Quadrion portal operations

## Release status — 15 October 2026

The login, member portal, administration UI, MFA gates, T1–T3 policy, private assignments, resumable upload workflow and Owner-created accounts are implemented on `codex/client-portal`. Supabase migrations 001–006 and both private buckets are live. The hosted audit confirms one active Owner, ten tables with RLS enabled and forced, and no anonymous/authenticated table or portal RPC grants. The application is not yet connected or deployed to production; the remaining setup and acceptance checks below are required.

Local validation: 121 automated tests pass, portal build and public-artifact scan pass, and three real PostgreSQL multi-connection account-grant scenarios pass. Desktop and 360px browser checks cover member pages, the Create user form, project/release workflows and overlapping AIO/cover uploads. Local fixtures send no emails and create no real accounts.

## Create the first testers without email

1. Sign in at `/admin/` with your Owner account and complete MFA.
2. Open **Users → Create user**.
3. Enter the user's email address and a password of 12–128 characters. Use **Show password** to check it and retain your copy before submitting; the dashboard cannot retrieve it later.
4. Select T1, T2 or T3 and, optionally, an access expiry date.
5. Select **Create active user**. A successful result means the member is immediately active. No invitation or email-confirmation message is sent. Give the user their email, password and `/portal/` link yourself.

Only an Owner can use this flow. It creates customer members, never another administrator. Existing email addresses are rejected without changing their passwords. Passwords go to Supabase Auth through the server; they are excluded from database intents, audit records, response bodies and browser storage. Creating an account does not force a password change on first sign-in. Members can change their own password from Account.

If the response is uncertain, use **Recent manual accounts → Check account**. Do not repeatedly submit another password: recovery checks the original identity marker and finishes the same membership. **Cancel unresolved creation** becomes available after ten minutes only when no matching Auth identity exists. An existing unresolved Auth identity needs operator investigation; it must not be bound to a different request.

The separate **Invite user** option remains available when email onboarding is wanted. Uncertain invitations also have a recovery check; resend is an explicit action, not automatic.

## Tiers, roles and private projects

| Access | Available content |
| --- | --- |
| T1 | Published Player/application and processing pipeline releases |
| T2 | T1 plus published basic AIO projects |
| T3 | T2 plus published restricted and oil/gas projects |

An active membership and any account expiry are checked on every request. A **Tier library** project is visible to eligible tiers. A **Selected users** project requires both the correct tier and a current private assignment. Assigning a T2 user to a T3 project never upgrades them.

Use **Users → Manage** for tier, status and expiry. Use the project editor's audience/assignment controls for private access. Suspend or revoke a user to stop new access immediately. Previously issued file links expire within five minutes; downloaded files cannot be recalled.

Administration is separate from tier. T3 does not grant dashboard access. Only Owners manage privileged roles; the final active Owner cannot be removed. Admin and Owner sessions require MFA. Members may enroll MFA in Account, after which it is enforced for their sessions too.

## Publish software and datasets

1. Create a release under **Releases**, or a project and version under **Projects**. New content starts as a draft. Choose its category, tier and audience deliberately.
2. Upload the installer/pipeline package or `.aio` file. AIO project files are limited to **100,000,000,000 bytes (100 GB decimal)**; software files to 1,000,000,000 bytes; JPG/PNG/WebP covers to 10,000,000 bytes.
3. Keep the tab open while the browser hashes and uploads. Hashing uses a worker and upload uses resumable chunks directly to private Storage. The server then verifies the entire object independently before publication.
4. If interrupted, reopen the draft, select **Resume** and choose the same original file. The filename, size and hash must match. Retry verification when offered. Abandon an incomplete upload before replacing it; replacements receive a new immutable object path.
5. Publish only after every required file is verified. Selected-users projects need an eligible assignment. Published binary paths cannot be overwritten; create another version for an update. Archive projects or retire releases to remove availability.

The 100 GB limit is implemented, but a real 100 GB upload/resume/verification/download has not yet been tested. Do not promise full-size throughput from local simulations. Large uploads and downloads consume storage and transfer quota. Processing pipelines run on the customer's desktop, not on Supabase compute.

## Production connection

Use only Supabase project `oxjrkodcmflxejdwsuac` and Netlify site `quadrionai`. Migrations 001–006 were applied manually on 15 October 2026. After the user's explicit rollout approval, 002–006 were applied together in one transaction, preserving the existing Owner. Do not replay these migrations or bootstrap the Owner again; reconcile their manual application before adopting CLI migration history. Keep RLS enabled/forced and browser roles without direct table/RPC access.

The live private buckets are `quadrion-software` (1,000,000,000-byte file limit) and `quadrion-projects` (100,000,000,000-byte file limit). The account holder disabled the organization's spend cap, accepting usage charges beyond included quotas. This was verified in Billing before setting the global file limit to **100,000,000,000 bytes**. Supabase displays that saved limit as 93.13225746154785 GB using binary conversion. Do not add public/client Storage policies; authorized upload tokens and short-lived download links are issued by the server.

The approved Auth Site URL `https://quadrion.ai/portal/` and sole allowed redirect `https://quadrion.ai/portal/account/` are saved and verified after reload. Keep public signup and anonymous login disabled. Leave email confirmation enabled generally: the Owner create-user API confirms only the account the Owner deliberately creates. The TOTP authenticator provider is enabled; Owner enrollment remains pending. Resend custom SMTP is saved; production invitation/reset delivery still needs a live test.

Set these variables only for Netlify **Production / Functions**. Never give production secrets to deploy previews or the public build:

| Variable | Value |
| --- | --- |
| `PORTAL_ALLOWED_ORIGIN` | `https://quadrion.ai` |
| `SUPABASE_URL` | `https://oxjrkodcmflxejdwsuac.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Quadrion's publishable key |
| `SUPABASE_SECRET_KEY` | Quadrion's server-only key |
| `PORTAL_VERIFY_SECRET` | Random server-only secret, at least 32 characters |
| `PORTAL_PROJECT_MAX_BYTES` | `100000000000` |
| `PORTAL_ENABLED` | `true` only after configuration is ready |

Keep `PORTAL_LOCAL_DEV` unset/false in production. The Synapse-Solutions Netlify team is on the credit-based Pro plan, verified in its billing UI on 15 October 2026; the existing plan supports Background Functions. The account holder saved `SUPABASE_SECRET_KEY` as a secret scoped to Production / Functions. The origin, Supabase URL, publishable key and 100 GB limit are also saved for Production / Functions. `PORTAL_ENABLED` is saved as `false` until activation, and the verifier credential remains a prepared account-holder handoff. The verification worker checkpoints bounded ranges and resumes across executions; it is not a single 100 GB in-memory request. Disabling `PORTAL_ENABLED` and redeploying closes portal access without deleting data.

## Live acceptance and recovery

Before adding the marketing login link, verify the actual deployed login and Owner MFA, manual member creation without email, password reset, tier boundaries, private-assignment removal, downgrade/revocation, direct Storage denial and a complete file download with matching SHA-256. Use only approved test recipients/files. Check no-store/noindex/CSP headers and that the PWA never caches portal, admin or API responses. Run a representative large-file interruption/resume test separately; record its exact size and outcome.

The Activity page records access-management and publication changes. Audit events retain 365 days; download events retain 90 days. Scheduled cleanup cancels and removes only eligible abandoned unpublished uploads after seven days. Do not delete a Storage object directly to repair an incomplete upload.

If an Owner loses MFA, another active Owner or the verified Supabase account holder must handle recovery through the trusted Auth dashboard after verifying the identity. Never disable the application's MFA gate or promote a user by matching email alone. Record any trusted recovery action and re-enroll MFA before administration resumes.

Developer verification: `npm test`, `npm run build:portal`, `npm run check:public`, `git diff --check`. For account-grant concurrency, set `PORTAL_TEST_PG_URL` to a local PostgreSQL maintenance database and run `node scripts/test-portal-concurrency.mjs`; it creates and drops its own uniquely named test database. It refuses non-local database hosts.
