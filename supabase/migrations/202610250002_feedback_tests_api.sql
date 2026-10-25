-- Test content, tester answers, progress and the one-off answer import.
-- Trusted server API only: the actor is supplied by the server after the JWT check.
begin;

-- The tester's latest bug on a line that is still open, following merges to the kept item
-- when the tester reports it too. Null when there is none.
create function public.portal_test_own_bug(p_tester uuid,p_line text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare item public.feedback_items; depth integer:=0;
begin
  select i.* into item from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id and r.tester_id=p_tester
    where i.kind='bug' and i.line_id=p_line and i.status in ('new','triaged','question','fixed','reopened','merged')
    order by i.created_at desc,i.number desc limit 1;
  while item.status='merged' and depth<20 loop
    select * into item from public.feedback_items where id=item.merged_into; depth:=depth+1;
  end loop;
  if item.id is null or item.status not in ('new','triaged','question','fixed','reopened')
    or not exists(select 1 from public.feedback_reporters where item_id=item.id and tester_id=p_tester) then return null; end if;
  return item.id;
end; $$;

create function public.portal_tests_content_upload(p_actor uuid,p_aal text,p_model jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; v_id uuid; v_version integer; v_title text; v_testers jsonb; v_sub jsonb;
  stage jsonb; grp jsonb; line jsonb; v_line text; pos integer:=0; v_kept integer; v_retired integer;
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  if p_model is null or jsonb_typeof(p_model)<>'object' or p_model->>'format' is distinct from 'quadrion-test-content/1'
    or jsonb_typeof(p_model->'stages') is distinct from 'array' or jsonb_typeof(p_model->'title') is distinct from 'string' then raise exception 'portal:invalid'; end if;
  v_title:=trim(p_model->>'title');
  if length(v_title) not between 1 and 200 then raise exception 'portal:invalid'; end if;
  v_testers:=coalesce(p_model->'testers','[]'::jsonb);
  if jsonb_typeof(v_testers)<>'array' or exists(select 1 from jsonb_array_elements(v_testers) t(v)
    where jsonb_typeof(t.v)<>'object' or jsonb_typeof(t.v->'id') is distinct from 'string' or jsonb_typeof(t.v->'name') is distinct from 'string')
    then raise exception 'portal:invalid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.v->>'id','name',t.v->>'name') order by t.o),'[]'::jsonb) into v_testers
    from jsonb_array_elements(v_testers) with ordinality t(v,o);
  lock table public.test_content in exclusive mode;
  select coalesce(max(version),0)+1 into v_version from public.test_content;
  update public.test_content set current=false where current;
  insert into public.test_content(version,title,model,testers,line_count,current,uploaded_by)
    values(v_version,v_title,p_model-'testers',v_testers,0,true,p_actor) returning id into v_id;
  for stage in select s.v from jsonb_array_elements(p_model->'stages') s(v) loop
    if jsonb_typeof(stage)<>'object' or jsonb_typeof(stage->'groups') is distinct from 'array' then raise exception 'portal:invalid'; end if;
    for grp in select g.v from jsonb_array_elements(stage->'groups') g(v) loop
      if jsonb_typeof(grp)<>'object' or jsonb_typeof(grp->'items') is distinct from 'array' then raise exception 'portal:invalid'; end if;
      for line in select i.v from jsonb_array_elements(grp->'items') i(v) loop
        if jsonb_typeof(line)<>'object' or jsonb_typeof(line->'id') is distinct from 'string' or jsonb_typeof(line->'plain') is distinct from 'string' then raise exception 'portal:invalid'; end if;
        v_line:=line->>'id';
        if length(v_line)>200 or v_line !~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$'
          or exists(select 1 from public.test_lines where content_id=v_id and line_id=v_line) then raise exception 'portal:invalid'; end if;
        -- The Markdown sub-points (parallel to the HTML ones in the model) serve the server-side exports.
        v_sub:=case when jsonb_typeof(line->'subPlain')='array' then line->'subPlain' when jsonb_typeof(line->'sub')='array' then line->'sub' else '[]'::jsonb end;
        insert into public.test_lines(content_id,line_id,position,stage_id,stage_title,group_title,plain,html,sub)
          values(v_id,v_line,pos,coalesce(stage->>'id',''),coalesce(stage->>'title',''),coalesce(grp->>'title',''),line->>'plain',coalesce(line->>'html',''),v_sub);
        pos:=pos+1;
      end loop;
    end loop;
  end loop;
  if pos=0 then raise exception 'portal:invalid'; end if;
  update public.test_content set line_count=pos where id=v_id;
  select count(*) filter (where l.line_id is not null)::int,count(*) filter (where l.line_id is null)::int into v_kept,v_retired
    from public.test_answers a left join public.test_lines l on l.content_id=v_id and l.line_id=a.line_id;
  insert into public.portal_events(actor_id,action,details) values(p_actor,'test_content_uploaded',jsonb_build_object('version',v_version,'lines',pos));
  return jsonb_build_object('version',v_version,'lines',pos,'kept',v_kept,'retired',v_retired);
end; $$;

create function public.portal_tests_content_status(p_actor uuid,p_aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.test_content;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select * into c from public.test_content where current;
  return jsonb_build_object('version',c.version,'lines',coalesce(c.line_count,0),'uploadedAt',c.created_at,'testers',coalesce(c.testers,'[]'::jsonb),
    'retiredAnswers',(select count(*)::int from public.test_answers a where not exists(select 1 from public.test_lines l where l.content_id=c.id and l.line_id=a.line_id)));
end; $$;

create function public.portal_tests_content(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.test_content;
begin
  perform public.portal_tester_active(p_actor);
  select * into c from public.test_content where current;
  if c.id is null then return jsonb_build_object('version',null,'title','','unit','stage','guide','[]'::jsonb,'stages','[]'::jsonb); end if;
  return jsonb_build_object('version',c.version,'title',c.title,'unit',coalesce(c.model->>'unit','stage'),
    'guide',coalesce(c.model->'guide','[]'::jsonb),'stages',c.model->'stages');
end; $$;

create function public.portal_tests_answers(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.portal_tester_active(p_actor);
  return coalesce((select jsonb_agg(jsonb_build_object('lineId',a.line_id,'status',a.status,'comment',a.comment,'build',a.build,
    'updatedAt',a.updated_at,'itemId',public.portal_test_own_bug(p_actor,a.line_id)) order by a.line_id)
    from public.test_answers a where a.tester_id=p_actor),'[]'::jsonb);
end; $$;

create function public.portal_tests_answer(p_actor uuid,p_line text,p_status text,p_comment text,p_build text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare note text:=trim(coalesce(p_comment,'')); v_build text:=coalesce(nullif(trim(p_build),''),'unknown');
  prev public.test_answers; result public.test_answers; target public.feedback_items; item uuid; depth integer:=0;
begin
  perform public.portal_tester_active(p_actor);
  if p_line is null or length(p_line)>200 or p_line !~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$'
    or (p_status is not null and p_status not in ('pass','fail','skip')) or length(note)>16000
    or length(v_build)>80 or v_build !~ '^[0-9A-Za-z][0-9A-Za-z._+ -]*$' or (p_status='fail' and note='') then raise exception 'portal:invalid'; end if;
  -- Hold off a content upload until this answer is in, so a line cannot retire halfway.
  lock table public.test_content in share mode;
  if not exists(select 1 from public.test_lines l join public.test_content c on c.id=l.content_id where c.current and l.line_id=p_line) then
    raise exception 'portal:conflict'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-feedback-bug:'||p_actor::text||':'||p_line,0));
  select * into prev from public.test_answers where tester_id=p_actor and line_id=p_line for update;
  if p_status is null then
    delete from public.test_answers where tester_id=p_actor and line_id=p_line;
    return jsonb_build_object('answer',null,'itemId',public.portal_test_own_bug(p_actor,p_line));
  end if;
  insert into public.test_answers(tester_id,line_id,status,comment,build) values(p_actor,p_line,p_status,note,v_build)
    on conflict (tester_id,line_id) do update set status=excluded.status,comment=excluded.comment,build=excluded.build,updated_at=now();
  if p_status='fail' then
    -- The tester's latest bug on the line; a merged one leads to the kept item, a fixed one reopens.
    select i.* into target from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id and r.tester_id=p_actor
      where i.kind='bug' and i.line_id=p_line and i.status in ('new','triaged','question','fixed','reopened','merged')
      order by i.created_at desc,i.number desc limit 1 for update of i;
    while target.status='merged' and depth<20 loop
      select * into target from public.feedback_items where id=target.merged_into for update; depth:=depth+1;
    end loop;
    if target.id is null or target.status not in ('new','triaged','question','fixed','reopened') then
      item:=public.portal_feedback_open_bug(p_actor,p_line,note,v_build,'answer');
    else
      item:=target.id;
      insert into public.feedback_reporters(item_id,tester_id) values(item,p_actor) on conflict do nothing;
      if target.status='fixed' then
        update public.feedback_reporters set confirmed_at=null,confirmed_build=null where item_id=item;
        update public.feedback_items set status=public.portal_feedback_next_status(status,'reopen'),owner_attention=true,revision=revision+1 where id=item;
        perform public.portal_feedback_log(item,p_actor,'reopen',note,jsonb_build_object('build',v_build,'fixedIn',target.fixed_in,'source','answer'));
      else
        update public.feedback_items set owner_attention=true,revision=revision+1 where id=item;
        perform public.portal_feedback_log(item,p_actor,'comment',note,jsonb_build_object('build',v_build,'source','answer'));
      end if;
    end if;
  elsif p_status='pass' then
    select i.* into target from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id and r.tester_id=p_actor
      where i.kind='bug' and i.line_id=p_line and i.status in ('new','triaged','question','fixed','reopened')
      order by i.created_at desc,i.number desc limit 1 for update of i;
    item:=target.id;
    if target.status='fixed' then
      perform public.portal_feedback_confirm(item,p_actor,nullif(v_build,'unknown'));
      -- Confirming clears the comment; keep the one the tester just wrote.
      update public.test_answers set comment=note where tester_id=p_actor and line_id=p_line;
    elsif item is not null and prev.status is distinct from 'pass' then
      update public.feedback_items set owner_attention=true,revision=revision+1 where id=item;
      perform public.portal_feedback_log(item,p_actor,'line_passed','',jsonb_build_object('build',v_build));
    end if;
  end if;
  select * into result from public.test_answers where tester_id=p_actor and line_id=p_line;
  return jsonb_build_object('answer',jsonb_build_object('lineId',result.line_id,'status',result.status,'comment',result.comment,'build',result.build,'updatedAt',result.updated_at),
    'itemId',coalesce(item,public.portal_test_own_bug(p_actor,p_line)));
end; $$;

create function public.portal_tests_progress(p_actor uuid,p_aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.test_content;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select * into c from public.test_content where current;
  return (with t as (
      select m.user_id,coalesce(nullif(m.display_name,''),u.email,'') as name from public.portal_members m join auth.users u on u.id=m.user_id
      where m.tester and m.status='active'),
    s as (select l.stage_id,l.stage_title,min(l.position) as pos,count(*)::int as total from public.test_lines l where l.content_id=c.id group by l.stage_id,l.stage_title),
    ts as (select t.user_id,s.stage_id,s.stage_title,s.pos,s.total,count(a.line_id)::int as answered,
        count(*) filter (where a.status='pass')::int as n_pass,count(*) filter (where a.status='fail')::int as n_fail,count(*) filter (where a.status='skip')::int as n_skip,
        (array_agg(a.build order by a.updated_at desc) filter (where a.line_id is not null))[1] as last_build
      from t cross join s join public.test_lines l on l.content_id=c.id and l.stage_id=s.stage_id and l.stage_title=s.stage_title
      left join public.test_answers a on a.tester_id=t.user_id and a.line_id=l.line_id
      group by t.user_id,s.stage_id,s.stage_title,s.pos,s.total)
    select jsonb_build_object('version',c.version,
      'testers',coalesce((select jsonb_agg(jsonb_build_object('userId',t.user_id,'name',t.name,'stages',
        coalesce((select jsonb_agg(jsonb_build_object('stageId',ts.stage_id,'title',ts.stage_title,'total',ts.total,'answered',ts.answered,
          'pass',ts.n_pass,'fail',ts.n_fail,'skip',ts.n_skip,'lastBuild',ts.last_build) order by ts.pos) from ts where ts.user_id=t.user_id),'[]'::jsonb))
        order by t.name,t.user_id) from t),'[]'::jsonb),
      'retired',coalesce((select jsonb_agg(jsonb_build_object('userId',a.tester_id,'lineId',a.line_id,'status',a.status) order by a.tester_id,a.line_id)
        from public.test_answers a where not exists(select 1 from public.test_lines l where l.content_id=c.id and l.line_id=a.line_id)),'[]'::jsonb)));
end; $$;

-- Imports one tester's results map from a quadrion-test-results/1 file: { "<line id>": { s, c, t } }.
create function public.portal_tests_import(p_actor uuid,p_aal text,p_tester uuid,p_results jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; entry record; v_status text; v_note text; v_at timestamptz; prev_at timestamptz; v_content uuid;
  n_imported integer:=0; n_skipped integer:=0; n_bugs integer:=0; n_retired integer:=0;
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  if p_tester is null or not exists(select 1 from public.portal_active(p_tester) m where m.user_id is not null and m.tester) then raise exception 'portal:invalid'; end if;
  if p_results is null or jsonb_typeof(p_results)<>'object' or (select count(*) from jsonb_object_keys(p_results))>20000 then raise exception 'portal:invalid'; end if;
  lock table public.test_content in share mode;
  select id into v_content from public.test_content where current;
  for entry in select e.key,e.value from jsonb_each(p_results) e order by e.key loop
    v_status:=null; v_note:=''; v_at:=null;
    if jsonb_typeof(entry.value)='object' then
      v_status:=case when jsonb_typeof(entry.value->'s')='string' then entry.value->>'s' end;
      v_note:=trim(case when jsonb_typeof(entry.value->'c')='string' then entry.value->>'c' else '' end);
      begin v_at:=nullif(trim(entry.value->>'t'),'')::timestamptz; exception when others then v_at:=null; end;
    end if;
    if v_status is null or v_status not in ('pass','fail','skip') or length(entry.key)>200
      or entry.key !~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$' or length(v_note)>16000 or (v_status='fail' and v_note='') then
      n_skipped:=n_skipped+1; continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('portal-feedback-bug:'||p_tester::text||':'||entry.key,0));
    select updated_at into prev_at from public.test_answers where tester_id=p_tester and line_id=entry.key for update;
    -- Only fill a gap or replace an answer older than the imported one, so a second import is a no-op.
    if found and (v_at is null or prev_at>=v_at) then n_skipped:=n_skipped+1; continue; end if;
    insert into public.test_answers(tester_id,line_id,status,comment,build,updated_at) values(p_tester,entry.key,v_status,v_note,'unknown',coalesce(v_at,now()))
      on conflict (tester_id,line_id) do update set status=excluded.status,comment=excluded.comment,build=excluded.build,updated_at=excluded.updated_at;
    n_imported:=n_imported+1;
    if not exists(select 1 from public.test_lines where content_id=v_content and line_id=entry.key) then n_retired:=n_retired+1; end if;
    if v_status='fail' then perform public.portal_feedback_open_bug(p_tester,entry.key,v_note,'unknown','import'); n_bugs:=n_bugs+1; end if;
  end loop;
  insert into public.portal_events(actor_id,subject_id,action,details) values(p_actor,p_tester,'test_answers_imported',
    jsonb_build_object('imported',n_imported,'skipped',n_skipped,'bugs',n_bugs,'retired',n_retired));
  return jsonb_build_object('imported',n_imported,'skipped',n_skipped,'bugs',n_bugs,'retired',n_retired);
end; $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('portal_test_own_bug','portal_tests_content_upload','portal_tests_content_status','portal_tests_content','portal_tests_answers','portal_tests_answer','portal_tests_progress','portal_tests_import') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname<>'portal_test_own_bug' then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end; $$;
commit;
