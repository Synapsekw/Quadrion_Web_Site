-- Tester feedback foundation: tester flag, test content, answers and feedback items.
-- Trusted server API only: no browser grants, no RLS policies, actor supplied by the server.
begin;

alter table public.portal_members add column tester boolean not null default false;

create table public.test_content (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version>0),
  title text not null check (length(trim(title)) between 1 and 200),
  model jsonb not null,
  testers jsonb not null default '[]'::jsonb,
  line_count integer not null check (line_count>=0),
  current boolean not null default false,
  uploaded_by uuid not null references public.portal_members(user_id),
  created_at timestamptz not null default now()
);
create unique index test_content_current on public.test_content(current) where current;

create table public.test_lines (
  content_id uuid not null references public.test_content(id),
  line_id text not null check (length(line_id)<=200 and line_id ~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$'),
  position integer not null check (position>=0),
  stage_id text not null default '',
  stage_title text not null default '',
  group_title text not null default '',
  plain text not null,
  html text not null default '',
  sub jsonb not null default '[]'::jsonb,
  primary key(content_id,line_id)
);

create table public.test_answers (
  tester_id uuid not null references public.portal_members(user_id),
  line_id text not null check (length(line_id)<=200 and line_id ~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$'),
  status text not null check (status in ('pass','fail','skip')),
  comment text not null default '' check (length(comment)<=16000),
  build text not null check (build=trim(build) and length(build) between 1 and 80 and build ~ '^[0-9A-Za-z][0-9A-Za-z._+ -]*$'),
  updated_at timestamptz not null default now(),
  primary key(tester_id,line_id),
  constraint test_answer_fail_comment check (status<>'fail' or length(trim(comment))>0)
);

create table public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  kind text not null check (kind in ('bug','feature')),
  title text not null check (length(trim(title)) between 1 and 200),
  body text not null default '' check (length(body)<=16000),
  line_id text check (line_id is null or (length(line_id)<=200 and line_id ~ '^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$')),
  build_seen text not null check (build_seen=trim(build_seen) and length(build_seen) between 1 and 80 and build_seen ~ '^[0-9A-Za-z][0-9A-Za-z._+ -]*$'),
  screen text check (screen is null or length(screen) between 1 and 80),
  priority text not null default 'normal' check (priority in ('high','normal','low')),
  status text not null default 'new' check (status in ('new','triaged','question','fixed','confirmed','reopened','parked','declined','merged')),
  merged_into uuid references public.feedback_items(id),
  fixed_in text check (fixed_in is null or (fixed_in=trim(fixed_in) and length(fixed_in) between 1 and 80 and fixed_in ~ '^[0-9A-Za-z][0-9A-Za-z._+ -]*$')),
  reason text check (reason is null or length(reason)<=2000),
  created_by uuid not null references public.portal_members(user_id),
  owner_attention boolean not null default true,
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_merge_target check ((status='merged')=(merged_into is not null) and merged_into is distinct from id)
);
create index feedback_items_line on public.feedback_items(line_id) where line_id is not null;
create index feedback_items_status on public.feedback_items(status,updated_at desc);

create table public.feedback_reporters (
  item_id uuid not null references public.feedback_items(id),
  tester_id uuid not null references public.portal_members(user_id),
  confirmed_build text check (confirmed_build is null or (confirmed_build=trim(confirmed_build) and length(confirmed_build) between 1 and 80 and confirmed_build ~ '^[0-9A-Za-z][0-9A-Za-z._+ -]*$')),
  confirmed_at timestamptz,
  added_at timestamptz not null default now(),
  primary key(item_id,tester_id)
);
create index feedback_reporters_tester on public.feedback_reporters(tester_id,item_id);

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.feedback_items(id),
  actor_id uuid not null references public.portal_members(user_id),
  kind text not null check (kind in ('comment','question','answer','status','priority','merge','fixed','confirm','reopen','title','line_passed','import')),
  body text not null default '' check (length(body)<=16000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);
create index feedback_events_item on public.feedback_events(item_id,created_at);

create table public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.feedback_items(id),
  event_id uuid references public.feedback_events(id),
  uploader_id uuid not null references public.portal_members(user_id),
  bucket text not null default 'quadrion-feedback' check (bucket='quadrion-feedback'),
  object_path text not null unique check (length(object_path) between 1 and 500 and object_path !~ '(^/|\.\.)'),
  filename text not null check (length(filename) between 1 and 200 and filename !~ '[/\\]'),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','video/mp4','video/webm','application/zip')),
  bytes bigint not null check (bytes>0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending','verifying','verified','failed','abandoned')),
  verified_bytes bigint not null default 0 check (verified_bytes>=0),
  hash_state text,
  object_etag text,
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts>=0),
  error_code text,
  expires_at timestamptz not null default (now()+interval '24 hours'),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint feedback_attachment_size check (bytes <= case when mime_type like 'image/%' then 10000000 when mime_type like 'video/%' then 100000000 else 50000000 end)
);
create index feedback_attachments_item on public.feedback_attachments(item_id,state);

