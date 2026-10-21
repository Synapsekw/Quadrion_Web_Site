begin;

-- Strict stable SemVer only. Numeric arrays preserve numeric ordering and avoid
-- the integer overflow and lexical ordering traps in version comparisons.
create function public.portal_stable_version(p_version text) returns numeric[]
language plpgsql immutable set search_path='' as $$
declare parts numeric[];
begin
  if p_version is null or length(p_version)>48 or p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' then return null; end if;
  parts:=string_to_array(p_version,'.')::numeric[];
  if parts[1]>9007199254740991 or parts[2]>9007199254740991 or parts[3]>9007199254740991 then return null; end if;
  return parts;
end; $$;
create function public.portal_app_range_valid(p_range text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(length(p_range)<=100 and p_range ~ '^>=[^ ]+ <[^ ]+$'
    and public.portal_stable_version(split_part(substring(p_range from 3),' ',1)) < public.portal_stable_version(split_part(p_range,'<',2)),false);
$$;
create function public.portal_app_compatible(p_version text,p_range text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(public.portal_app_range_valid(p_range)
    and public.portal_stable_version(p_version)>=public.portal_stable_version(split_part(substring(p_range from 3),' ',1))
    and public.portal_stable_version(p_version)<public.portal_stable_version(split_part(p_range,'<',2)),false);
$$;

alter table public.software_releases
  add column auto_update_enabled boolean not null default false,
  add column architecture text check (architecture='x64'),
  add column package_format text check (package_format in ('nsis','tar.gz')),
  add column app_range text,
  add column pipeline_release_id uuid references public.software_releases(id),
  add constraint release_update_metadata check (
    (package_format is null or (kind='app' and package_format='nsis') or (kind='pipeline' and package_format='tar.gz'))
    and (app_range is null or (kind='pipeline' and public.portal_app_range_valid(app_range)))
    and (pipeline_release_id is null or (kind='app' and pipeline_release_id<>id))
    and (not auto_update_enabled or coalesce(
      public.portal_stable_version(version) is not null and platform='windows' and architecture='x64'
      and ((kind='app' and package_format='nsis' and pipeline_release_id is not null)
        or (kind='pipeline' and package_format='tar.gz' and app_range is not null)),false))
  );

create function public.portal_release_update_eligible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.software_releases r join public.artifact_files f on f.release_id=r.id
    where r.id=p_id and r.status='published' and r.auto_update_enabled and r.platform='windows' and r.architecture='x64'
      and public.portal_stable_version(r.version) is not null and f.kind='binary' and f.state='verified'
      and f.filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and f.bytes<=9007199254740991
      and ((r.kind='app' and r.package_format='nsis' and lower(f.filename) like '%.exe')
        or (r.kind='pipeline' and r.package_format='tar.gz' and lower(f.filename) like '%.tar.gz' and public.portal_app_range_valid(r.app_range))));
$$;

-- Enforce publication at the table boundary as well as in the admin RPC. A
-- published release's identity/compatibility cannot change underneath a check.
create function public.portal_release_update_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare baseline public.software_releases;
begin
  if tg_op='UPDATE' and old.status<>'draft'
    and row(new.kind,new.version,new.platform,new.minimum_app_version,new.notes,new.auto_update_enabled,new.architecture,new.package_format,new.app_range,new.pipeline_release_id)
      is distinct from row(old.kind,old.version,old.platform,old.minimum_app_version,old.notes,old.auto_update_enabled,old.architecture,old.package_format,old.app_range,old.pipeline_release_id)
    then raise exception 'portal:immutable_release'; end if;
  if new.status='published' and new.auto_update_enabled then
    if not exists(select 1 from public.artifact_files f where f.release_id=new.id and f.kind='binary' and f.state='verified'
      and f.filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and f.bytes<=9007199254740991
      and ((new.kind='app' and lower(f.filename) like '%.exe') or (new.kind='pipeline' and lower(f.filename) like '%.tar.gz')))
      then raise exception 'portal:unverified'; end if;
    if new.kind='app' then
      select * into baseline from public.software_releases where id=new.pipeline_release_id for share;
      if baseline.kind is distinct from 'pipeline' or not public.portal_release_update_eligible(baseline.id)
        or not public.portal_app_compatible(new.version,baseline.app_range) then raise exception 'portal:incompatible'; end if;
    end if;
  end if;
  return new;
end; $$;
create trigger release_update_guard before insert or update on public.software_releases for each row execute function public.portal_release_update_guard();

create or replace function public.portal_save_release(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.software_releases; target uuid:=(p_data->>'id')::uuid;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if p_data ? 'autoUpdateEnabled' and jsonb_typeof(p_data->'autoUpdateEnabled') is distinct from 'boolean' then raise exception 'portal:invalid'; end if;
  if target is null then
    insert into public.software_releases(kind,version,platform,minimum_app_version,notes,created_by,auto_update_enabled,architecture,package_format,app_range,pipeline_release_id)
    values(p_data->>'kind',p_data->>'version',p_data->>'platform',coalesce(p_data->>'minimumAppVersion',''),coalesce(p_data->>'notes',''),p_actor,
      coalesce((p_data->>'autoUpdateEnabled')::boolean,false),p_data->>'architecture',p_data->>'packageFormat',p_data->>'appRange',(p_data->>'pipelineReleaseId')::uuid) returning * into result;
  else
    select * into result from public.software_releases where id=target for update;
    if result.id is null then raise exception 'portal:not_found'; end if;
    if result.status<>'draft' or result.revision is distinct from (p_data->>'revision')::integer then raise exception 'portal:conflict'; end if;
    update public.software_releases set kind=p_data->>'kind',version=p_data->>'version',platform=p_data->>'platform',minimum_app_version=coalesce(p_data->>'minimumAppVersion',''),notes=coalesce(p_data->>'notes',''),
      auto_update_enabled=coalesce((p_data->>'autoUpdateEnabled')::boolean,false),architecture=p_data->>'architecture',package_format=p_data->>'packageFormat',app_range=p_data->>'appRange',pipeline_release_id=(p_data->>'pipelineReleaseId')::uuid,
      revision=revision+1 where id=target returning * into result;
  end if;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,result.id,'release_saved');
  return to_jsonb(result);
end; $$;

-- Only trusted member API callers can invoke this. No storage locations, signing
-- or hourly download reservations are involved; account state is checked live.
create function public.portal_update_candidates(p_actor uuid,p_aal text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if (public.portal_active(p_actor)).user_id is null then raise exception 'portal:forbidden'; end if;
  if p_aal is null or p_aal not in ('aal1','aal2') then raise exception 'portal:unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('releaseId',r.id,'artifactId',f.id,'kind',r.kind,'version',r.version,'platform','win-x64',
    'filename',f.filename,'bytes',f.bytes,'sha256',f.sha256,'notes',r.notes,'appRange',r.app_range,'pipelineReleaseId',r.pipeline_release_id)),'[]') into result
    from public.software_releases r join public.artifact_files f on f.release_id=r.id and f.kind='binary' and f.state='verified'
    where public.portal_release_update_eligible(r.id);
  return result;
end; $$;

revoke all on function public.portal_stable_version(text),public.portal_app_range_valid(text),public.portal_app_compatible(text,text),public.portal_release_update_eligible(uuid),public.portal_release_update_guard(),public.portal_update_candidates(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.portal_update_candidates(uuid,text) to service_role;
-- Replacing portal_save_release preserves its existing service-only ACL.
commit;
