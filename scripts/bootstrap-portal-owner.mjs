import { pathToFileURL } from 'node:url';

/** Generate an auditable, one-time SQL operation for a trusted database session.
 * This does not connect to Supabase, create passwords or expose an HTTP/RPC route.
 */
export function buildOwnerBootstrapSql({ userId, expectedEmail }) {
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Provide the verified Supabase Auth user UUID.');
  }
  if (typeof expectedEmail !== 'string' || expectedEmail.length > 254
      || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(expectedEmail)
      || expectedEmail.includes('$portal_owner$') || expectedEmail.includes('\\')) {
    throw new Error('Provide the exact expected account email.');
  }
  const emailLiteral = expectedEmail.replaceAll("'", "''");
  return `-- Review the UUID and expected email before running as postgres in the Quadrion project.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
set local standard_conforming_strings = on;
lock table public.portal_members in share row exclusive mode;

do $portal_owner$
declare
  target_id constant uuid := '${userId}'::uuid;
  expected_email constant text := '${emailLiteral}';
begin
  -- Both immutable Auth ID and confirmed email must match. Lock against deletion.
  perform 1 from auth.users
    where id = target_id and lower(email) = lower(expected_email)
      and email_confirmed_at is not null and deleted_at is null
      and not coalesce(is_anonymous, false)
      and (banned_until is null or banned_until <= now())
    for share;
  if not found then
    raise exception 'No eligible verified identity matches the supplied UUID and email';
  end if;

  if exists (select 1 from public.portal_members where role = 'owner') then
    if exists (select 1 from public.portal_members
      where user_id = target_id and role = 'owner' and status = 'active' and expires_at is null)
      and not exists (select 1 from public.portal_members where role = 'owner' and user_id <> target_id) then
      return;
    end if;
    raise exception 'An owner already exists; use the controlled owner management or recovery process';
  end if;
  if exists (select 1 from public.portal_events where action = 'owner_bootstrapped') then
    raise exception 'An owner was previously bootstrapped; use trusted recovery';
  end if;
  if exists (select 1 from public.portal_members where user_id = target_id) then
    raise exception 'A membership already exists; bootstrap will not replace it';
  end if;

  insert into public.portal_members (user_id, role, tier, status)
    values (target_id, 'owner', null, 'active');
  insert into public.portal_events (actor_id, subject_id, action, details)
    values (null, target_id, 'owner_bootstrapped',
      '{"source":"trusted_setup","role":"owner","status":"active"}'::jsonb);
end
$portal_owner$;
commit;

select user_id, role, status, tier, expires_at from public.portal_members
  where user_id = '${userId}'::uuid;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/bootstrap-portal-owner.mjs <auth-user-uuid> <expected-email>');
    process.stdout.write(buildOwnerBootstrapSql({ userId: process.argv[2], expectedEmail: process.argv[3] }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