create function public.portal_tester_active(p_actor uuid) returns public.portal_members
language plpgsql stable security definer set search_path='' as $$
declare m public.portal_members;
begin
  m:=public.portal_active(p_actor);
  if m.user_id is null or m.tester is not true then raise exception 'portal:forbidden'; end if;
  return m;
end; $$;

create function public.portal_feedback_visible(p_actor uuid,p_item uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.portal_active(p_actor) m where m.user_id is not null
    and (m.role in ('admin','owner') or exists(select 1 from public.feedback_reporters r where r.item_id=p_item and r.tester_id=p_actor)));
$$;

-- The one place status moves are defined. Null means the move is not allowed.
create function public.portal_feedback_next_status(p_from text,p_action text) returns text
language sql immutable security definer set search_path='' as $$
  select case
    when p_action='triage' and p_from in ('new','reopened') then 'triaged'
    when p_action='ask' and p_from in ('new','triaged','reopened') then 'question'
    when p_action='answer' and p_from='question' then 'triaged'
    when p_action='fix' and p_from in ('new','triaged','question','fixed','reopened') then 'fixed'
    when p_action='confirm' and p_from='fixed' then 'confirmed'
    when p_action='reopen' and p_from='fixed' then 'reopened'
    when p_action='park' and p_from in ('new','triaged','question','reopened') then 'parked'
    when p_action='decline' and p_from in ('new','triaged','question','reopened') then 'declined'
    when p_action='restore' and p_from in ('parked','declined') then 'triaged'
    when p_action='merge' and p_from in ('new','triaged','question','reopened') then 'merged'
  end;
$$;

create function public.portal_feedback_log(p_item uuid,p_actor uuid,p_kind text,p_body text,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  insert into public.feedback_events(item_id,actor_id,kind,body,details)
    values(p_item,p_actor,p_kind,coalesce(p_body,''),coalesce(p_details,'{}'::jsonb)) returning id into result;
  update public.feedback_items set updated_at=now() where id=p_item;
  return result;
end; $$;

-- A failed line adds to the tester's open bug on that line, or files a new one.
create function public.portal_feedback_open_bug(p_tester uuid,p_line text,p_comment text,p_build text,p_source text) returns uuid
language plpgsql security definer set search_path='' as $$
declare item uuid; note text:=trim(coalesce(p_comment,'')); v_build text:=coalesce(nullif(trim(p_build),''),'unknown');
  v_kind text:=case p_source when 'import' then 'import' when 'answer' then 'comment' end;
begin
  perform public.portal_tester_active(p_tester);
  if note='' or v_kind is null or p_line is null then raise exception 'portal:invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-feedback-bug:'||p_tester::text||':'||p_line,0));
  select i.id into item from public.feedback_items i join public.feedback_reporters r on r.item_id=i.id and r.tester_id=p_tester
    where i.kind='bug' and i.line_id=p_line and i.status in ('new','triaged','question','fixed','reopened')
    order by i.created_at desc,i.number desc limit 1 for update of i;
  if item is null then
    insert into public.feedback_items(kind,title,body,line_id,build_seen,created_by)
      values('bug',left(trim(split_part(replace(note,E'\r',''),E'\n',1)),120),note,p_line,v_build,p_tester) returning id into item;
    insert into public.feedback_reporters(item_id,tester_id) values(item,p_tester);
  else
    update public.feedback_items set owner_attention=true,revision=revision+1 where id=item;
  end if;
  perform public.portal_feedback_log(item,p_tester,v_kind,note,jsonb_build_object('build',v_build,'source',p_source));
  return item;
