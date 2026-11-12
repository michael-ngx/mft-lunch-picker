-- The game log, where the team went, places never to suggest again, and each
-- place's history with the team (used to vary the suggestions).
--
-- team_days gains:
--   played   the contenders of every game played that day (merged, one entry per place)
--   players  who played a game that day; only they can set where the team went
--   went     the place the team went to, set with "We're going here today"

alter table public.team_days
  add column played jsonb not null default '[]'::jsonb
    check (jsonb_typeof(played) = 'array' and jsonb_array_length(played) <= 100 and pg_column_size(played) < 262144),
  add column players uuid[] not null default '{}' check (cardinality(players) <= 100),
  add column played_at timestamptz,
  add column went jsonb check (went is null or (jsonb_typeof(went) = 'object' and pg_column_size(went) < 16384)),
  add column went_by uuid references public.profiles (id) on delete set null,
  add column went_by_name text not null default '',
  add column went_at timestamptz;

-- A place as the log keeps it: only known keys, with an id and a name.
-- null when it is not a usable place.
create function public.clean_place(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'id') = 'string' and char_length(p ->> 'id') between 1 and 300
     and jsonb_typeof(p -> 'name') = 'string' and char_length(p ->> 'name') between 1 and 300
     and pg_column_size(p) < 8192
    then (select jsonb_object_agg(k, v) from jsonb_each(p) as e (k, v)
           where k in ('id', 'name', 'address', 'rating', 'ratingCount', 'price', 'priceLevel', 'type', 'mapsUrl', 'photos', 'pos', 'distanceM', 'walkMin'))
  end
$$;

-- Logs a game the caller is playing: its contenders join today's played list,
-- and the caller is recorded as a player.
create function public.log_game(p_places jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  d date := (now() at time zone 'America/Toronto')::date;
  u uuid := (select auth.uid());
  cleaned jsonb;
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  if p_places is null or jsonb_typeof(p_places) <> 'array' or jsonb_array_length(p_places) not between 2 and 40 then
    raise exception 'A game needs 2 to 40 places.';
  end if;
  select jsonb_agg(public.clean_place(e) order by o)
    into cleaned
    from jsonb_array_elements(p_places) with ordinality as a (e, o)
  having bool_and(public.clean_place(e) is not null);
  if cleaned is null then raise exception 'Unknown place.'; end if;

  insert into public.team_days (team_id, day) values (t, d) on conflict do nothing;
  update public.team_days td
     set played = (
           select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb)
             from (select distinct on (m.v ->> 'id') m.v, m.o
                     from (select a.v, a.o from jsonb_array_elements(td.played) with ordinality as a (v, o)
                           union all
                           select b.v, 1000 + b.o from jsonb_array_elements(cleaned) with ordinality as b (v, o)) m
                    order by m.v ->> 'id', m.o) x),
         players = case when u = any (td.players) then td.players else array_append(td.players, u) end,
         played_at = now(),
         updated_at = now()
   where td.team_id = t and td.day = d;
end $$;

