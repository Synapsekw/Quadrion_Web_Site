-- Membership foundation only. No portal endpoints or content access are enabled.
begin;

create table public.portal_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'member' check (role in ('member', 'admin', 'owner')),
  tier smallint,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'revoked')),
  expires_at timestamptz,
  display_name text not null default '' check (length(display_name) <= 120),
  company text not null default '' check (length(company) <= 160),
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  constraint portal_member_role_tier check (
    (role = 'member' and tier is not null and tier between 1 and 3)
    or (role in ('admin', 'owner') and tier is null)
  ),
  constraint portal_owner_no_expiry check (role <> 'owner' or expires_at is null)
);

create table public.portal_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  subject_id uuid,
  resource_id uuid,
  action text not null check (length(action) between 1 and 80),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index portal_events_created_at on public.portal_events(created_at desc);

alter table public.portal_members enable row level security;
alter table public.portal_members force row level security;
alter table public.portal_events enable row level security;
alter table public.portal_events force row level security;

-- Remove Supabase's default table grants. Deliberately no client RLS policies.
revoke all on public.portal_members, public.portal_events from public, anon, authenticated, service_role;
grant select on public.portal_members, public.portal_events to service_role;

comment on table public.portal_members is 'Authoritative portal roles and tiers. Browser clients have no direct access. Mutations require separately implemented trusted operations.';
comment on table public.portal_events is 'Portal audit records. Store safe event details only, never credentials or signed download URLs.';

commit;
