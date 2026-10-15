begin;
create function public.portal_invite_begin(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; existing public.portal_members; result public.portal_invitations; mail text:=lower(trim(p_data->>'email')); target uuid; resend boolean:=coalesce((p_data->>'resend')::boolean,false);
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  if p_data->>'role' not in ('member','admin') or (p_data->>'role'='admin' and actor.role<>'owner') then raise exception 'portal:forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-invite:'||p_actor::text,0));
  perform pg_advisory_xact_lock(hashtextextended('portal-email:'||mail,0));
  select * into result from public.portal_invitations where idempotency_key=(p_data->>'idempotencyKey')::uuid;
  if result.id is not null then
    if result.invited_by<>p_actor or result.email<>mail or result.role is distinct from p_data->>'role' or result.tier is distinct from (p_data->>'tier')::smallint or result.expires_at is distinct from (p_data->>'expiresAt')::timestamptz then raise exception 'portal:conflict'; end if;
    return to_jsonb(result)||jsonb_build_object('dispatch',false);
  end if;
  if exists(select 1 from public.portal_invitations where email=mail and created_at>now()-interval '10 minutes')
    or (select count(*) from public.portal_invitations where invited_by=p_actor and created_at>now()-interval '1 hour')>=10 then raise exception 'portal:rate_limited'; end if;
  if exists(select 1 from public.portal_invitations where email=mail and status='dispatching') then raise exception 'portal:conflict'; end if;
  select id into target from auth.users where lower(email)=mail and deleted_at is null;
  if target is not null then
    select * into existing from public.portal_members where user_id=target;
    if not resend or existing.status is distinct from 'invited' or existing.role is distinct from p_data->>'role' or existing.tier is distinct from (p_data->>'tier')::smallint or existing.expires_at is distinct from (p_data->>'expiresAt')::timestamptz then raise exception 'portal:conflict'; end if;
    if existing.expires_at<=now() then raise exception 'portal:forbidden'; end if;
  elsif resend then raise exception 'portal:not_found'; end if;
  insert into public.portal_invitations(email,role,tier,expires_at,invited_by,user_id,idempotency_key,status)
    values(mail,p_data->>'role',(p_data->>'tier')::smallint,(p_data->>'expiresAt')::timestamptz,p_actor,target,(p_data->>'idempotencyKey')::uuid,'dispatching') returning * into result;
  insert into public.portal_events(actor_id,resource_id,action,details) values(p_actor,result.id,'invitation_dispatch_started',jsonb_build_object('email',mail,'resend',resend));
  return to_jsonb(result)||jsonb_build_object('dispatch',true);