-- Sets (or, with null, clears) where the team is going today. Only someone who
-- played a game today can do it, and only with a place from today's games.
create function public.confirm_went(p_place jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  d date := (now() at time zone 'America/Toronto')::date;
  u uuid := (select auth.uid());
  r public.team_days;
  c jsonb;
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  select * into r from public.team_days where team_id = t and day = d;
  if not found or not (u = any (r.players)) then
    raise exception 'Only someone who played today''s game can set where the team is going.';
  end if;
  if p_place is null then
    update public.team_days set went = null, went_by = null, went_by_name = '', went_at = null, updated_at = now()
     where team_id = t and day = d;
    return;
  end if;
  c := public.clean_place(p_place);
  if c is null then raise exception 'Unknown place.'; end if;
  if not exists (select 1 from jsonb_array_elements(r.played) e where e ->> 'id' = c ->> 'id') then
    raise exception 'That place was not in today''s game.';
  end if;
  update public.team_days
     set went = c,
         went_by = u,
         went_by_name = coalesce((select display_name from public.profiles where id = u), ''),
         went_at = now(),
         updated_at = now()
   where team_id = t and day = d;
end $$;

-- Places a team never wants suggested again. "Allow again" keeps the row with
-- lifted_at set, so live updates arrive as ordinary updates.
create table public.team_bans (
  team_id uuid not null references public.teams (id) on delete cascade,
  place_id text not null check (char_length(place_id) between 1 and 300),
  name text not null default '' check (char_length(name) <= 300),
  address text not null default '' check (char_length(address) <= 300),
  banned_by uuid references public.profiles (id) on delete set null,
  banned_by_name text not null default '',
  banned_at timestamptz not null default now(),
  lifted_by_name text not null default '',
  lifted_at timestamptz,
  primary key (team_id, place_id)
);

revoke all on public.team_bans from anon, authenticated;
grant select on public.team_bans to authenticated;
alter table public.team_bans enable row level security;
create policy "a team sees its never-again list" on public.team_bans for select to authenticated
  using (team_id = (select public.my_team()) or (select public.is_admin()));

-- Puts a place on (p_on) or takes it off the caller's team never-again list.
-- Putting it on also removes it from today's contenders.
create function public.set_ban(p_place text, p_name text, p_address text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  d date := (now() at time zone 'America/Toronto')::date;
  u uuid := (select auth.uid());
  who text := coalesce((select display_name from public.profiles where id = (select auth.uid())), '');
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  if p_place is null or char_length(p_place) not between 1 and 300 then raise exception 'Unknown place.'; end if;
  if p_on then
    if (select count(*) from public.team_bans where team_id = t and lifted_at is null) >= 1000 then
      raise exception 'The never-again list is full.';
    end if;
    insert into public.team_bans (team_id, place_id, name, address, banned_by, banned_by_name)
    values (t, p_place, left(coalesce(p_name, ''), 300), left(coalesce(p_address, ''), 300), u, who)
    on conflict (team_id, place_id) do update
      set name = excluded.name, address = excluded.address, banned_by = excluded.banned_by,
          banned_by_name = excluded.banned_by_name, banned_at = now(), lifted_by_name = '', lifted_at = null
      where public.team_bans.lifted_at is not null;
    update public.team_days set contenders = array_remove(contenders, p_place), updated_at = now()
     where team_id = t and day = d and p_place = any (contenders);
  else
    update public.team_bans set lifted_at = now(), lifted_by_name = who
     where team_id = t and place_id = p_place and lifted_at is null;
  end if;
end $$;

-- Each place's history with the caller's team, for the suggestions:
--   shown_today   lists today that showed it
--   shown_days    earlier days in the last 3 weeks whose lists showed it
--   played_days   days it was a contender in a game played (last year)
--   went_days     days the team went there (last year)
create function public.place_stats() returns table (
  place_id text, shown_today int, shown_days int, last_shown date,
  played_days int, last_played date, went_days int, last_went date
)
language sql stable security definer set search_path = '' as $$
  with ctx as (select public.my_team() as team, (now() at time zone 'America/Toronto')::date as today),
  shown as (
    select s ->> 'id' as place_id, r.day, count(*)::int as runs
      from ctx, public.team_runs r, jsonb_array_elements(case when jsonb_typeof(r.suggestions) = 'array' then r.suggestions else '[]'::jsonb end) s
     where r.team_id = ctx.team and r.day > ctx.today - 21
     group by 1, 2),
  played as (
    select distinct e ->> 'id' as place_id, td.day
      from ctx, public.team_days td, jsonb_array_elements(td.played) e
     where td.team_id = ctx.team and td.day > ctx.today - 365),
  went as (
    select td.went ->> 'id' as place_id, td.day
      from ctx, public.team_days td
     where td.team_id = ctx.team and td.went is not null and td.day > ctx.today - 365),
  sh as (
    select place_id,
           coalesce(sum(runs) filter (where day = ctx.today), 0)::int as today_runs,
           count(*) filter (where day < ctx.today)::int as days,
           max(day) filter (where day < ctx.today) as last_day
      from shown, ctx group by place_id),
  pl as (select place_id, count(*)::int as days, max(day) as last_day from played group by place_id),
  wt as (select place_id, count(*)::int as days, max(day) as last_day from went group by place_id),
  ids as (select place_id from sh union select place_id from pl union select place_id from wt)
  select ids.place_id,
         coalesce(sh.today_runs, 0), coalesce(sh.days, 0), sh.last_day,
         coalesce(pl.days, 0), pl.last_day,
         coalesce(wt.days, 0), wt.last_day
    from ids
    left join sh using (place_id)
    left join pl using (place_id)
    left join wt using (place_id)
   where ids.place_id is not null
$$;

revoke execute on function public.clean_place(jsonb) from public, anon, authenticated;
revoke execute on function public.log_game(jsonb), public.confirm_went(jsonb), public.set_ban(text, text, text, boolean), public.place_stats() from public, anon;
grant execute on function public.log_game(jsonb), public.confirm_went(jsonb), public.set_ban(text, text, text, boolean), public.place_stats() to authenticated;

alter publication supabase_realtime add table public.team_bans;
