begin;
create function public.portal_project(p_actor uuid,p_aal text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.portal_project_visible(p_actor,p_id,p_aal) then raise exception 'portal:not_found'; end if;
  select jsonb_build_object('id',p.id,'title',p.title,'description',p.description,'category',p.category,'minimum_tier',p.minimum_tier,
    'version',v.version,'minimum_app_version',v.minimum_app_version,'notes',v.notes,'published_at',p.published_at,
    'files',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'filename',f.filename,'bytes',f.bytes,'sha256',f.sha256)),'[]')
      from public.artifact_files f where f.project_version_id=v.id and f.state='verified')) into result
  from public.projects p join public.project_versions v on v.id=p.current_version_id where p.id=p_id;
  return result;
end; $$;
create function public.portal_preview(p_actor uuid,p_aal text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f public.artifact_files;
begin
  select cover.* into f from public.artifact_files cover join public.projects p on p.current_version_id=cover.project_version_id
    where cover.id=p_id and cover.kind='preview' and cover.state='verified' and public.portal_project_visible(p_actor,p.id,p_aal);
  if f.id is null then raise exception 'portal:not_found'; end if;
  return to_jsonb(f);
end; $$;
create function public.portal_profile(p_actor uuid,p_name text,p_company text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.portal_members;
begin
  select * into m from public.portal_members where user_id=p_actor for update;
  if (public.portal_active(p_actor)).user_id is null then raise exception 'portal:forbidden'; end if;
  update public.portal_members set display_name=p_name,company=p_company,updated_at=now(),revision=revision+1 where user_id=p_actor returning * into m;
  return to_jsonb(m);
end; $$;
create function public.portal_download_result(p_actor uuid,p_artifact uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.portal_events where actor_id=p_actor and resource_id=p_artifact and action='download_link_reserved' and created_at>now()-interval '1 minute') then raise exception 'portal:invalid'; end if;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,p_artifact,case when p_success then 'download_link_issued' else 'download_link_failed' end);
end; $$;
revoke all on function public.portal_project(uuid,text,uuid),public.portal_preview(uuid,text,uuid),public.portal_profile(uuid,text,text),public.portal_download_result(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.portal_project(uuid,text,uuid),public.portal_preview(uuid,text,uuid),public.portal_profile(uuid,text,text),public.portal_download_result(uuid,uuid,boolean) to service_role;
commit;
