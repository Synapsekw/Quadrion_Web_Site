-- Feedback items: reports and threads, the owner's inbox and actions, merge, counts and the Copy for AI export.
-- Trusted server API only: no browser grants, no RLS policies, actor supplied by the server.
begin;

-- Internal: a build string from input. Blank is 'unknown' unless a real build is required.
create function public.portal_feedback_build_text(p_build text,p_required boolean) returns text
language plpgsql immutable security definer set search_path='' as $$
declare v text:=trim(coalesce(p_build,''));
begin
  if v='' and not p_required then return 'unknown'; end if;
  if v='' or length(v)>80 or v !~ '^[0-9A-Za-z][0-9A-Za-z._+ -]*$' or (p_required and v='unknown') then raise exception 'portal:invalid'; end if;
  return v;
end; $$;

-- Internal: trimmed free text up to p_max characters; blank is refused when required and null otherwise.
create function public.portal_feedback_note(p_text text,p_max integer,p_required boolean) returns text
language plpgsql immutable security definer set search_path='' as $$
declare v text:=nullif(btrim(coalesce(p_text,''),E' \t\r\n'),'');
begin
  if (v is null and p_required) or length(v)>p_max then raise exception 'portal:invalid'; end if;
  return v;
end; $$;

-- Internal: a JSON object with only the allowed keys (null is an empty object).
create function public.portal_feedback_keys(p_data jsonb,p_allowed text[]) returns jsonb
language plpgsql immutable security definer set search_path='' as $$
begin
  if p_data is null or p_data='null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k<>all(p_allowed)) then raise exception 'portal:invalid'; end if;
  return p_data;
end; $$;

-- Internal: one string value of a JSON object, or null when absent; any other JSON type is refused.
create function public.portal_feedback_str(p_data jsonb,p_key text) returns text
language plpgsql immutable security definer set search_path='' as $$
begin
  if jsonb_typeof(p_data->p_key) not in ('string','null') then raise exception 'portal:invalid'; end if;
  return p_data->>p_key;
end; $$;

-- Internal: a uuid from text, refused as invalid rather than as a cast error.
create function public.portal_feedback_uuid(p_text text) returns uuid
language plpgsql immutable security definer set search_path='' as $$
begin
  if p_text is null or p_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'portal:invalid'; end if;
  return p_text::uuid;
end; $$;

-- Internal: an item and every item merged into it, at any depth.
create function public.portal_feedback_tree(p_item uuid) returns setof uuid
language sql stable security definer set search_path='' as $$
  with recursive tree(id) as (select p_item union select i.id from public.feedback_items i join tree t on i.merged_into=t.id)
  select id from tree;
$$;

-- Internal: an item as the actor sees it. Testers never see who else raised it.
create function public.portal_feedback_dto(p_item public.feedback_items,p_actor uuid,p_admin boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p_admin then to_jsonb(p_item)||jsonb_build_object('reporters',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.tester_id,'name',coalesce(nullif(m.display_name,''),u.email,''),'confirmedAt',r.confirmed_at,'confirmedBuild',r.confirmed_build) order by r.added_at,r.tester_id),'[]')
      from public.feedback_reporters r join public.portal_members m on m.user_id=r.tester_id left join auth.users u on u.id=r.tester_id where r.item_id=p_item.id))
    else (to_jsonb(p_item)-'created_by'-'owner_attention')||coalesce((select jsonb_build_object('mine',p_item.created_by=p_actor,'confirmed',r.confirmed_at is not null,
      'waiting',p_item.status='question' or (p_item.status='fixed' and r.confirmed_at is null))
      from public.feedback_reporters r where r.item_id=p_item.id and r.tester_id=p_actor),'{}'::jsonb) end;
$$;

