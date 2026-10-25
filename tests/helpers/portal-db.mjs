import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
export const ids={owner:'10000000-0000-4000-8000-000000000001',admin:'10000000-0000-4000-8000-000000000002',t1:'10000000-0000-4000-8000-000000000003',t2:'10000000-0000-4000-8000-000000000004',t3:'10000000-0000-4000-8000-000000000005',testerA:'10000000-0000-4000-8000-000000000006',testerB:'10000000-0000-4000-8000-000000000007'};
const testerIds=['testerA','testerB'];
const migrations=new URL('../../supabase/migrations/',import.meta.url);
export async function portalDb({testers=false}={}) {
  const db=new PGlite();
  try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false,created_at timestamptz default now(),raw_app_meta_data jsonb default '{}');
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  for(const file of (await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort()) {
    const sql=await readFile(new URL(file,migrations),'utf8');
    // Storage buckets exist only in Supabase; their migrations are applied by hand there.
    if(!sql.includes('storage.buckets'))await db.exec(sql);
  }
  for(const [name,id] of Object.entries(ids)) {
    if(testerIds.includes(name)&&!testers)continue;
    const role=['owner','admin'].includes(name)?name:'member',tier=testerIds.includes(name)?1:role==='member'?Number(name[1]):null;
    await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())',[id,name+'@example.com']);
    await db.query("insert into public.portal_members(user_id,role,tier,status,tester) values ($1,$2,$3,'active',$4)",[id,role,tier,testerIds.includes(name)]);
  }
  return db;
  } catch(error) { await db.close(); throw error; }
}
export const rpc=async(db,name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
