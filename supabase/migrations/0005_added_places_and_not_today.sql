-- Places added to the list by hand, and places marked "Not today", for the
-- current lunch period. A period starts at 9 AM Montréal time and ends at 9 AM
-- the next day, so both lists empty themselves every morning at 9.
--
-- place_stats gains passed_days: earlier days in the last 3 weeks a place was
-- shown on a list but not a contender in a game that day.

create function public.lunch_period() returns date
language sql stable set search_path = '' as $$
  select ((now() at time zone 'America/Toronto') - interval '9 hours')::date
$$;

create table public.team_periods (
  team_id uuid not null references public.teams (id) on delete cascade,
  period date not null,
  added jsonb not null default '[]'::jsonb
    check (jsonb_typeof(added) = 'array' and jsonb_array_length(added) <= 30 and pg_column_size(added) < 524288),
  skipped jsonb not null default '[]'::jsonb
    check (jsonb_typeof(skipped) = 'array' and jsonb_array_length(skipped) <= 200 and pg_column_size(skipped) < 131072),
  updated_at timestamptz not null default now(),
  primary key (team_id, period)
);

revoke all on public.team_periods from anon, authenticated;
grant select on public.team_periods to authenticated;
alter table public.team_periods enable row level security;
create policy "a team sees its added and skipped places" on public.team_periods for select to authenticated
  using (team_id = (select public.my_team()) or (select public.is_admin()));

-- A place as added by hand: what a card and the map need. null when it is not usable.
create function public.clean_candidate(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'id') = 'string' and char_length(p ->> 'id') between 1 and 300
     and jsonb_typeof(p -> 'name') = 'string' and char_length(p ->> 'name') between 1 and 300
     and jsonb_typeof(p -> 'pos') = 'object'
     and pg_column_size(p) < 16384
    then (select jsonb_object_agg(k, v) from jsonb_each(p) as e (k, v)
           where k in ('id', 'name', 'pos', 'rating', 'ratingCount', 'price', 'priceLevel', 'openNow', 'status', 'type', 'address', 'mapsUrl', 'photos'))
  end
$$;

-- Drops the entry with this place id from a list of places.
create function public.without_place(list jsonb, place text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
    from jsonb_array_elements(list) with ordinality as a (e, o)
   where e ->> 'id' is distinct from place
$$;

-- Adds a place to the caller's team list for this period. It stays on the list
-- through every Filter until 9 AM, and is no longer marked Not today.
create function public.add_place(p_place jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  per date := public.lunch_period();
  u uuid := (select auth.uid());
  who text := coalesce((select display_name from public.profiles where id = (select auth.uid())), '');
  c jsonb := public.clean_candidate(p_place);
  cur jsonb;
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  if c is null then raise exception 'Unknown place.'; end if;
  insert into public.team_periods (team_id, period) values (t, per) on conflict do nothing;
  select added into cur from public.team_periods where team_id = t and period = per for update;
  if exists (select 1 from jsonb_array_elements(cur) e where e ->> 'id' = c ->> 'id') then
    update public.team_periods set skipped = public.without_place(skipped, c ->> 'id'), updated_at = now()
     where team_id = t and period = per;
    return;
  end if;
  if jsonb_array_length(cur) >= 30 then raise exception 'Up to 30 places can be added a day.'; end if;
  update public.team_periods
     set added = added || jsonb_build_array(c || jsonb_build_object('addedBy', u, 'addedByName', who, 'addedAt', now())),
         skipped = public.without_place(skipped, c ->> 'id'),
         updated_at = now()
   where team_id = t and period = per;
end $$;

-- Takes a place off this period's added places, or all of them when p_place is null.
create function public.remove_added(p_place text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  per date := public.lunch_period();
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  update public.team_periods
     set added = case when p_place is null then '[]'::jsonb else public.without_place(added, p_place) end,
         updated_at = now()
   where team_id = t and period = per;
end $$;

-- Marks a place Not today (p_on) for the caller's team until 9 AM, or brings it
-- back. Marking it also takes it off the added places and today's contenders.
create function public.skip_today(p_place text, p_name text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := public.my_team();
  per date := public.lunch_period();
  d date := (now() at time zone 'America/Toronto')::date;
  u uuid := (select auth.uid());
  who text := coalesce((select display_name from public.profiles where id = (select auth.uid())), '');
begin
  if t is null then raise exception 'You need to be in a team.'; end if;
  if p_place is null or char_length(p_place) not between 1 and 300 then raise exception 'Unknown place.'; end if;
  insert into public.team_periods (team_id, period) values (t, per) on conflict do nothing;
  if p_on then
    update public.team_periods
       set skipped = case
             when exists (select 1 from jsonb_array_elements(skipped) e where e ->> 'id' = p_place) then skipped
             else skipped || jsonb_build_array(jsonb_build_object('id', p_place, 'name', left(coalesce(p_name, ''), 300), 'by', u, 'byName', who, 'at', now()))
           end,
           added = public.without_place(added, p_place),
           updated_at = now()
     where team_id = t and period = per;
    update public.team_days set contenders = array_remove(contenders, p_place), updated_at = now()
     where team_id = t and day = d and p_place = any (contenders);
  else
    update public.team_periods set skipped = public.without_place(skipped, p_place), updated_at = now()
     where team_id = t and period = per;
  end if;
end $$;

-- place_stats with passed_days (the return type changes, so it is dropped and made again).
drop function public.place_stats();
create function public.place_stats() returns table (
  place_id text, shown_today int, shown_days int, last_shown date, passed_days int,
  played_days int, last_played date, went_days int, last_went date
)
language sql stable security definer set search_path = '' as $$
  with ctx as (select public.my_team() as team, (now() at time zone 'America/Toronto')::date as today),
  shown as (
    select s ->> 'id' as place_id, r.day, count(*)::int as runs
      from ctx, public.team_runs r, jsonb_array_elements(case when jsonb_typeof(r.suggestions) = 'array' then r.suggestions else '[]'::jsonb end) s
     where r.team_id = ctx.team and r.day > ctx.today - 365
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
           count(*) filter (where day < ctx.today and day > ctx.today - 21)::int as days,
           max(day) filter (where day < ctx.today) as last_day
      from shown, ctx group by place_id),
  passed as (
    select s.place_id, count(*)::int as days
      from shown s, ctx
     where s.day < ctx.today and s.day > ctx.today - 21
       and not exists (select 1 from played p where p.place_id = s.place_id and p.day = s.day)
     group by s.place_id),
  pl as (select place_id, count(*)::int as days, max(day) as last_day from played group by place_id),
  wt as (select place_id, count(*)::int as days, max(day) as last_day from went group by place_id),
  ids as (select place_id from sh union select place_id from pl union select place_id from wt)
  select ids.place_id,
         coalesce(sh.today_runs, 0), coalesce(sh.days, 0), sh.last_day, coalesce(passed.days, 0),
         coalesce(pl.days, 0), pl.last_day,
         coalesce(wt.days, 0), wt.last_day
    from ids
    left join sh using (place_id)
    left join passed using (place_id)
    left join pl using (place_id)
    left join wt using (place_id)
   where ids.place_id is not null
$$;

revoke execute on function public.clean_candidate(jsonb), public.without_place(jsonb, text) from public, anon, authenticated;
revoke execute on function public.add_place(jsonb), public.remove_added(text), public.skip_today(text, text, boolean), public.place_stats() from public, anon;
grant execute on function public.add_place(jsonb), public.remove_added(text), public.skip_today(text, text, boolean), public.place_stats() to authenticated;
grant execute on function public.lunch_period() to authenticated;

alter publication supabase_realtime add table public.team_periods;
