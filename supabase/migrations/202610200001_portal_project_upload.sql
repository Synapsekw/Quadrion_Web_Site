begin;

-- The old "version" variable conflicts with project_versions.version.
-- Replace only the function body, preserving its signature and service-only ACLs.
create or replace function public.portal_upload_begin(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.artifact_files; s public.upload_sessions; v_release_id uuid:=(p_data->>'releaseId')::uuid; v_project_version_id uuid:=(p_data->>'projectVersionId')::uuid; fid uuid:=gen_random_uuid();
begin
  perform public.portal_require_admin(p_actor,p_aal);
  perform pg_advisory_xact_lock(hashtextextended('portal-upload:'||p_actor::text,0));
  if (select count(*) from public.upload_sessions where admin_id=p_actor and ((state='pending' and expires_at>now()) or state='verifying'))>=3 then raise exception 'portal:rate_limited'; end if;
  if (v_release_id is null)=(v_project_version_id is null) or (p_data->>'bytes')::bigint<=0 or (p_data->>'maxBytes')::bigint<=0 or (p_data->>'bytes')::bigint>(p_data->>'maxBytes')::bigint or (p_data->>'bytes')::bigint>100000000000 then raise exception 'portal:invalid'; end if;
  if v_release_id is not null then
    if not exists(select 1 from public.software_releases r where r.id=v_release_id and r.status='draft') then raise exception 'portal:conflict'; end if;
  else
    if not exists(select 1 from public.project_versions v where v.id=v_project_version_id) or exists(select 1 from public.projects p where p.current_version_id=v_project_version_id and p.status='published') then raise exception 'portal:conflict'; end if;
  end if;
  insert into public.artifact_files(id,release_id,project_version_id,kind,bucket,object_path,filename,bytes,mime_type,sha256)
    values(fid,v_release_id,v_project_version_id,p_data->>'kind',case when v_release_id is null then 'quadrion-projects' else 'quadrion-software' end,
      coalesce(v_release_id,v_project_version_id)::text||'/'||fid::text||'/'||(p_data->>'filename'),p_data->>'filename',(p_data->>'bytes')::bigint,p_data->>'mimeType',p_data->>'sha256') returning * into f;
  insert into public.upload_sessions(admin_id,artifact_id) values(p_actor,f.id) returning * into s;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,f.id,'upload_started');
  return to_jsonb(s)||jsonb_build_object('file',to_jsonb(f));
end; $$;

commit;