-- Internal: the current test line text for a line id, or null when no current version holds it.
create function public.portal_feedback_line(p_line text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('plain',l.plain,'html',l.html,'sub',l.sub,'stageTitle',l.stage_title,'groupTitle',l.group_title)
  from public.test_lines l join public.test_content c on c.id=l.content_id and c.current where l.line_id=p_line;
$$;

-- Internal: the items in an inbox filter. Every key is checked; unknown keys or values are invalid.
create function public.portal_feedback_match(p_filter jsonb) returns setof public.feedback_items
language plpgsql stable security definer set search_path='' as $$
declare f jsonb:=public.portal_feedback_keys(p_filter,array['tester','kind','status','priority','build','offset']);
  v_tester uuid; v_kind text; v_status text[]; v_priority text; v_build text;
begin
  if f ? 'tester' then v_tester:=public.portal_feedback_uuid(public.portal_feedback_str(f,'tester')); end if;
  v_kind:=public.portal_feedback_str(f,'kind');
  if v_kind not in ('bug','feature') then raise exception 'portal:invalid'; end if;
  if f ? 'status' then
    if jsonb_typeof(f->'status')<>'array' or exists(select 1 from jsonb_array_elements(f->'status') s
      where jsonb_typeof(s)<>'string' or s#>>'{}' not in ('new','triaged','question','fixed','confirmed','reopened','parked','declined','merged')) then raise exception 'portal:invalid'; end if;
    select array_agg(s) into v_status from jsonb_array_elements_text(f->'status') s;
  end if;
  v_priority:=public.portal_feedback_str(f,'priority');
  if v_priority not in ('high','normal','low') then raise exception 'portal:invalid'; end if;
  -- 'unknown' finds the items whose build was not recorded.
  if f ? 'build' then
    v_build:=public.portal_feedback_note(public.portal_feedback_str(f,'build'),80,true);
    v_build:=public.portal_feedback_build_text(v_build,false);
  end if;
  if f ? 'offset' and (jsonb_typeof(f->'offset')<>'number' or (f->>'offset') !~ '^[0-9]{1,6}$' or (f->>'offset')::integer>100000) then raise exception 'portal:invalid'; end if;
  return query select i.* from public.feedback_items i
    where (v_tester is null or exists(select 1 from public.feedback_reporters r where r.item_id=i.id and r.tester_id=v_tester))
      and (v_kind is null or i.kind=v_kind) and (v_status is null or i.status=any(v_status))
      and (v_priority is null or i.priority=v_priority) and (v_build is null or v_build in (i.build_seen,i.fixed_in));
end; $$;

create function public.portal_feedback_create(p_actor uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; v_kind text; v_title text; v_body text; v_line text; v_build text; v_screen text; item public.feedback_items;
begin
  perform public.portal_tester_active(p_actor);
  d:=public.portal_feedback_keys(p_data,array['kind','title','body','lineId','build','screen']);
  v_kind:=public.portal_feedback_str(d,'kind');
  if v_kind is null or v_kind not in ('bug','feature') then raise exception 'portal:invalid'; end if;
  v_title:=regexp_replace(public.portal_feedback_note(public.portal_feedback_str(d,'title'),16000,true),'\s+',' ','g');
  if length(v_title)>200 then raise exception 'portal:invalid'; end if;
  v_body:=coalesce(public.portal_feedback_note(public.portal_feedback_str(d,'body'),16000,false),'');
  v_build:=public.portal_feedback_build_text(public.portal_feedback_str(d,'build'),false);
  v_screen:=public.portal_feedback_note(public.portal_feedback_str(d,'screen'),80,false);
  v_line:=public.portal_feedback_note(public.portal_feedback_str(d,'lineId'),200,false);
  if v_line is not null then
    if v_line !~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$' then raise exception 'portal:invalid'; end if;
    if public.portal_feedback_line(v_line) is null then raise exception 'portal:conflict'; end if;
  end if;
  insert into public.feedback_items(kind,title,body,line_id,build_seen,screen,created_by)
    values(v_kind,v_title,v_body,v_line,v_build,v_screen,p_actor) returning * into item;
  insert into public.feedback_reporters(item_id,tester_id) values(item.id,p_actor);
  perform public.portal_feedback_log(item.id,p_actor,'comment',v_body,jsonb_build_object('build',v_build,'source','report'));
  select * into item from public.feedback_items where id=item.id;
  return public.portal_feedback_dto(item,p_actor,false);
end; $$;

create function public.portal_feedback_mine(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.portal_tester_active(p_actor);
  select coalesce(jsonb_agg(public.portal_feedback_dto(i,p_actor,false)
      order by (i.status='question' or (i.status='fixed' and r.confirmed_at is null)) desc,i.updated_at desc,i.number desc),'[]') into result
    from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id and r.tester_id=p_actor;
  return jsonb_build_object('items',result);
end; $$;

create function public.portal_feedback_item(p_actor uuid,p_aal text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.portal_members; v_admin boolean; item public.feedback_items; v_line jsonb;
begin
  m:=public.portal_active(p_actor);
  if m.user_id is null then raise exception 'portal:forbidden'; end if;
  v_admin:=m.role in ('admin','owner');
  if v_admin then perform public.portal_require_admin(p_actor,p_aal); else perform public.portal_tester_active(p_actor); end if;
  if p_id is null or not public.portal_feedback_visible(p_actor,p_id) then raise exception 'portal:not_found'; end if;
  select * into item from public.feedback_items where id=p_id;
  if item.id is null then raise exception 'portal:not_found'; end if;
  if item.line_id is not null then v_line:=public.portal_feedback_line(item.line_id); end if;
  return jsonb_build_object('item',public.portal_feedback_dto(item,p_actor,v_admin),'line',v_line,'retired',item.line_id is not null and v_line is null,
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'itemId',e.item_id,'kind',e.kind,'body',e.body,'details',e.details,'createdAt',e.created_at,
      'actor',case when v_admin then coalesce(nullif(a.display_name,''),u.email,'') when e.actor_id=p_actor then 'you' when a.role in ('admin','owner') then 'quadrion' else 'tester' end)
      order by e.created_at,e.id),'[]')
      from public.feedback_events e join public.portal_members a on a.user_id=e.actor_id left join auth.users u on u.id=e.actor_id
      where e.item_id in (select public.portal_feedback_tree(p_id))),
    'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'itemId',f.item_id,'eventId',f.event_id,'filename',f.filename,'mime_type',f.mime_type,'bytes',f.bytes,'createdAt',f.created_at)
      order by f.created_at,f.id),'[]')
      from public.feedback_attachments f where f.state='verified' and f.item_id in (select public.portal_feedback_tree(p_id))));
