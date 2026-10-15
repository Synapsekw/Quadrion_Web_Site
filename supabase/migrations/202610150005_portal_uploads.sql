begin;
alter table public.upload_sessions add column cleaned_at timestamptz;
create function public.portal_upload_begin(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.artifact_files; s public.upload_sessions; release uuid:=(p_data->>'releaseId')::uuid; version uuid:=(p_data->>'projectVersionId')::uuid; fid uuid:=gen_random_uuid();
begin
  perform public.portal_require_admin(p_actor,p_aal);
  perform pg_advisory_xact_lock(hashtextextended('portal-upload:'||p_actor::text,0));
  if (select count(*) from public.upload_sessions where admin_id=p_actor and ((state='pending' and expires_at>now()) or state='verifying'))>=3 then raise exception 'portal:rate_limited'; end if;
  if (release is null)=(version is null) or (p_data->>'bytes')::bigint<=0 or (p_data->>'maxBytes')::bigint<=0 or (p_data->>'bytes')::bigint>(p_data->>'maxBytes')::bigint or (p_data->>'bytes')::bigint>100000000000 then raise exception 'portal:invalid'; end if;
  if release is not null then
    if not exists(select 1 from public.software_releases where id=release and status='draft') then raise exception 'portal:conflict'; end if;
  else
    if not exists(select 1 from public.project_versions where id=version) or exists(select 1 from public.projects where current_version_id=version and status='published') then raise exception 'portal:conflict'; end if;
  end if;
  insert into public.artifact_files(id,release_id,project_version_id,kind,bucket,object_path,filename,bytes,mime_type,sha256)
    values(fid,release,version,p_data->>'kind',case when release is null then 'quadrion-projects' else 'quadrion-software' end,
      coalesce(release,version)::text||'/'||fid::text||'/'||(p_data->>'filename'),p_data->>'filename',(p_data->>'bytes')::bigint,p_data->>'mimeType',p_data->>'sha256') returning * into f;
  insert into public.upload_sessions(admin_id,artifact_id) values(p_actor,f.id) returning * into s;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,f.id,'upload_started');
  return to_jsonb(s)||jsonb_build_object('file',to_jsonb(f));