end; $$;

-- One reporter confirms a fixed item. The item is confirmed once every reporter has.
create function public.portal_feedback_confirm(p_item uuid,p_tester uuid,p_build text) returns public.feedback_items
language plpgsql security definer set search_path='' as $$
declare item public.feedback_items; reporter public.feedback_reporters; v_build text;
begin
  select * into item from public.feedback_items where id=p_item for update;
  if item.id is null then raise exception 'portal:not_found'; end if;
  select * into reporter from public.feedback_reporters where item_id=p_item and tester_id=p_tester for update;
  if reporter.item_id is null then raise exception 'portal:forbidden'; end if;
  if reporter.confirmed_at is not null then return item; end if;
  if public.portal_feedback_next_status(item.status,'confirm') is null then raise exception 'portal:conflict'; end if;
  v_build:=coalesce(nullif(trim(p_build),''),item.fixed_in,'unknown');
  update public.feedback_reporters set confirmed_build=v_build,confirmed_at=now() where item_id=p_item and tester_id=p_tester;
  perform public.portal_feedback_log(p_item,p_tester,'confirm','',jsonb_build_object('build',v_build));
  if item.kind='bug' and item.line_id is not null then
    insert into public.test_answers(tester_id,line_id,status,comment,build) values(p_tester,item.line_id,'pass','',v_build)
      on conflict (tester_id,line_id) do update set status='pass',comment='',build=excluded.build,updated_at=now();
  end if;
  update public.feedback_items set owner_attention=true,revision=revision+1,
    status=case when exists(select 1 from public.feedback_reporters where item_id=p_item and confirmed_at is null) then status else 'confirmed' end
    where id=p_item returning * into item;
  return item;
end; $$;

create function public.portal_member_tester(p_actor uuid,p_aal text,p_target uuid,p_revision integer,p_tester boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.portal_members; old public.portal_members; result public.portal_members;
begin
  lock table public.portal_members in share row exclusive mode;
  actor:=public.portal_require_admin(p_actor,p_aal);
  if actor.role<>'owner' then raise exception 'portal:forbidden'; end if;
  if p_tester is null then raise exception 'portal:invalid'; end if;
  select * into old from public.portal_members where user_id=p_target;
  if old.user_id is null then raise exception 'portal:not_found'; end if;
  if old.revision is distinct from p_revision then raise exception 'portal:conflict'; end if;
  update public.portal_members set tester=p_tester,updated_at=now(),revision=revision+1 where user_id=p_target returning * into result;
  insert into public.portal_events(actor_id,subject_id,action,details) values(p_actor,p_target,'member_tester_changed',jsonb_build_object('tester',p_tester));
  return to_jsonb(result);
end; $$;

do $$ declare t text; f record; begin
  foreach t in array array['test_content','test_lines','test_answers','feedback_items','feedback_reporters','feedback_events','feedback_attachments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('portal_tester_active','portal_feedback_visible','portal_feedback_next_status','portal_feedback_log','portal_feedback_open_bug','portal_feedback_confirm','portal_member_tester') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname='portal_member_tester' then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end; $$;
commit;
