-- MFT Lunch Picker: people sign up, ask to join a team, and the admin approves.
-- Everyone in a team shares the team's fixed filters and one ranked list per day.
-- The first account created becomes the admin.

-- ---------- tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '' check (char_length(display_name) <= 60),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  filters jsonb not null default '{}'::jsonb,
  filters_updated_by uuid references public.profiles (id) on delete set null,
  filters_updated_at timestamptz,
  created_at timestamptz not null default now()
);

-- One team per person. pending until the admin approves.
create table public.memberships (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);
create index memberships_team_status on public.memberships (team_id, status);

-- Each Run. The team's list for a day is its latest run that day (Montréal time).
create table public.team_runs (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  day date not null default ((now() at time zone 'America/Toronto')::date),
  run_at timestamptz not null default now(),
  run_by uuid references public.profiles (id) on delete set null,
  run_by_name text not null default '',
  origin jsonb not null,
  filters jsonb not null,
  suggestions jsonb not null,
  summary jsonb not null
);
create index team_runs_team_day on public.team_runs (team_id, day, run_at desc);

-- One row: the Google Maps key the searches use.
create table public.app_config (
  id int primary key default 1 check (id = 1),
  google_maps_key text not null default '',
  map_id text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------- helpers ----------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

-- The caller's approved team, or null.
create function public.my_team() returns uuid
language sql stable security definer set search_path = '' as $$
  select team_id from public.memberships where user_id = (select auth.uid()) and status = 'approved';
$$;

-- A profile for every new account; the very first one is the admin.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  lock table public.profiles in share row exclusive mode;
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 60),
    case when exists (select 1 from public.profiles) then 'member' else 'admin' end
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Who changed the team filters, and when, is set by the database.
create function public.stamp_team_filters() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.filters is distinct from old.filters then
    new.filters_updated_by := (select auth.uid());
    new.filters_updated_at := now();
  end if;
  return new;
end $$;
create trigger teams_stamp_filters before update on public.teams
  for each row execute function public.stamp_team_filters();

-- Approval time and approver are set by the database.
create function public.stamp_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.decided_at := now();
    new.decided_by := (select auth.uid());
  elsif new.status = 'pending' then
    new.decided_at := null;
    new.decided_by := null;
  end if;
  if tg_op = 'INSERT' then new.requested_at := now(); end if;
  return new;
end $$;
create trigger memberships_stamp before insert or update on public.memberships
  for each row execute function public.stamp_membership();

-- Who ran it, the day and the time are set by the database.
create function public.stamp_team_run() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.run_by := (select auth.uid());
  new.run_by_name := coalesce((select display_name from public.profiles where id = (select auth.uid())), '');
  new.run_at := now();
  new.day := (now() at time zone 'America/Toronto')::date;
  return new;
end $$;
create trigger team_runs_stamp before insert on public.team_runs
  for each row execute function public.stamp_team_run();

revoke execute on function public.handle_new_user(), public.stamp_team_filters(), public.stamp_membership(), public.stamp_team_run() from public, anon, authenticated;
revoke execute on function public.is_admin(), public.my_team() from public, anon;
grant execute on function public.is_admin(), public.my_team() to authenticated;

-- ---------- access ----------

revoke all on public.profiles, public.teams, public.memberships, public.team_runs, public.app_config from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, delete on public.teams to authenticated;
grant update (filters) on public.teams to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert on public.team_runs to authenticated;
grant select on public.app_config to authenticated;
grant update (google_maps_key, map_id, updated_at) on public.app_config to authenticated;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.memberships enable row level security;
alter table public.team_runs enable row level security;
alter table public.app_config enable row level security;

create policy "see yourself, your teammates, or everyone as admin" on public.profiles for select to authenticated
  using (
    id = (select auth.uid()) or (select public.is_admin())
    or exists (select 1 from public.memberships m where m.user_id = profiles.id and m.status = 'approved' and m.team_id = (select public.my_team()))
  );
create policy "edit your own name" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "signed-in people see the teams" on public.teams for select to authenticated using (true);
create policy "members edit their team's filters" on public.teams for update to authenticated
  using (id = (select public.my_team()) or (select public.is_admin()))
  with check (id = (select public.my_team()) or (select public.is_admin()));
create policy "admin creates teams" on public.teams for insert to authenticated with check ((select public.is_admin()));
create policy "admin deletes teams" on public.teams for delete to authenticated using ((select public.is_admin()));

create policy "see your own, your team's, or all as admin" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()) or (status = 'approved' and team_id = (select public.my_team())));
create policy "ask to join a team" on public.memberships for insert to authenticated
  with check (user_id = (select auth.uid()) and (status = 'pending' or (select public.is_admin())));
create policy "admin approves" on public.memberships for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "leave, cancel, or remove as admin" on public.memberships for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "a team sees its runs" on public.team_runs for select to authenticated
  using (team_id = (select public.my_team()) or (select public.is_admin()));
create policy "members run for their own team" on public.team_runs for insert to authenticated
  with check (team_id = (select public.my_team()));

create policy "approved people read the config" on public.app_config for select to authenticated
  using ((select public.my_team()) is not null or (select public.is_admin()));
create policy "admin edits the config" on public.app_config for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- live updates and starting data ----------

alter publication supabase_realtime add table public.team_runs, public.teams, public.memberships;

insert into public.app_config (id) values (1);
insert into public.teams (name) values ('MFT Platform');
