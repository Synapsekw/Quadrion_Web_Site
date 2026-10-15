-- Trusted server API only. Actor and assurance are supplied by the server after
-- validating the bearer token with Auth; browser roles cannot execute these RPCs.
begin;

create table public.portal_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
  role text not null default 'member' check (role in ('member','admin')),
  tier smallint,
  expires_at timestamptz,
  invited_by uuid not null references public.portal_members(user_id),
  user_id uuid references auth.users(id),
  idempotency_key uuid not null unique,
  status text not null default 'pending' check (status in ('pending','dispatching','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_role_tier check ((role='member' and tier between 1 and 3 and tier is not null) or (role='admin' and tier is null))
);
create unique index portal_invitation_pending_email on public.portal_invitations(email) where status in ('pending','dispatching');

create table public.software_releases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('app','pipeline')),
  version text not null check (length(version) between 1 and 80),
  platform text not null default 'windows' check (platform in ('windows','macos','linux','all')),
  minimum_app_version text not null default '' check (length(minimum_app_version)<=80),
  notes text not null default '' check (length(notes)<=16000),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  created_by uuid not null references public.portal_members(user_id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  revision integer not null default 1 check (revision>0),
  unique(kind,version,platform)
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  description text not null default '' check (length(description)<=12000),
  category text not null check (category in ('basic','oil_gas','restricted')),
  minimum_tier smallint not null check (minimum_tier in (2,3)),
  audience text not null default 'tier' check (audience in ('tier','assigned')),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  current_version_id uuid,
  created_by uuid not null references public.portal_members(user_id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  revision integer not null default 1 check (revision>0),
  check (category='basic' or minimum_tier=3)
);
create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  version text not null check (length(version) between 1 and 80),
  minimum_app_version text not null default '' check (length(minimum_app_version)<=80),
  notes text not null default '' check (length(notes)<=16000),
  created_by uuid not null references public.portal_members(user_id),
  created_at timestamptz not null default now(),
  unique(project_id,version), unique(project_id,id)
);
alter table public.projects add constraint current_version_parent foreign key (id,current_version_id) references public.project_versions(project_id,id);
create table public.project_assignments (
  project_id uuid not null references public.projects(id),
  user_id uuid not null references public.portal_members(user_id),
  expires_at timestamptz,
  assigned_by uuid not null references public.portal_members(user_id),
  created_at timestamptz not null default now(),
  primary key(project_id,user_id)
);
create table public.artifact_files (
  id uuid primary key default gen_random_uuid(),
  release_id uuid references public.software_releases(id),
  project_version_id uuid references public.project_versions(id),
  kind text not null check (kind in ('binary','preview')),
  bucket text not null check (bucket in ('quadrion-software','quadrion-projects')),
  object_path text not null check (length(object_path) between 1 and 500 and object_path !~ '(^/|\.\.)'),
  filename text not null check (length(filename) between 1 and 200 and filename !~ '[/\\]'),
  bytes bigint not null check (bytes>0),
  mime_type text not null default 'application/octet-stream',
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending','verifying','verified','failed','abandoned')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  check ((release_id is not null)::integer + (project_version_id is not null)::integer = 1),
  check ((release_id is not null and bucket='quadrion-software' and kind='binary') or (project_version_id is not null and bucket='quadrion-projects')),
  unique(bucket,object_path)
);
create unique index artifact_release_kind on public.artifact_files(release_id,kind) where release_id is not null and state<>'abandoned';
create unique index artifact_project_kind on public.artifact_files(project_version_id,kind) where project_version_id is not null and state<>'abandoned';
create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.portal_members(user_id),
  artifact_id uuid not null unique references public.artifact_files(id),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  state text not null default 'pending' check (state in ('pending','verifying','verified','failed','cancelled')),
  verified_bytes bigint not null default 0 check (verified_bytes>=0),
  hash_state text,
  object_etag text,
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts>=0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portal_events_actor_action_time on public.portal_events(actor_id,action,created_at);
create index project_assignments_user on public.project_assignments(user_id,project_id);

create function public.portal_active(p_actor uuid) returns public.portal_members
language sql stable security definer set search_path='' as $$
  select m from public.portal_members m join auth.users u on u.id=m.user_id
  where m.user_id=p_actor and m.status='active' and (m.expires_at is null or m.expires_at>now())
    and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=now());