end; $$;

create function public.portal_feedback_tester_action(p_actor uuid,p_id uuid,p_revision integer,p_action text,p_body text,p_build text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.feedback_items; reporter public.feedback_reporters; v_body text; v_next text; v_build text;
begin
  perform public.portal_tester_active(p_actor);
  if p_action is null or p_action not in ('comment','answer','confirm','reopen','title') then raise exception 'portal:invalid'; end if;
  select * into item from public.feedback_items where id=p_id for update;
  select * into reporter from public.feedback_reporters where item_id=p_id and tester_id=p_actor for update;
  if item.id is null or reporter.item_id is null then raise exception 'portal:not_found'; end if;
  v_body:=public.portal_feedback_note(p_body,16000,p_action<>'confirm');
  v_build:=public.portal_feedback_build_text(p_build,false);
  -- A second Confirm (double click, second tab) is a no-op, not an error.
  if p_action='confirm' and reporter.confirmed_at is not null then return public.portal_feedback_dto(item,p_actor,false); end if;
  if item.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
  if p_action='confirm' then
    item:=public.portal_feedback_confirm(p_id,p_actor,nullif(v_build,'unknown'));
    return public.portal_feedback_dto(item,p_actor,false);
  elsif p_action='comment' then
    if item.status='merged' then raise exception 'portal:conflict'; end if;
    perform public.portal_feedback_log(p_id,p_actor,'comment',v_body,'{}'::jsonb);
  elsif p_action='answer' then
    v_next:=public.portal_feedback_next_status(item.status,'answer');
    if v_next is null then raise exception 'portal:conflict'; end if;
    update public.feedback_items set status=v_next where id=p_id;
    perform public.portal_feedback_log(p_id,p_actor,'answer',v_body,'{}'::jsonb);
  elsif p_action='reopen' then
    v_next:=public.portal_feedback_next_status(item.status,'reopen');
    if v_next is null then raise exception 'portal:conflict'; end if;
    -- Sent back: every reporter has to confirm the next fix again.
    update public.feedback_reporters set confirmed_at=null,confirmed_build=null where item_id=p_id;
    update public.feedback_items set status=v_next where id=p_id;
    perform public.portal_feedback_log(p_id,p_actor,'reopen',v_body,jsonb_build_object('build',v_build,'fixedIn',item.fixed_in));
  else
    if item.created_by<>p_actor then raise exception 'portal:forbidden'; end if;
    if item.status not in ('new','triaged','question','reopened') then raise exception 'portal:conflict'; end if;
    v_body:=regexp_replace(v_body,'\s+',' ','g');
    if length(v_body)>200 then raise exception 'portal:invalid'; end if;
    update public.feedback_items set title=v_body where id=p_id;
    perform public.portal_feedback_log(p_id,p_actor,'title',v_body,jsonb_build_object('previous',item.title));
  end if;
  update public.feedback_items set owner_attention=true,revision=revision+1 where id=p_id returning * into item;
  return public.portal_feedback_dto(item,p_actor,false);
end; $$;

create function public.portal_feedback_counts(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.portal_members:=public.portal_active(p_actor); result jsonb;
begin
  if m.user_id is null or (m.tester is not true and m.role not in ('admin','owner')) then raise exception 'portal:forbidden'; end if;
  result:=jsonb_build_object('waiting',(select count(*) from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id
    where m.tester and r.tester_id=p_actor and (i.status='question' or (i.status='fixed' and r.confirmed_at is null))));
  if m.role in ('admin','owner') then
    result:=result||jsonb_build_object('inbox',(select count(*) from public.feedback_items where owner_attention and status in ('new','triaged','question','fixed','reopened')));
  end if;
  return result;
end; $$;

create function public.portal_feedback_inbox(p_actor uuid,p_aal text,p_filter jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_offset integer; total integer; result jsonb;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select count(*) into total from public.portal_feedback_match(p_filter);
  v_offset:=coalesce((p_filter->>'offset')::integer,0);
  select coalesce(jsonb_agg(public.portal_feedback_dto(i,p_actor,true) order by array_position(array['high','normal','low'],i.priority),i.created_at,i.number),'[]') into result
    from public.feedback_items i join (select m.id from public.portal_feedback_match(p_filter) m
      order by array_position(array['high','normal','low'],m.priority),m.created_at,m.number limit 100 offset v_offset) page on page.id=i.id;
  return jsonb_build_object('items',result,'total',total,'offset',v_offset);
end; $$;

create function public.portal_feedback_owner_action(p_actor uuid,p_aal text,p_id uuid,p_revision integer,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.feedback_items; kept public.feedback_items; d jsonb; v_next text; v_text text; v_into uuid;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if p_action is null or p_action not in ('priority','triage','ask','comment','park','decline','restore','fix','merge','seen') then raise exception 'portal:invalid'; end if;
  d:=public.portal_feedback_keys(p_data,case p_action when 'priority' then array['priority'] when 'ask' then array['body'] when 'comment' then array['body']
    when 'park' then array['reason'] when 'decline' then array['reason'] when 'fix' then array['build'] when 'merge' then array['into'] else array[]::text[] end);
  if p_action='merge' then
    v_into:=public.portal_feedback_uuid(public.portal_feedback_str(d,'into'));
    if v_into=p_id then raise exception 'portal:invalid'; end if;
    perform 1 from public.feedback_items where id in (p_id,v_into) order by id for update;
  end if;
  select * into item from public.feedback_items where id=p_id for update;
  if item.id is null then raise exception 'portal:not_found'; end if;
  -- Opening an item clears its inbox mark; it changes nothing a stale tab could trip over.
  if p_action='seen' then
    update public.feedback_items set owner_attention=false where id=p_id returning * into item;
    return public.portal_feedback_dto(item,p_actor,true);
  end if;
  if item.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
  if p_action='priority' then
    v_text:=public.portal_feedback_str(d,'priority');
    if v_text is null or v_text not in ('high','normal','low') then raise exception 'portal:invalid'; end if;
    if item.status='merged' then raise exception 'portal:conflict'; end if;
    update public.feedback_items set priority=v_text where id=p_id;
    perform public.portal_feedback_log(p_id,p_actor,'priority','',jsonb_build_object('from',item.priority,'to',v_text));
  elsif p_action='comment' then
    v_text:=public.portal_feedback_note(public.portal_feedback_str(d,'body'),16000,true);
    if item.status='merged' then raise exception 'portal:conflict'; end if;
    perform public.portal_feedback_log(p_id,p_actor,'comment',v_text,'{}'::jsonb);
  elsif p_action='merge' then
    select * into kept from public.feedback_items where id=v_into;
    if kept.id is null then raise exception 'portal:not_found'; end if;
    if public.portal_feedback_next_status(item.status,'merge') is null or kept.status not in ('new','triaged','question','fixed','reopened') then raise exception 'portal:conflict'; end if;
    insert into public.feedback_reporters(item_id,tester_id) select v_into,tester_id from public.feedback_reporters where item_id=p_id on conflict do nothing;
    update public.feedback_items set status='merged',merged_into=v_into where id=p_id;
    perform public.portal_feedback_log(p_id,p_actor,'merge','',jsonb_build_object('into',v_into,'number',kept.number));
    update public.feedback_items set revision=revision+1,updated_at=now() where id=v_into;
  else
    v_next:=public.portal_feedback_next_status(item.status,p_action);
    if p_action='ask' then
      v_text:=public.portal_feedback_note(public.portal_feedback_str(d,'body'),16000,true);
    elsif p_action in ('park','decline') then
      v_text:=public.portal_feedback_note(public.portal_feedback_str(d,'reason'),2000,p_action='decline');
    elsif p_action='fix' then
      v_text:=public.portal_feedback_build_text(public.portal_feedback_str(d,'build'),true);
    end if;
    if v_next is null then raise exception 'portal:conflict'; end if;
    update public.feedback_items set status=v_next,
      reason=case when p_action in ('park','decline') then v_text when p_action in ('restore','fix') then null else reason end,
      fixed_in=case when p_action='fix' then v_text else fixed_in end where id=p_id;
    if p_action='ask' then perform public.portal_feedback_log(p_id,p_actor,'question',v_text,'{}'::jsonb);
    elsif p_action='fix' then perform public.portal_feedback_log(p_id,p_actor,'fixed','',jsonb_build_object('build',v_text));
    else perform public.portal_feedback_log(p_id,p_actor,'status',case when p_action in ('park','decline') then v_text end,jsonb_build_object('from',item.status,'to',v_next));
    end if;
  end if;
  update public.feedback_items set owner_attention=false,revision=revision+1 where id=p_id returning * into item;
  return public.portal_feedback_dto(item,p_actor,true);
end; $$;

create function public.portal_feedback_bulk_fix(p_actor uuid,p_aal text,p_ids uuid[],p_build text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_ids uuid[]; v_build text; item public.feedback_items; n integer:=0;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  if p_ids is null or array_position(p_ids,null) is not null then raise exception 'portal:invalid'; end if;
  select array_agg(distinct x) into v_ids from unnest(p_ids) x;
  if v_ids is null or cardinality(v_ids)>200 then raise exception 'portal:invalid'; end if;
  v_build:=public.portal_feedback_build_text(p_build,true);
  -- All or nothing: any item that cannot be marked fixed rolls the whole call back.
  for item in select * from public.feedback_items where id=any(v_ids) order by id for update loop
    if public.portal_feedback_next_status(item.status,'fix') is null then raise exception 'portal:conflict'; end if;
    update public.feedback_items set status='fixed',fixed_in=v_build,reason=null,owner_attention=false,revision=revision+1 where id=item.id;
    perform public.portal_feedback_log(item.id,p_actor,'fixed','',jsonb_build_object('build',v_build));
    n:=n+1;
  end loop;
  if n<>cardinality(v_ids) then raise exception 'portal:not_found'; end if;
  return jsonb_build_object('fixed',n,'build',v_build,
    'bugs',(select count(*) from public.feedback_items where id=any(v_ids) and kind='bug'),
    'features',(select count(*) from public.feedback_items where id=any(v_ids) and kind='feature'),
    'testers',(select count(distinct tester_id) from public.feedback_reporters where item_id=any(v_ids)));
end; $$;

-- Open bugs for an AI agent. Roles only: no names, emails or member ids leave here.
create function public.portal_feedback_export(p_actor uuid,p_aal text,p_filter jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'kind',i.kind,'title',i.title,'body',i.body,'priority',i.priority,'status',i.status,
      'build',i.build_seen,'screen',i.screen,'lineId',i.line_id,
      -- The stored sub-points are Markdown, so they go out as subPlain (the formatter strips `sub` as HTML).
      'line',(select jsonb_build_object('plain',l->'plain','subPlain',l->'sub') from public.portal_feedback_line(i.line_id) l where l is not null),
      'retired',i.line_id is not null and public.portal_feedback_line(i.line_id) is null,
      'thread',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'body',e.body,'role',case when a.role in ('admin','owner') then 'quadrion' else 'tester' end) order by e.created_at,e.id),'[]')
        from public.feedback_events e join public.portal_members a on a.user_id=e.actor_id
        -- The report that opened the item is already its body.
        where e.item_id in (select public.portal_feedback_tree(i.id))
          and not (e.item_id=i.id and e.actor_id=i.created_by and e.kind in ('comment','import') and e.body=i.body)),
      'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'bucket',f.bucket,'object_path',f.object_path,'filename',f.filename,'mime_type',f.mime_type) order by f.created_at,f.id),'[]')
        from public.feedback_attachments f where f.state='verified' and f.item_id in (select public.portal_feedback_tree(i.id))))
    order by array_position(array['high','normal','low'],i.priority),i.created_at,i.number),'[]') into result
  from public.feedback_items i where i.id in (select m.id from public.portal_feedback_match(p_filter) m)
    and i.kind='bug' and i.status in ('new','triaged','question','reopened');
  return jsonb_build_object('items',result,'total',jsonb_array_length(result));
end; $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
    'portal_feedback_build_text','portal_feedback_note','portal_feedback_keys','portal_feedback_str','portal_feedback_uuid','portal_feedback_tree','portal_feedback_dto','portal_feedback_line','portal_feedback_match',
    'portal_feedback_create','portal_feedback_mine','portal_feedback_item','portal_feedback_tester_action','portal_feedback_counts','portal_feedback_inbox','portal_feedback_owner_action','portal_feedback_bulk_fix','portal_feedback_export') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('portal_feedback_create','portal_feedback_mine','portal_feedback_item','portal_feedback_tester_action','portal_feedback_counts','portal_feedback_inbox','portal_feedback_owner_action','portal_feedback_bulk_fix','portal_feedback_export')
      then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end; $$;
commit;
