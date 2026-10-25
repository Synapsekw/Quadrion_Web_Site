-- Feedback attachments: upload sessions, background SHA-256 verification and cleanup.
-- Mirrors the release upload twins in 202610150005; the attachment row is its own session.
begin;
alter table public.feedback_attachments add column cleaned_at timestamptz;

-- An active member with a known assurance level; the actor always comes from the server.
create function public.portal_feedback_attachment_actor(p_actor uuid,p_aal text) returns public.portal_members
language plpgsql security definer set search_path='' as $$
declare m public.portal_members;
begin
  if p_aal is null or p_aal not in ('aal1','aal2') then raise exception 'portal:unauthorized'; end if;
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  return m;
end; $$;

create function public.portal_feedback_attachment_begin(p_actor uuid,p_aal text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.feedback_attachments; v_item uuid; v_event uuid; v_id uuid:=gen_random_uuid();
  v_name text:=p_data->>'filename'; v_mime text:=p_data->>'mimeType'; v_sha text:=p_data->>'sha256'; v_bytes numeric; v_max numeric; v_cap bigint;
begin
  perform public.portal_feedback_attachment_actor(p_actor,p_aal);
  if jsonb_typeof(p_data->'bytes') is distinct from 'number' or jsonb_typeof(p_data->'maxBytes') is distinct from 'number'
    or coalesce(p_data->>'itemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_data->>'eventId' is not null and p_data->>'eventId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'portal:invalid'; end if;
  v_item:=(p_data->>'itemId')::uuid; v_event:=(p_data->>'eventId')::uuid;
  v_bytes:=(p_data->>'bytes')::numeric; v_max:=(p_data->>'maxBytes')::numeric;
  if not public.portal_feedback_visible(p_actor,v_item) then raise exception 'portal:not_found'; end if;
  v_cap:=case v_mime when 'image/png' then 10000000 when 'image/jpeg' then 10000000 when 'image/webp' then 10000000
    when 'video/mp4' then 100000000 when 'video/webm' then 100000000 when 'application/zip' then 50000000 end;
  if v_cap is null or v_name is null or length(v_name) not between 1 and 200 or v_name !~ '^[a-zA-Z0-9][a-zA-Z0-9 _().-]*$' or position('..' in v_name)>0
    or v_sha is null or v_sha !~ '^[a-f0-9]{64}$' or v_bytes<=0 or v_max<=0 or v_bytes<>trunc(v_bytes) then raise exception 'portal:invalid'; end if;
  if v_bytes>v_max or v_bytes>v_cap then raise exception 'portal:too_large'; end if;
  if v_event is not null and not exists(select 1 from public.feedback_events where id=v_event and item_id=v_item) then raise exception 'portal:invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-feedback-attach:'||v_item::text,0));
  if (select count(*) from public.feedback_attachments where item_id=v_item and state<>'abandoned')>=10 then raise exception 'portal:conflict'; end if;
  insert into public.feedback_attachments(id,item_id,event_id,uploader_id,object_path,filename,mime_type,bytes,sha256)
    values(v_id,v_item,v_event,p_actor,v_item::text||'/'||v_id::text||'/'||v_name,v_name,v_mime,v_bytes::bigint,v_sha) returning * into a;
  insert into public.portal_events(actor_id,resource_id,action) values(p_actor,a.id,'feedback_upload_started');
  return to_jsonb(a);
end; $$;