$$;
create function public.portal_require_admin(p_actor uuid,p_aal text) returns public.portal_members
language plpgsql security definer set search_path='' as $$
declare m public.portal_members;
begin
  lock table public.portal_members in share mode;
  m:=public.portal_active(p_actor);
  if m.user_id is null or m.role not in ('admin','owner') then raise exception 'portal:forbidden'; end if;
  if p_aal is distinct from 'aal2' then raise exception 'portal:mfa_required'; end if;
  return m;
end; $$;

create function public.portal_member_change(p_actor uuid,p_aal text,p_target uuid,p_revision integer,p_role text,p_tier smallint,p_status text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; old public.portal_members; result public.portal_members;
begin
  -- Serialize all authority changes before checking the actor, including the last owner.
  lock table public.portal_members in share row exclusive mode;
  actor:=public.portal_require_admin(p_actor,p_aal);
  select * into old from public.portal_members where user_id=p_target;
  if old.user_id is null then raise exception 'portal:not_found'; end if;
  if actor.role<>'owner' and (old.role<>'member' or p_role<>'member') then raise exception 'portal:forbidden'; end if;
  if old.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
  if old.role='owner' and old.status='active' and (p_role<>'owner' or p_status<>'active')
    and not exists(select 1 from public.portal_members m where m.user_id<>p_target and m.role='owner' and (public.portal_active(m.user_id)).user_id is not null)
    then raise exception 'portal:last_owner'; end if;
  update public.portal_members set role=p_role,tier=p_tier,status=p_status,expires_at=p_expires_at,updated_at=now(),revision=revision+1
    where user_id=p_target returning * into result;
  insert into public.portal_events(actor_id,subject_id,action,details) values(p_actor,p_target,'member_changed',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(result)));
  return to_jsonb(result);
end; $$;

create function public.portal_save_project(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.projects; target uuid:=(p_data->>'id')::uuid;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if target is null then
    insert into public.projects(title,description,category,minimum_tier,audience,created_by)
    values(trim(p_data->>'title'),coalesce(p_data->>'description',''),p_data->>'category',(p_data->>'minimumTier')::smallint,p_data->>'audience',p_actor) returning * into result;
  else
    select * into result from public.projects where id=target for update;
    if result.id is null then raise exception 'portal:not_found'; end if;
    if result.revision is distinct from (p_data->>'revision')::integer then raise exception 'portal:conflict'; end if;
    -- Editing metadata of a published project returns it to draft for explicit review.
    update public.projects set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),category=p_data->>'category',minimum_tier=(p_data->>'minimumTier')::smallint,
      audience=p_data->>'audience',status='draft',revision=revision+1 where id=target returning * into result;
  end if;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,result.id,'project_saved');
  return to_jsonb(result);
end; $$;
create function public.portal_save_version(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.project_versions;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  insert into public.project_versions(project_id,version,minimum_app_version,notes,created_by)
    values((p_data->>'projectId')::uuid,p_data->>'version',coalesce(p_data->>'minimumAppVersion',''),coalesce(p_data->>'notes',''),p_actor) returning * into result;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,result.id,'version_created');
  return to_jsonb(result);
end; $$;
create function public.portal_save_release(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.software_releases;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  insert into public.software_releases(kind,version,platform,minimum_app_version,notes,created_by)
    values(p_data->>'kind',p_data->>'version',p_data->>'platform',coalesce(p_data->>'minimumAppVersion',''),coalesce(p_data->>'notes',''),p_actor) returning * into result;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,result.id,'release_created');
  return to_jsonb(result);
end; $$;
create function public.portal_set_assignments(p_actor uuid,p_aal text,p_project uuid,p_revision integer,p_assignments jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.projects;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select * into result from public.projects where id=p_project for update;
  if result.id is null then raise exception 'portal:not_found'; end if;
  if result.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments)>1000 then raise exception 'portal:invalid'; end if;
  delete from public.project_assignments where project_id=p_project;
  insert into public.project_assignments(project_id,user_id,expires_at,assigned_by)
    select p_project,(a->>'userId')::uuid,(a->>'expiresAt')::timestamptz,p_actor from jsonb_array_elements(p_assignments) a;
  update public.projects set revision=revision+1 where id=p_project returning * into result;
  insert into public.portal_events(actor_id,resource_id,action,details) values(p_actor,p_project,'assignments_changed',jsonb_build_object('assignments',p_assignments));
  return to_jsonb(result);
