-- Team testers: an active owner or admin always counts as a tester, with or without the tester flag.
-- Members still need the flag. Every tester check goes through public.portal_is_tester.
-- Idempotent: safe to run again. Run it in the Supabase SQL editor before deploying the site.
begin;

-- Internal: whether a membership row may use the tester side. The caller checks the membership is active
-- (public.portal_active, or status='active'); a null row is never a tester.
create or replace function public.portal_is_tester(p_member public.portal_members) returns boolean
language sql immutable security definer set search_path='' as $$
  select p_member.user_id is not null and (p_member.tester is true or coalesce(p_member.role in ('admin','owner'),false));
$$;

create or replace function public.portal_tester_active(p_actor uuid) returns public.portal_members
language plpgsql stable security definer set search_path='' as $$
declare m public.portal_members;
begin
  m:=public.portal_active(p_actor);
  if not public.portal_is_tester(m) then raise exception 'portal:forbidden'; end if;
  return m;
end; $$;

-- Waiting counts for flagged testers and for owners and admins alike.
create or replace function public.portal_feedback_counts(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.portal_members:=public.portal_active(p_actor); result jsonb;
begin
  if not public.portal_is_tester(m) then raise exception 'portal:forbidden'; end if;
  result:=jsonb_build_object('waiting',(select count(*) from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id
    where r.tester_id=p_actor and (i.status='question' or (i.status='fixed' and r.confirmed_at is null))));
  if m.role in ('admin','owner') then
    result:=result||jsonb_build_object('inbox',(select count(*) from public.feedback_items where owner_attention and status in ('new','triaged','question','fixed','reopened')));
  end if;
  return result;
end; $$;

-- Progress lists flagged testers, plus owners and admins once they have answered a line.
create or replace function public.portal_tests_progress(p_actor uuid,p_aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.test_content;
begin
  perform public.portal_require_admin(p_actor,p_aal);
  select * into c from public.test_content where current;
  return (with t as (
      select m.user_id,coalesce(nullif(m.display_name,''),u.email,'') as name from public.portal_members m join auth.users u on u.id=m.user_id
      where m.status='active' and public.portal_is_tester(m)
        and (m.tester or exists(select 1 from public.test_answers a where a.tester_id=m.user_id))),
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

-- The import target may be any tester, owners and admins included.
create or replace function public.portal_tests_import(p_actor uuid,p_aal text,p_tester uuid,p_results jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; entry record; v_status text; v_note text; v_at timestamptz; prev_at timestamptz; v_content uuid;
  n_imported integer:=0; n_skipped integer:=0; n_bugs integer:=0; n_retired integer:=0;
begin
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  if p_tester is null or not exists(select 1 from public.portal_active(p_tester) m where public.portal_is_tester(m)) then raise exception 'portal:invalid'; end if;
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
    -- The old board saved a fail on the click and only asked for the comment later, so keep those too.
    if v_status='fail' and v_note='' then v_note:='Marked failed on the earlier test board, without a comment.'; end if;
    if v_status is null or v_status not in ('pass','fail','skip') or length(entry.key)>200
      or entry.key !~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$' or length(v_note)>16000 then
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
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('portal_is_tester','portal_tester_active','portal_feedback_counts','portal_tests_progress','portal_tests_import') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('portal_feedback_counts','portal_tests_progress','portal_tests_import') then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end; $$;
commit;