create function public.portal_feedback_attachment_command(p_actor uuid,p_aal text,p_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.feedback_attachments;
begin
  perform public.portal_feedback_attachment_actor(p_actor,p_aal);
  select * into a from public.feedback_attachments where id=p_id for update;
  if a.id is null or a.uploader_id<>p_actor or not public.portal_feedback_visible(p_actor,a.item_id) then raise exception 'portal:not_found'; end if;
  if p_action is null or p_action not in ('status','resume','finalize','retry','abandon') then raise exception 'portal:invalid'; end if;
  if p_action='status' then return to_jsonb(a); end if;
  if p_action='abandon' then
    if a.state='abandoned' then return to_jsonb(a); end if;
    if a.state not in ('pending','failed') then raise exception 'portal:conflict'; end if;
    update public.feedback_attachments set state='abandoned',lease_id=null,lease_until=null where id=p_id returning * into a;
    insert into public.portal_events(actor_id,resource_id,action) values(p_actor,a.id,'feedback_upload_abandoned');
    return to_jsonb(a);
  end if;
  if p_action='resume' then
    if a.state<>'pending' or a.expires_at<=now() then raise exception 'portal:conflict'; end if;
    return to_jsonb(a);
  end if;
  if p_action='finalize' and a.state='pending' then
    if a.expires_at<=now() then raise exception 'portal:conflict'; end if;
    update public.feedback_attachments set state='verifying' where id=p_id returning * into a;
  elsif p_action='retry' and a.state='failed' and a.cleaned_at is null then
    update public.feedback_attachments set state='verifying',attempts=0,error_code=null,lease_id=null,lease_until=null where id=p_id returning * into a;
  elsif a.state not in ('verifying','verified') then raise exception 'portal:conflict'; end if;
  return to_jsonb(a);
end; $$;

create function public.portal_feedback_attachment_get(p_actor uuid,p_aal text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.feedback_attachments;
begin
  perform public.portal_feedback_attachment_actor(p_actor,p_aal);
  select * into a from public.feedback_attachments where id=p_id and state='verified';
  -- Visible through the merge chain, as the item listing is: the file's item or any item it was merged into.
  if a.id is null or not exists(with recursive up(id) as (select a.item_id union select i.merged_into from public.feedback_items i join up on i.id=up.id where i.merged_into is not null)
    select 1 from up where public.portal_feedback_visible(p_actor,up.id)) then raise exception 'portal:not_found'; end if;
  return to_jsonb(a);
end; $$;

create function public.portal_feedback_verify_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.feedback_attachments;
begin
  select * into a from public.feedback_attachments where id=p_id for update;
  if a.id is null or a.state<>'verifying' or a.lease_until>now() then return null; end if;
  if (public.portal_active(a.uploader_id)).user_id is null then
    update public.feedback_attachments set state='failed',error_code='uploader_inactive' where id=p_id;return null;
  end if;
  if a.attempts>=3 then update public.feedback_attachments set state='failed',error_code='retry_limit' where id=p_id;return null; end if;
  update public.feedback_attachments set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=p_id returning * into a;
  return to_jsonb(a);
end; $$;

create function public.portal_feedback_verify_checkpoint(p_id uuid,p_lease uuid,p_offset bigint,p_hash text,p_etag text,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.feedback_attachments;
begin
  select * into a from public.feedback_attachments where id=p_id for update;
  if a.state is distinct from 'verifying' or a.lease_id is distinct from p_lease or a.lease_until<=now() then raise exception 'portal:conflict'; end if;
  if (public.portal_active(a.uploader_id)).user_id is null then raise exception 'portal:forbidden'; end if;
  if p_offset<a.verified_bytes or p_offset>a.bytes or p_etag is null or length(p_etag)>300 or (a.object_etag is not null and a.object_etag<>p_etag) then raise exception 'portal:invalid'; end if;
  if p_digest is not null then
    if p_offset<>a.bytes or p_digest<>a.sha256 then raise exception 'portal:checksum_mismatch'; end if;
    update public.feedback_attachments set state='verified',verified_at=now(),verified_bytes=p_offset,hash_state=null,object_etag=p_etag,lease_id=null,lease_until=null,error_code=null where id=p_id returning * into a;
    insert into public.portal_events(actor_id,resource_id,action) values(a.uploader_id,a.id,'feedback_attachment_verified');
  else
    if p_hash is null or length(p_hash)>8192 then raise exception 'portal:invalid'; end if;
    update public.feedback_attachments set verified_bytes=p_offset,hash_state=p_hash,object_etag=p_etag,lease_until=now()+interval '2 minutes',attempts=0,error_code=null where id=p_id returning * into a;
  end if;
  return to_jsonb(a);
end; $$;

create function public.portal_feedback_verify_release(p_id uuid,p_lease uuid,p_error text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.feedback_attachments set lease_id=null,lease_until=null,error_code=p_error,
    state=case when p_error in ('size_mismatch','checksum_mismatch','object_changed','invalid_range','uploader_inactive') or attempts>=3 then 'failed' else state end
    where id=p_id and lease_id=p_lease;
end; $$;

create function public.portal_feedback_verify_queue() returns jsonb
language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(id),'[]') from (select id from public.feedback_attachments where state='verifying' and (lease_until is null or lease_until<=now()) order by created_at limit 10) t;
$$;

create function public.portal_feedback_cleanup(p_cleaned uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb:='[]'; candidate record;
begin
  if p_cleaned is not null then update public.feedback_attachments set cleaned_at=coalesce(cleaned_at,now()) where id=p_cleaned and state='abandoned';return '[]';end if;
  -- Claim under the row lock that retry and verification take, so a stale result never names a verified file.
  for candidate in select id,bucket,object_path from public.feedback_attachments
    where state in ('pending','failed','abandoned') and cleaned_at is null and expires_at<now()-interval '7 days'
    limit 20 for update skip locked loop
    update public.feedback_attachments set state='abandoned',lease_id=null,lease_until=null where id=candidate.id;
    result:=result||jsonb_build_array(jsonb_build_object('id',candidate.id,'bucket',candidate.bucket,'object_path',candidate.object_path));
  end loop;
  return result;
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('portal_feedback_attachment_actor','portal_feedback_attachment_begin','portal_feedback_attachment_command','portal_feedback_attachment_get','portal_feedback_verify_claim','portal_feedback_verify_checkpoint','portal_feedback_verify_release','portal_feedback_verify_queue','portal_feedback_cleanup') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname<>'portal_feedback_attachment_actor' then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end; $$;
commit;