end; $$;
create function public.portal_publish(p_actor uuid,p_aal text,p_kind text,p_id uuid,p_revision integer,p_version uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project public.projects; release public.software_releases; result jsonb;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if p_kind='project' then
    select * into project from public.projects where id=p_id for update;
    if project.id is null then raise exception 'portal:not_found'; end if;
    if project.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
    if not exists(select 1 from public.project_versions v join public.artifact_files f on f.project_version_id=v.id where v.id=p_version and v.project_id=p_id and f.kind='binary' and f.state='verified') then raise exception 'portal:unverified'; end if;
    if project.audience='assigned' and not exists(select 1 from public.project_assignments a join public.portal_members m on m.user_id=a.user_id where a.project_id=p_id and (a.expires_at is null or a.expires_at>now()) and (public.portal_active(m.user_id)).user_id is not null and (m.role in ('owner','admin') or m.tier>=project.minimum_tier)) then raise exception 'portal:empty_audience'; end if;
    update public.projects set current_version_id=p_version,status='published',published_at=now(),revision=revision+1 where id=p_id returning to_jsonb(projects.*) into result;
  elsif p_kind='release' then
    select * into release from public.software_releases where id=p_id for update;
    if release.id is null then raise exception 'portal:not_found'; end if;
    if release.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
    if not exists(select 1 from public.artifact_files where release_id=p_id and kind='binary' and state='verified') then raise exception 'portal:unverified'; end if;
    update public.software_releases set status='published',published_at=now(),revision=revision+1 where id=p_id returning to_jsonb(software_releases.*) into result;
  else raise exception 'portal:invalid'; end if;
  insert into public.portal_events(actor_id,resource_id,action,details) values(p_actor,p_id,'published',jsonb_build_object('kind',p_kind,'versionId',p_version));
  return result;
end; $$;
create function public.portal_archive(p_actor uuid,p_aal text,p_kind text,p_id uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if p_kind='project' then update public.projects set status='archived',revision=revision+1 where id=p_id and revision=p_revision returning to_jsonb(projects.*) into result;
  elsif p_kind='release' then update public.software_releases set status='retired',revision=revision+1 where id=p_id and revision=p_revision returning to_jsonb(software_releases.*) into result;
  else raise exception 'portal:invalid'; end if;
  if result is null then raise exception 'portal:conflict'; end if;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,p_id,'archived');
  return result;
end; $$;

create function public.portal_project_visible(p_actor uuid,p_project uuid,p_aal text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects p cross join public.portal_active(p_actor) m
    where p.id=p_project and p.status='published' and p.current_version_id is not null and m.user_id is not null
    and exists(select 1 from public.artifact_files f where f.project_version_id=p.current_version_id and f.kind='binary' and f.state='verified')
    and ((m.role in ('admin','owner') and p_aal='aal2') or (m.role='member' and m.tier>=p.minimum_tier
      and (p.audience='tier' or exists(select 1 from public.project_assignments a where a.project_id=p.id and a.user_id=p_actor and (a.expires_at is null or a.expires_at>now()))))));
$$;
create function public.portal_catalog(p_actor uuid,p_aal text,p_kind text,p_search text,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.portal_members; result jsonb; total integer;
begin
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  if m.role in ('owner','admin') and p_aal is distinct from 'aal2' then raise exception 'portal:mfa_required'; end if;
  if p_offset is null or p_offset<0 or length(p_search)>160 then raise exception 'portal:invalid'; end if;
  if p_kind='projects' then
    select count(*) into total from public.projects p where public.portal_project_visible(p_actor,p.id,p_aal) and p.title ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
      select p.id,p.title,p.description,p.category,p.minimum_tier,p.audience,p.current_version_id,v.version,v.minimum_app_version,v.notes,
        f.id artifact_id,f.filename,f.bytes,f.sha256,p.published_at,
        (select cover.id from public.artifact_files cover where cover.project_version_id=v.id and cover.kind='preview' and cover.state='verified') preview_id
      from public.projects p join public.project_versions v on v.id=p.current_version_id
      join public.artifact_files f on f.project_version_id=v.id and f.kind='binary' and f.state='verified'
      where public.portal_project_visible(p_actor,p.id,p_aal) and p.title ilike '%'||p_search||'%'
      order by p.published_at desc,p.id limit 24 offset p_offset
    ) t;
  elsif p_kind='releases' then
    select count(*) into total from public.software_releases r join public.artifact_files f on f.release_id=r.id and f.kind='binary' and f.state='verified' where r.status='published' and (r.version||' '||r.kind) ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
      select r.id,r.kind,r.version,r.platform,r.minimum_app_version,r.notes,r.published_at,f.id artifact_id,f.filename,f.bytes,f.sha256
      from public.software_releases r join public.artifact_files f on f.release_id=r.id and f.kind='binary' and f.state='verified'
      where r.status='published' and (r.version||' '||r.kind) ilike '%'||p_search||'%' order by r.published_at desc,r.id limit 24 offset p_offset
    ) t;
  else raise exception 'portal:invalid'; end if;
  return jsonb_build_object('items',result,'total',total,'offset',p_offset);
