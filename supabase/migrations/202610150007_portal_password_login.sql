begin;
-- Owner-requested password-only login. Verified identity and current role still gate every request.
-- CREATE OR REPLACE retains service-only ACLs; no table, storage or browser grants change.

create or replace function public.portal_require_admin(p_actor uuid,p_aal text) returns public.portal_members
language plpgsql security definer set search_path='' as $$
declare m public.portal_members;
begin
  lock table public.portal_members in share mode;
  m:=public.portal_active(p_actor);
  if m.user_id is null or m.role not in ('admin','owner') then raise exception 'portal:forbidden'; end if;
  if p_aal is null or p_aal not in ('aal1','aal2') then raise exception 'portal:unauthorized'; end if;
  return m;
end; $$;

create or replace function public.portal_project_visible(p_actor uuid,p_project uuid,p_aal text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects p cross join public.portal_active(p_actor) m
    where p.id=p_project and p.status='published' and p.current_version_id is not null and m.user_id is not null
    and exists(select 1 from public.artifact_files f where f.project_version_id=p.current_version_id and f.kind='binary' and f.state='verified')
    and p_aal in ('aal1','aal2')
    and ((m.role in ('admin','owner')) or (m.role='member' and m.tier>=p.minimum_tier
      and (p.audience='tier' or exists(select 1 from public.project_assignments a where a.project_id=p.id and a.user_id=p_actor and (a.expires_at is null or a.expires_at>now()))))));
$$;

create or replace function public.portal_catalog(p_actor uuid,p_aal text,p_kind text,p_search text,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.portal_members; result jsonb; total integer;
begin
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  if p_aal is null or p_aal not in ('aal1','aal2') then raise exception 'portal:unauthorized'; end if;
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

create or replace function public.portal_download(p_actor uuid,p_aal text,p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.portal_members; f public.artifact_files; project_id uuid;
begin
  -- Per-user lock makes the hourly reservation atomic across concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended('portal-download:'||p_actor::text,0));
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  if p_aal is null or p_aal not in ('aal1','aal2') then raise exception 'portal:unauthorized'; end if;
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

commit;
