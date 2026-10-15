begin;
-- Owner-created accounts use Auth passwords only. This intent table never stores credentials.
create table public.portal_user_creations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  email text not null check(length(email) between 3 and 254 and email=lower(trim(email))),
  tier smallint not null check(tier in (1,2,3)),
  expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  user_id uuid references auth.users(id),
  status text not null default 'creating' check(status in ('creating','created','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index portal_creation_pending_email on public.portal_user_creations(email) where status='creating';
alter table public.portal_user_creations enable row level security;
alter table public.portal_user_creations force row level security;
revoke all on public.portal_user_creations from public,anon,authenticated,service_role;

create function public.portal_create_user_begin(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; result public.portal_user_creations; mail text:=lower(trim(p_data->>'email'));
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or p_data-'email'-'tier'-'expiresAt'-'idempotencyKey'<>'{}'::jsonb
    or mail is null or length(mail)>254 or mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or coalesce((p_data->>'tier')::smallint,0) not in (1,2,3) or p_data->>'idempotencyKey' is null
    or (p_data->>'expiresAt')::timestamptz<=now() then raise exception 'portal:invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-create:'||p_actor::text,0));
  perform pg_advisory_xact_lock(hashtextextended('portal-email:'||mail,0));
  select * into result from public.portal_user_creations where idempotency_key=(p_data->>'idempotencyKey')::uuid;
  if result.id is not null then
    if result.created_by<>p_actor or result.email<>mail or result.tier is distinct from (p_data->>'tier')::smallint or result.expires_at is distinct from (p_data->>'expiresAt')::timestamptz then raise exception 'portal:conflict'; end if;
    return to_jsonb(result)||jsonb_build_object('dispatch',false);
  end if;
  if exists(select 1 from public.portal_user_creations where email=mail and status='creating') then raise exception 'portal:creation_pending'; end if;
  if exists(select 1 from auth.users where lower(email)=mail and deleted_at is null) then raise exception 'portal:account_exists'; end if;
  if exists(select 1 from public.portal_invitations where email=mail and status='dispatching') then raise exception 'portal:creation_pending'; end if;
  if (select count(*) from public.portal_user_creations where created_by=p_actor and created_at>now()-interval '1 hour')>=10 then raise exception 'portal:rate_limited'; end if;
  insert into public.portal_user_creations(email,tier,expires_at,created_by,idempotency_key)
    values(mail,(p_data->>'tier')::smallint,(p_data->>'expiresAt')::timestamptz,p_actor,(p_data->>'idempotencyKey')::uuid) returning * into result;
  insert into public.portal_events(actor_id,resource_id,action,details) values(p_actor,result.id,'manual_user_creation_started',jsonb_build_object('email',mail,'tier',result.tier));
  return to_jsonb(result)||jsonb_build_object('dispatch',true);
end; $$;

create function public.portal_create_user_resolve(p_actor uuid,p_aal text,p_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; intent public.portal_user_creations; target auth.users;
begin
  -- Serialize membership writers before authorization takes its shared lock.
  lock table public.portal_members in share row exclusive mode;
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  if p_action is null or p_action not in ('reconcile','failed','cancel') then raise exception 'portal:invalid'; end if;
  select * into intent from public.portal_user_creations where id=p_id for update;
  if intent.id is null then raise exception 'portal:not_found'; end if;
  if intent.status<>'creating' then return to_jsonb(intent); end if;
  -- App metadata is written only by the trusted Auth administrator, never by the new user.
  select * into target from auth.users where lower(email)=intent.email and deleted_at is null and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())
    and raw_app_meta_data->>'quadrion_creation_id'=intent.id::text;
  if target.id is not null then
    if intent.expires_at<=now() then raise exception 'portal:forbidden'; end if;
    if exists(select 1 from public.portal_members where user_id=target.id) then raise exception 'portal:conflict'; end if;
    insert into public.portal_members(user_id,role,tier,status,expires_at,invited_by) values(target.id,'member',intent.tier,'active',intent.expires_at,intent.created_by);
    update public.portal_user_creations set user_id=target.id,status='created',updated_at=now() where id=p_id returning * into intent;
    insert into public.portal_events(actor_id,subject_id,resource_id,action,details) values(p_actor,target.id,p_id,'user_created_manually',jsonb_build_object('tier',intent.tier));
  elsif p_action in ('failed','cancel') then
    -- 'failed' is reserved for an explicit Auth rejection, never a caller-supplied result.
    if p_action='cancel' and (intent.created_at>now()-interval '10 minutes' or exists(select 1 from auth.users where lower(email)=intent.email and deleted_at is null)) then raise exception 'portal:conflict'; end if;
    update public.portal_user_creations set status=case when p_action='failed' then 'failed' else 'cancelled' end,updated_at=now() where id=p_id returning * into intent;
    insert into public.portal_events(actor_id,resource_id,action) values(p_actor,p_id,'manual_user_creation_'||intent.status);
  end if;
  return to_jsonb(intent);
end; $$;

create function public.portal_user_creation_list(p_actor uuid,p_aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; result jsonb;
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,email,tier,status,user_id,expires_at,created_at from public.portal_user_creations order by (status='creating') desc,created_at desc,id limit 50) t;
  return jsonb_build_object('items',result);
end; $$;
revoke all on function public.portal_create_user_begin(uuid,text,jsonb),public.portal_create_user_resolve(uuid,text,uuid,text),public.portal_user_creation_list(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.portal_create_user_begin(uuid,text,jsonb),public.portal_create_user_resolve(uuid,text,uuid,text),public.portal_user_creation_list(uuid,text) to service_role;
commit;