end; $$;

create function public.portal_immutable_artifact() returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.release_id,new.project_version_id,new.kind,new.bucket,new.object_path,new.filename,new.bytes,new.sha256)
    is distinct from row(old.id,old.release_id,old.project_version_id,old.kind,old.bucket,old.object_path,old.filename,old.bytes,old.sha256)
    then raise exception 'portal:immutable_artifact'; end if;
  return new;
end; $$;
create trigger artifact_identity_immutable before update on public.artifact_files for each row execute function public.portal_immutable_artifact();

create function public.portal_account(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.portal_members;
begin
  select * into m from public.portal_members where user_id=p_actor for update;
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'portal:forbidden'; end if;
  if m.status='invited' and (m.expires_at is null or m.expires_at>now()) then
    update public.portal_members set status='active',updated_at=now(),revision=revision+1 where user_id=p_actor;
    insert into public.portal_events(actor_id,subject_id,action) values(p_actor,p_actor,'invitation_accepted');
  end if;
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  return to_jsonb(m);
end; $$;
create function public.portal_download(p_actor uuid,p_aal text,p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.portal_members; f public.artifact_files; project_id uuid;
begin
  -- Per-user lock makes the hourly reservation atomic across concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended('portal-download:'||p_actor::text,0));
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  if m.role in ('owner','admin') and p_aal is distinct from 'aal2' then raise exception 'portal:mfa_required'; end if;
  select * into f from public.artifact_files where id=p_artifact and state='verified';
  if f.id is null then raise exception 'portal:not_found'; end if;
  if f.release_id is not null then
    if not exists(select 1 from public.software_releases where id=f.release_id and status='published') then raise exception 'portal:not_found'; end if;
  else
    select p.id into project_id from public.projects p where p.current_version_id=f.project_version_id;
    if not public.portal_project_visible(p_actor,project_id,p_aal) then raise exception 'portal:not_found'; end if;
  end if;
  if (select count(*) from public.portal_events where actor_id=p_actor and action='download_link_reserved' and created_at>now()-interval '1 hour')>=30 then raise exception 'portal:rate_limited'; end if;
  insert into public.portal_events(actor_id,resource_id,action,details) values(p_actor,p_artifact,'download_link_reserved',jsonb_build_object('kind',f.kind));
  -- Trusted adapter consumes path and returns only a five-minute signed URL.
  return to_jsonb(f);
end; $$;

-- Supabase defaults grant broad access. Override explicitly for every portal table
-- and only this migration's functions (never change unrelated project routines).
do $$ declare t text; f record; begin
  foreach t in array array['portal_invitations','software_releases','projects','project_versions','project_assignments','artifact_files','upload_sessions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('portal_active','portal_require_admin','portal_member_change','portal_save_project','portal_save_version','portal_save_release','portal_set_assignments','portal_publish','portal_archive','portal_project_visible','portal_catalog','portal_immutable_artifact','portal_account','portal_download') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname not in ('portal_active','portal_require_admin','portal_immutable_artifact') then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end; $$;
commit;
