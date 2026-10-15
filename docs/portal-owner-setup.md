# Initial Quadrion portal owner

Target Supabase project: `oxjrkodcmflxejdwsuac` (Quadrion). The requested owner account is `info@synapse-solutions.ai`.

This foundation creates protected membership and audit tables. It does not deploy login, administration pages, file buckets or a download API. The website portal remains unavailable until those components and MFA enforcement are implemented and verified.

## Setup record — 15 October 2026

- Applied the membership/audit migration manually through the Quadrion Supabase SQL editor.
- Hosted permission query confirmed both tables have RLS enabled and forced, no anonymous/authenticated table access, and no direct service-role write grants.
- All 78 website tests pass, including 11 owner/security database tests; the public artifact scan and whitespace checks pass.
- The account holder completed Auth account creation and explicitly confirmed the exact owner grant. The trusted bootstrap was executed for Auth UUID `b4535988-5b9d-40f1-a55a-ddc58a377fb8` after verifying its confirmed email, non-anonymous identity and absence of a ban/deletion.
- A separate hosted read-only query verified `info@synapse-solutions.ai`, portal role `owner`, status `active`, no expiry, confirmed email, exactly one owner and exactly one `owner_bootstrapped` audit event. The built-in Auth role remains `authenticated`.
- Independent code review found no actionable issues and reran all 11 owner tests successfully. No password or service key was saved in project files. MFA enrollment and portal login are not yet implemented or tested.

## Setup

1. Create the Auth account through the trusted Supabase dashboard. The account holder enters and submits their password directly; do not put a password in SQL, command arguments, documentation or source control.
2. Apply `supabase/migrations/202610150001_portal_members.sql` once in the Quadrion project. For dashboard SQL execution, record that it was applied manually before future CLI migrations; do not replay it or use `IF NOT EXISTS` to hide an unknown schema.
3. Obtain the Auth user UUID from the dashboard. Verify the expected email, confirmed state, and that the identity is neither banned, deleted nor anonymous. Do not use user-editable metadata to grant authority.
4. Generate the exact grant operation with `node scripts/bootstrap-portal-owner.mjs <auth-user-uuid> info@synapse-solutions.ai`. Review the UUID and target project. Run the generated SQL only through a trusted database administrator session. Browser UI actions that expand access require the browser tool's action-time confirmation.
5. Verify one `owner`, `active`, no-tier, non-expiring membership and one `owner_bootstrapped` audit event. The Auth account's built-in role stays `authenticated`; do not change it to a database superuser or service role.

The SQL binds both the Auth UUID and expected confirmed email. It serializes bootstrap operations, writes membership and audit together, retries the same active owner safely, and refuses to replace an existing member, revive a revoked owner, create a second initial owner or repeat bootstrap after a previous owner was removed.

Anonymous and authenticated clients have no direct read or write grants. RLS is enabled and forced without client policies. Even the service role has only read grants on these tables; future writes must use separately tested atomic operations. No permanent bootstrap function or public endpoint is installed.

Administration is separate from T1–T3. Members require tier 1–3; owner/admin records have a null tier. Future admin API access must also require a verified current identity, active membership and MFA. This setup does not itself enroll MFA or make an administrative session available.

## Verification

Run `node --test tests/portal-owner.test.mjs`, `npm test`, `npm run check:public` and `git diff --check`.

The database tests execute the actual migration and generated SQL in PGlite. They verify identity binding, retry behavior, rejection cases, atomic rollback, role/tier constraints, browser denial and RLS even with accidental grants. Hosted Supabase permissions must also be inspected after applying the migration. Local tests do not prove production login or a deployed administration UI.
