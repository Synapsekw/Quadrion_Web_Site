import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const ids={owner:'10000000-0000-4000-8000-000000000001',admin:'10000000-0000-4000-8000-000000000002',t1:'10000000-0000-4000-8000-000000000003',t2:'10000000-0000-4000-8000-000000000004',t3:'10000000-0000-4000-8000-000000000005'};
export async function portalDb() {
  const db=new PGlite();
  try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false,created_at timestamptz default now(),raw_app_meta_data jsonb default '{}');
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  for(const file of ['202610150001_portal_members.sql','202610150002_portal_catalog.sql','202610150003_portal_member_api.sql','202610150004_portal_admin_api.sql','202610150005_portal_uploads.sql','202610150006_portal_manual_users.sql','202610150007_portal_password_login.sql']) {
    await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  }
  for(const [name,id] of Object.entries(ids)) {
    const role=['owner','admin'].includes(name)?name:'member';
    await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())',[id,name+'@example.com']);
    await db.query("insert into public.portal_members(user_id,role,tier,status) values ($1,$2,$3,'active')",[id,role,role==='member'?Number(name[1]):null]);
  }
  return db;
  } catch(error) { await db.close(); throw error; }
}
export const rpc=async(db,name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