end; $$;
create function public.portal_upload_command(p_actor uuid,p_aal text,p_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.upload_sessions; f public.artifact_files;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select * into s from public.upload_sessions where id=p_id for update;
  if s.id is null then raise exception 'portal:not_found'; end if;
  if (public.portal_active(s.admin_id)).role not in ('owner','admin') or (public.portal_active(s.admin_id)).user_id is null then raise exception 'portal:forbidden'; end if;
  select * into f from public.artifact_files where id=s.artifact_id;
  if p_action='finalize' and s.state='pending' then
    if s.expires_at<=now() then raise exception 'portal:conflict'; end if;
    update public.upload_sessions set state='verifying',updated_at=now() where id=p_id returning * into s;
    update public.artifact_files set state='verifying' where id=f.id;
    insert into public.portal_events(actor_id,resource_id,action) values(p_actor,f.id,'verification_queued');
  elsif p_action='retry' and s.state='failed' and s.cleaned_at is null then
    update public.upload_sessions set state='verifying',attempts=0,error_code=null,lease_id=null,lease_until=null,updated_at=now() where id=p_id returning * into s;
    update public.artifact_files set state='verifying' where id=f.id;
    insert into public.portal_events(actor_id,resource_id,action) values(p_actor,f.id,'verification_retried');
  elsif p_action not in ('status','finalize','retry') then raise exception 'portal:invalid'; end if;
  return to_jsonb(s)||jsonb_build_object('file',to_jsonb(f));
end; $$;
create function public.portal_verify_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.upload_sessions; f public.artifact_files;
begin
  select * into s from public.upload_sessions where id=p_id for update;
  if s.id is null or s.state<>'verifying' or s.lease_until>now() then return null; end if;
  if (public.portal_active(s.admin_id)).role not in ('owner','admin') or (public.portal_active(s.admin_id)).user_id is null then
    update public.upload_sessions set state='failed',error_code='administrator_inactive',updated_at=now() where id=p_id;
    update public.artifact_files set state='failed' where id=s.artifact_id;return null;
  end if;
  if s.attempts>=3 then update public.upload_sessions set state='failed',error_code='retry_limit',updated_at=now() where id=p_id;update public.artifact_files set state='failed' where id=s.artifact_id;return null;end if;
  update public.upload_sessions set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() where id=p_id returning * into s;
  select * into f from public.artifact_files where id=s.artifact_id;
  return to_jsonb(f)||to_jsonb(s)||jsonb_build_object('bytes',f.bytes,'sha256',f.sha256);
end; $$;
create function public.portal_verify_checkpoint(p_id uuid,p_lease uuid,p_offset bigint,p_hash text,p_etag text,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.upload_sessions; f public.artifact_files;
begin
  select * into s from public.upload_sessions where id=p_id for update;
  if s.state is distinct from 'verifying' or s.lease_id is distinct from p_lease or s.lease_until<=now() then raise exception 'portal:conflict'; end if;
  if (public.portal_active(s.admin_id)).role not in ('owner','admin') or (public.portal_active(s.admin_id)).user_id is null then raise exception 'portal:forbidden'; end if;
  select * into f from public.artifact_files where id=s.artifact_id;
  if p_offset<s.verified_bytes or p_offset>f.bytes or p_etag is null or length(p_etag)>300 or (s.object_etag is not null and s.object_etag<>p_etag) then raise exception 'portal:invalid'; end if;
  if p_digest is not null then
    if p_offset<>f.bytes or p_digest<>f.sha256 then raise exception 'portal:checksum_mismatch'; end if;
    update public.artifact_files set state='verified',verified_at=now() where id=f.id;
    update public.upload_sessions set state='verified',verified_bytes=p_offset,hash_state=null,lease_id=null,lease_until=null,updated_at=now(),error_code=null where id=p_id returning * into s;
    insert into public.portal_events(actor_id,resource_id,action) values(s.admin_id,f.id,'artifact_verified');
  else
    if p_hash is null or length(p_hash)>8192 then raise exception 'portal:invalid'; end if;
    update public.upload_sessions set verified_bytes=p_offset,hash_state=p_hash,object_etag=p_etag,lease_until=now()+interval '2 minutes',attempts=0,updated_at=now(),error_code=null where id=p_id returning * into s;
  end if;
  return to_jsonb(s);
end; $$;
create function public.portal_verify_release(p_id uuid,p_lease uuid,p_error text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.upload_sessions set lease_id=null,lease_until=null,error_code=p_error,updated_at=now(),
    state=case when p_error in ('size_mismatch','checksum_mismatch','object_changed','invalid_range','administrator_inactive') or attempts>=3 then 'failed' else state end
    where id=p_id and lease_id=p_lease;
  update public.artifact_files f set state='failed' from public.upload_sessions s where s.id=p_id and s.artifact_id=f.id and s.state='failed';
end; $$;
create function public.portal_verify_queue() returns jsonb
language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(id),'[]') from (select id from public.upload_sessions where state='verifying' and (lease_until is null or lease_until<=now()) order by updated_at limit 10) t;
$$;
create function public.portal_cleanup(p_cleaned uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_cleaned is not null then update public.upload_sessions set cleaned_at=now() where id=p_cleaned and state in ('pending','failed','cancelled') and expires_at<now()-interval '7 days';return '[]';end if;
  delete from public.portal_events where created_at<now()-interval '365 days' or (action in ('download_link_reserved','download_link_issued','download_link_failed') and created_at<now()-interval '90 days');
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select s.id,f.bucket,f.object_path from public.upload_sessions s join public.artifact_files f on f.id=s.artifact_id
    where s.state in ('pending','failed','cancelled') and f.state in ('pending','failed') and s.cleaned_at is null and s.expires_at<now()-interval '7 days'
      and not exists(select 1 from public.software_releases r where r.id=f.release_id and r.status='published')
      and not exists(select 1 from public.projects p where p.current_version_id=f.project_version_id and p.status='published') limit 20) t;
  return result;
end; $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('portal_upload_begin','portal_upload_command','portal_verify_claim','portal_verify_checkpoint','portal_verify_release','portal_verify_queue','portal_cleanup') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end; $$;
commit;