end; $$;
create function public.portal_invite_resolve(p_actor uuid,p_aal text,p_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; intent public.portal_invitations; target auth.users; existing public.portal_members;
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  select * into intent from public.portal_invitations where id=p_id for update;
  if intent.id is null then raise exception 'portal:not_found'; end if;
  if actor.role<>'owner' and (intent.invited_by<>p_actor or intent.role<>'member') then raise exception 'portal:forbidden'; end if;
  if intent.status in ('sent','failed','cancelled') then return to_jsonb(intent); end if;
  if intent.status<>'dispatching' then raise exception 'portal:conflict'; end if;
  select * into target from auth.users where lower(email)=intent.email and deleted_at is null and not coalesce(is_anonymous,false)
    and (banned_until is null or banned_until<=now()) and (id=intent.user_id or created_at>=intent.created_at)
    and (p_user_id is null or id=p_user_id);
  if target.id is null then return to_jsonb(intent); end if;
  if intent.expires_at<=now() then raise exception 'portal:forbidden'; end if;
  select * into existing from public.portal_members where user_id=target.id;
  if existing.user_id is not null then
    if intent.user_id is distinct from target.id or existing.status<>'invited' or existing.role<>intent.role or existing.tier is distinct from intent.tier or existing.expires_at is distinct from intent.expires_at then raise exception 'portal:conflict'; end if;
  else
    insert into public.portal_members(user_id,role,tier,status,expires_at,invited_by) values(target.id,intent.role,intent.tier,'invited',intent.expires_at,intent.invited_by);
  end if;
  update public.portal_invitations set user_id=target.id,status='sent',updated_at=now() where id=p_id returning * into intent;
  insert into public.portal_events(actor_id,subject_id,resource_id,action) values(p_actor,target.id,p_id,'invitation_bound');
  return to_jsonb(intent);
end; $$;
create function public.portal_invite_recover(p_actor uuid,p_aal text,p_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; intent public.portal_invitations; resolved jsonb;
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  select * into intent from public.portal_invitations where id=p_id for update;
  if intent.id is null then raise exception 'portal:not_found'; end if;
  if actor.role<>'owner' and (intent.invited_by<>p_actor or intent.role<>'member') then raise exception 'portal:forbidden'; end if;
  if p_action not in ('failed','cancel','reconcile') then raise exception 'portal:invalid'; end if;
  if intent.status<>'dispatching' then return to_jsonb(intent); end if;
  -- 'failed' is reserved for a definite provider rejection, never browser input.
  if p_action<>'failed' then
    resolved:=public.portal_invite_resolve(p_actor,p_aal,p_id,null);
    if resolved->>'status'<>'dispatching' or p_action='reconcile' then return resolved; end if;
    if intent.created_at>now()-interval '10 minutes' or exists(select 1 from auth.users where lower(email)=intent.email and deleted_at is null) then raise exception 'portal:conflict'; end if;
  end if;
  update public.portal_invitations set status=case when p_action='failed' then 'failed' else 'cancelled' end,updated_at=now() where id=p_id returning * into intent;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,p_id,'invitation_'||intent.status);
  return to_jsonb(intent);
end; $$;
create function public.portal_admin_list(p_actor uuid,p_aal text,p_kind text,p_search text,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; total integer;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>160 then raise exception 'portal:invalid'; end if;
  if p_kind='overview' then return jsonb_build_object('members',(select count(*) from public.portal_members where role='member' and status='active'),'invited',(select count(*) from public.portal_members where status='invited'),'projects',(select count(*) from public.projects where status='published'),'releases',(select count(*) from public.software_releases where status='published'));
  elsif p_kind='users' then
    select count(*) into total from public.portal_members m join auth.users u on u.id=m.user_id where (coalesce(u.email,'')||' '||m.display_name||' '||m.company) ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select m.*,u.email from public.portal_members m join auth.users u on u.id=m.user_id where (coalesce(u.email,'')||' '||m.display_name||' '||m.company) ilike '%'||p_search||'%' order by m.created_at desc,m.user_id limit 50 offset p_offset) t;
  elsif p_kind='invitations' then
    select count(*) into total from public.portal_invitations where email ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,email,role,tier,status,user_id,expires_at,created_at,idempotency_key,invited_by from public.portal_invitations where email ilike '%'||p_search||'%' order by created_at desc,id limit 50 offset p_offset) t;
  elsif p_kind='projects' then
    select count(*) into total from public.projects where title ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select p.*,
      (select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('files',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'filename',f.filename,'bytes',f.bytes,'sha256',f.sha256,'state',f.state,'upload_session_id',(select s.id from public.upload_sessions s where s.artifact_id=f.id))),'[]') from public.artifact_files f where f.project_version_id=v.id and f.state<>'abandoned')) order by v.created_at desc),'[]') from public.project_versions v where v.project_id=p.id) versions,
      (select coalesce(jsonb_agg(jsonb_build_object('userId',a.user_id,'expiresAt',a.expires_at)),'[]') from public.project_assignments a where a.project_id=p.id) assignments
      from public.projects p where title ilike '%'||p_search||'%' order by p.created_at desc,p.id limit 50 offset p_offset) t;
  elsif p_kind='releases' then
    select count(*) into total from public.software_releases where (kind||' '||version) ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select r.*,
      (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'bytes',f.bytes,'sha256',f.sha256,'state',f.state,'upload_session_id',(select s.id from public.upload_sessions s where s.artifact_id=f.id))),'[]') from public.artifact_files f where f.release_id=r.id and f.state<>'abandoned') files
      from public.software_releases r where (kind||' '||version) ilike '%'||p_search||'%' order by r.created_at desc,r.id limit 50 offset p_offset) t;
  elsif p_kind='activity' then
    select count(*) into total from public.portal_events where action ilike '%'||p_search||'%';
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select * from public.portal_events where action ilike '%'||p_search||'%' order by created_at desc,id limit 50 offset p_offset) t;
  else raise exception 'portal:invalid'; end if;
  return jsonb_build_object('items',result,'total',total,'offset',p_offset);
end; $$;
revoke all on function public.portal_invite_begin(uuid,text,jsonb),public.portal_invite_resolve(uuid,text,uuid,uuid),public.portal_invite_recover(uuid,text,uuid,text),public.portal_admin_list(uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_invite_begin(uuid,text,jsonb),public.portal_invite_resolve(uuid,text,uuid,uuid),public.portal_invite_recover(uuid,text,uuid,text),public.portal_admin_list(uuid,text,text,text,integer) to service_role;
commit;
