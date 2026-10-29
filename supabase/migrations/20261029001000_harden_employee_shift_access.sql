-- Harden the newly created attendance table after project default privileges are applied.
revoke all privileges on table public.tp_employee_shifts from anon;
revoke delete, references, trigger, truncate on table public.tp_employee_shifts from authenticated;
grant select, insert, update on table public.tp_employee_shifts to authenticated;
grant all privileges on table public.tp_employee_shifts to service_role;
