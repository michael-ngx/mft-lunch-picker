-- place_stats: last_shown now looks back a year (shown_days still counts the last
-- 3 weeks), so "New for the team" means not shown in a year and never played.
create or replace function public.place_stats() returns table (
  place_id text, shown_today int, shown_days int, last_shown date,
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
