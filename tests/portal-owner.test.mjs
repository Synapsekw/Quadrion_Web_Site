import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { buildOwnerBootstrapSql } from '../scripts/bootstrap-portal-owner.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const email = 'owner@example.com';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz,
      banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false
    );
    grant usage on schema public to anon, authenticated, service_role;
    -- Match Supabase's broad default grants; the migration must remove them.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202610150001_portal_members.sql', import.meta.url), 'utf8'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('reset role; rollback; truncate public.portal_events, public.portal_members, auth.users;');
  await db.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now()),($3,$4,now())',
    [ownerId, email, otherId, 'other@example.com']);
});
const bootstrap = (userId = ownerId, expectedEmail = email) => db.exec(buildOwnerBootstrapSql({ userId, expectedEmail }));
async function rejectedBootstrap(pattern, userId = ownerId, expectedEmail = email) {
  await assert.rejects(bootstrap(userId, expectedEmail), pattern);
  await db.exec('rollback');
}

test('bootstrap binds the verified Auth ID and records one atomic owner audit event', async () => {
  await bootstrap();
  const { rows } = await db.query('select user_id,role,tier,status,expires_at,revision from public.portal_members');
  assert.deepEqual(rows, [{ user_id: ownerId, role: 'owner', tier: null, status: 'active', expires_at: null, revision: 1 }]);
  const events = await db.query('select actor_id,subject_id,action,details from public.portal_events');
  assert.deepEqual(events.rows, [{ actor_id: null, subject_id: ownerId, action: 'owner_bootstrapped',
    details: { source: 'trusted_setup', role: 'owner', status: 'active' } }]);
});

test('bootstrap retry for the same active owner is idempotent', async () => {
  await bootstrap();
  await bootstrap();
  assert.equal((await db.query('select count(*)::int as count from public.portal_members')).rows[0].count, 1);
  assert.equal((await db.query('select count(*)::int as count from public.portal_events')).rows[0].count, 1);
});

test('bootstrap cannot add a second owner or reactivate a revoked owner', async () => {
  await bootstrap();
  await rejectedBootstrap(/owner already exists/i, otherId, 'other@example.com');
  await db.query("update public.portal_members set status='revoked' where user_id=$1", [ownerId]);
  await rejectedBootstrap(/owner already exists/i);
  assert.equal((await db.query('select status from public.portal_members')).rows[0].status, 'revoked');
});

test('bootstrap rejects missing, unconfirmed, mismatched, banned, deleted and anonymous identities', async () => {
  await rejectedBootstrap(/eligible verified identity/i, '33333333-3333-4333-8333-333333333333');
  await rejectedBootstrap(/eligible verified identity/i, ownerId, 'wrong@example.com');
  for (const sql of [
    'email_confirmed_at=null', "banned_until=now()+interval '1 day'", 'deleted_at=now()', 'is_anonymous=true',
  ]) {
    await db.query(`update auth.users set ${sql} where id=$1`, [ownerId]);
    await rejectedBootstrap(/eligible verified identity/i);
    await db.query('update auth.users set email_confirmed_at=now(),banned_until=null,deleted_at=null,is_anonymous=false where id=$1', [ownerId]);
  }
  assert.equal((await db.query('select count(*)::int as count from public.portal_members')).rows[0].count, 0);
});

test('bootstrap never silently replaces an existing member record', async () => {
  await db.query("insert into public.portal_members(user_id,role,tier,status) values ($1,'member',1,'suspended')", [ownerId]);
  await rejectedBootstrap(/membership already exists/i);
  assert.deepEqual((await db.query('select role,tier,status from public.portal_members')).rows,
    [{ role: 'member', tier: 1, status: 'suspended' }]);
});

test('a failed audit insert rolls back the owner grant', async () => {
  await db.exec("alter table public.portal_events add constraint test_reject_event check (action <> 'owner_bootstrapped')");
  try {
    await rejectedBootstrap(/test_reject_event/i);
    assert.equal((await db.query('select count(*)::int as count from public.portal_members')).rows[0].count, 0);
  } finally {
    await db.exec('alter table public.portal_events drop constraint test_reject_event');
  }
});

test('browser roles cannot read private records, grant privileges or modify audit events', async () => {
  await bootstrap();
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const sql of [
        'select * from public.portal_members', 'select * from public.portal_events',
        "update public.portal_members set role='owner'", 'delete from public.portal_events',
        `insert into public.portal_members(user_id,role,tier,status) values ('${otherId}','owner',null,'active')`,
      ]) await assert.rejects(db.exec(sql), /permission denied/i);
      await assert.rejects(bootstrap(), /permission denied/i);
      await db.exec('rollback');
    } finally { await db.exec('reset role'); }
  }
});

test('RLS denies browser reads and writes even if table grants are accidentally restored', async () => {
  await bootstrap();
  await db.exec('grant select,insert,update,delete on public.portal_members,public.portal_events to authenticated; set role authenticated');
  try {
    assert.deepEqual((await db.query('select * from public.portal_members')).rows, []);
    assert.deepEqual((await db.query('select * from public.portal_events')).rows, []);
    await assert.rejects(db.query("insert into public.portal_members(user_id,role,tier,status) values ($1,'owner',null,'active')", [otherId]), /row-level security/i);
    assert.equal((await db.query("update public.portal_members set role='owner' returning user_id")).rows.length, 0);
  } finally {
    await db.exec('reset role; revoke all on public.portal_members,public.portal_events from authenticated');
  }
});

test('service role can read membership but has no direct mutation or bootstrap privilege', async () => {
  await bootstrap();
  await db.exec('set role service_role');
  try {
    assert.equal((await db.query('select role from public.portal_members')).rows[0].role, 'owner');
    await assert.rejects(db.exec("update public.portal_members set status='revoked'"), /permission denied/i);
    await assert.rejects(db.exec('delete from public.portal_events'), /permission denied/i);
    await assert.rejects(bootstrap(), /permission denied/i);
    await db.exec('rollback');
  } finally { await db.exec('reset role'); }
});

test('database constraints separate tiers from administrative roles', async () => {
  for (const [role, tier] of [['member', null], ['member', 0], ['member', 4], ['owner', 3], ['admin', 1], ['superuser', null]]) {
    await assert.rejects(db.query("insert into public.portal_members(user_id,role,tier,status) values ($1,$2,$3,'active')", [ownerId, role, tier]), /check constraint/i);
  }
  await db.query("insert into public.portal_members(user_id,role,tier,status) values ($1,'member',3,'active')", [ownerId]);
  assert.equal((await db.query('select role from public.portal_members')).rows[0].role, 'member');
});

test('SQL generator rejects unsafe identity inputs and escapes legitimate email apostrophes', async () => {
  for (const userId of ['', 'owner@example.com', "'; drop table auth.users; --"]) {
    assert.throws(() => buildOwnerBootstrapSql({ userId, expectedEmail: email }), /UUID/);
  }
  for (const expectedEmail of ['', 'missing-at', 'owner@example.com\nselect 1;']) {
    assert.throws(() => buildOwnerBootstrapSql({ userId: ownerId, expectedEmail }), /email/i);
  }
  await db.query('update auth.users set email=$1 where id=$2', ["o'connor@example.com", ownerId]);
  await bootstrap(ownerId, "o'connor@example.com");
  assert.equal((await db.query('select role from public.portal_members')).rows[0].role, 'owner');
});
