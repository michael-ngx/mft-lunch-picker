-- Contenders (the places a team puts forward for the game) and the game's pick:
-- one row per team per day, shared by everyone in the team. Changed only through
-- set_contender() and save_pick(), so two people clicking at once don't overwrite
-- each other.

create table public.team_days (
  team_id uuid not null references public.teams (id) on delete cascade,
  day date not null,
  contenders text[] not null default '{}' check (cardinality(contenders) <= 40),
  pick jsonb check (pick is null or pg_column_size(pick) < 32768),
  picked_by uuid references public.profiles (id) on delete set null,
  picked_by_name text not null default '',
  picked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (team_id, day)
);

revoke all on public.team_days from anon, authenticated;
grant select on public.team_days to authenticated;
alter table public.team_days enable row level security;
create policy "a team sees its days" on public.team_days for select to authenticated
  using (team_id = (select public.my_team()) or (select public.is_admin()));

-- Adds (p_on) or removes a place from today's contenders for the caller's team.
create function public.set_contender(p_place text, p_on boolean) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  d date := (now() at time zone 'America/Toronto')::date;
  r text[];
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  if p_place is null or char_length(p_place) not between 1 and 300 then raise exception 'Unknown place.'; end if;
  insert into public.team_days (team_id, day) values (t, d) on conflict do nothing;
  update public.team_days
     set contenders = case
           when p_on and not (p_place = any (contenders)) then array_append(contenders, p_place)
           when not p_on then array_remove(contenders, p_place)
           else contenders end,
         updated_at = now()
   where team_id = t and day = d
   returning contenders into r;
  return r;
end $$;

-- Saves the place a game picked as today's pick for the caller's team.
create function public.save_pick(p_pick jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  d date := (now() at time zone 'America/Toronto')::date;
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  if p_pick is null or jsonb_typeof(p_pick) <> 'object' then raise exception 'Nothing to save.'; end if;
  insert into public.team_days (team_id, day) values (t, d) on conflict do nothing;
  update public.team_days
     set pick = p_pick,
         picked_by = (select auth.uid()),
         picked_by_name = coalesce((select display_name from public.profiles where id = (select auth.uid())), ''),
         picked_at = now(),
         updated_at = now()
   where team_id = t and day = d;
end $$;

revoke execute on function public.set_contender(text, boolean), public.save_pick(jsonb) from public, anon;
grant execute on function public.set_contender(text, boolean), public.save_pick(jsonb) to authenticated;

alter publication supabase_realtime add table public.team_days;
