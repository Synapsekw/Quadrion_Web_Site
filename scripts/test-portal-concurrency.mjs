// Uses a disposable database on a local PostgreSQL server, never Supabase.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {ids,rpc} from '../tests/helpers/portal-db.mjs';

const connectionString=process.env.PORTAL_TEST_PG_URL;
if(!connectionString)throw new Error('Set PORTAL_TEST_PG_URL to a local PostgreSQL maintenance database.');
const url=new URL(connectionString);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Concurrency tests require a local PostgreSQL server.');
const database='quadrion_portal_test_'+randomUUID().replaceAll('-','');
const maintenance=new pg.Client({connectionString});
const clients=[];
let created=false;
async function client(name){
  const settings=new URL(url);settings.pathname='/'+database;
  const c=new pg.Client({connectionString:settings.href,application_name:name});
  await c.connect();clients.push(c);
  await c.query("set statement_timeout='10s'; set deadlock_timeout='100ms'");
  return c;
}
try{
  await maintenance.connect();
  await maintenance.query(`create database ${database}`);created=true;
  const db=await client('portal-concurrency-setup');
  await db.query(`do $$begin
    if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end$$;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false,created_at timestamptz default now(),raw_app_meta_data jsonb default '{}');
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  const migrations=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(migrations)).filter(n=>/^20261015.*\.sql$/.test(n)).sort())await db.query(await readFile(new URL(name,migrations),'utf8'));
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ids.owner,'owner@example.invalid']);
  await db.query("insert into public.portal_members(user_id,role,status) values($1,'owner','active')",[ids.owner]);
  const blocker=await client('portal-concurrency-blocker');
  const workers=await Promise.all([client('portal-concurrency-worker'),client('portal-concurrency-worker')]);
  let passed=0;
  for(const other of ['manual','invite','recover']){
    const calls=[];
    const intents=[];
    for(const kind of ['manual',other]){
      const email=randomUUID()+'@example.invalid';
      const data={email,tier:2,expiresAt:null,idempotencyKey:randomUUID()};
      const manual=kind==='manual';
      const intent=await rpc(db,manual?'portal_create_user_begin':'portal_invite_begin',[ids.owner,'aal2',manual?data:{...data,role:'member'}]);
      const userId=randomUUID();
      await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)',[userId,email,manual?{quadrion_creation_id:intent.id}:{}]);
      intents.push({id:intent.id,table:manual?'portal_user_creations':'portal_invitations',userId});
      calls.push(manual?['portal_create_user_resolve',[ids.owner,'aal2',intent.id,'reconcile']]:kind==='invite'?['portal_invite_resolve',[ids.owner,'aal2',intent.id,userId]]:['portal_invite_recover',[ids.owner,'aal2',intent.id,'reconcile']]);
    }
    await blocker.query('begin');
    for(const intent of intents)await blocker.query(`select id from public.${intent.table} where id=$1 for update`,[intent.id]);
    // Both requests reach a database lock before either may grant membership.
    const pending=Promise.allSettled(calls.map(([name,args],i)=>rpc(workers[i],name,args)));
    try{
      const deadline=Date.now()+5000;
      while(true){
        const {rows}=await db.query("select count(*)::int n from pg_stat_activity where datname=$1 and application_name='portal-concurrency-worker' and state='active' and wait_event_type='Lock'",[database]);
        if(rows[0].n===2)break;
        if(Date.now()>deadline)throw new Error('Both account grants did not reach the lock barrier.');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }finally{await blocker.query('rollback');}
    const results=await pending;
    for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.message);
    assert.equal(results[0].value.status,'created');
    assert.equal(results[1].value.status,other==='manual'?'created':'sent');
    assert.equal((await db.query('select count(*)::int n from public.portal_members where user_id=any($1::uuid[])',[intents.map(i=>i.userId)])).rows[0].n,2);
    passed++;console.log(`PASS simultaneous manual + ${other} account grants`);
  }
  console.log(`${passed}/3 PostgreSQL concurrency scenarios passed.`);
}finally{
  await Promise.allSettled(clients.map(c=>c.end()));
  if(created)await maintenance.query(`drop database ${database}`);
  await maintenance.end();
}
