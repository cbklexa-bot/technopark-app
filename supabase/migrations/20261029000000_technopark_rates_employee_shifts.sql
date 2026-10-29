-- Technopark PRO: updated rental tariffs and employee shift accounting.
-- Existing tp_sessions rows are intentionally left unchanged so historical reports keep their original amounts.

create table if not exists public.tp_employee_shifts (
  work_date date primary key,
  day_type text not null check (day_type in ('weekday', 'weekend', 'holiday')),
  amount integer not null,
  is_holiday boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tp_employee_shifts_rate_matches_type check (
    (day_type = 'weekday' and amount = 1000 and is_holiday = false)
    or (day_type = 'weekend' and amount = 1500 and is_holiday = false)
    or (day_type = 'holiday' and amount = 2000 and is_holiday = true)
  )
);

alter table public.tp_employee_shifts enable row level security;

-- Supabase Data API no longer grants access to newly created public tables automatically.
grant select, insert, update, delete on public.tp_employee_shifts to authenticated;
grant all privileges on public.tp_employee_shifts to service_role;

drop policy if exists "allow_anonymous_tp_employee_shifts" on public.tp_employee_shifts;
create policy "allow_anonymous_tp_employee_shifts"
on public.tp_employee_shifts
for all
to authenticated
using (
  ((select (auth.jwt() ->> 'is_anonymous')::boolean) is true)
  or ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
)
with check (
  ((select (auth.jwt() ->> 'is_anonymous')::boolean) is true)
  or ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
);

create or replace function public.tp_start_session(
  p_client_name text,
  p_service_code text,
  p_duration integer,
  p_price integer
)
returns public.tp_sessions
language plpgsql
set search_path to 'public'
as $function$
declare
  v_price integer;
  v_finished boolean := false;
  v_finished_at timestamptz := null;
  v_session public.tp_sessions;
begin
  if nullif(btrim(p_client_name), '') is null then
    raise exception 'Введите имя клиента';
  end if;

  v_price := case
    when p_service_code = 'Полигон' and p_duration = 10 then 100
    when p_service_code = 'Полигон' and p_duration = 30 then 300
    when p_service_code = 'Полигон' and p_duration = 60 then 600
    when p_service_code = 'VR' and p_duration = 10 then 100
    when p_service_code = 'VR' and p_duration = 30 then 300
    when p_service_code = 'VR' and p_duration = 60 then 600
    when p_service_code = 'PS4' and p_duration = 30 then 200
    when p_service_code = 'PS4' and p_duration = 60 then 350
    when p_service_code = 'Дрифт/Вело' and p_duration = 10 then 150
    when p_service_code = 'Мини-тир' and p_duration = 0 then 150
    else null
  end;

  if v_price is null or v_price <> p_price then
    raise exception 'Недопустимый тариф услуги';
  end if;

  -- One mini-tir magazine is a one-time charge, not a timed rental.
  if p_service_code = 'Мини-тир' then
    v_finished := true;
    v_finished_at := now();
  end if;

  insert into public.tp_sessions (
    client_name, duration, price, type, service_code, finished, finished_at, people
  )
  values (
    btrim(p_client_name), p_duration, v_price, 'poly',
    p_service_code, v_finished, v_finished_at, 1
  )
  returning * into v_session;

  return v_session;
end;
$function$;

create or replace function public.tp_extend_session(
  p_session_id bigint,
  p_add_minutes integer
)
returns public.tp_sessions
language plpgsql
set search_path to 'public'
as $function$
declare
  v_session public.tp_sessions%rowtype;
  v_add_price integer;
begin
  select *
    into v_session
  from public.tp_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Аренда не найдена';
  end if;

  if v_session.finished = true then
    raise exception 'Аренда уже завершена';
  end if;

  if v_session.service_code = 'PS4' then
    v_add_price := case p_add_minutes
      when 30 then 200
      when 60 then 350
      else null
    end;
  elsif v_session.service_code = 'Дрифт/Вело' then
    v_add_price := case p_add_minutes when 10 then 150 else null end;
  elsif v_session.service_code = 'VR' then
    v_add_price := case p_add_minutes
      when 10 then 100
      when 30 then 300
      when 60 then 600
      else null
    end;
  elsif v_session.service_code = 'Полигон' then
    v_add_price := case p_add_minutes
      when 10 then 100
      when 30 then 300
      when 60 then 600
      else null
    end;
  else
    v_add_price := null;
  end if;

  if v_add_price is null then
    raise exception 'Для этой услуги такое продление недоступно';
  end if;

  update public.tp_sessions
  set duration = duration + p_add_minutes,
      price = price + v_add_price,
      finished = false
  where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$function$;
