-- Enable deletion of mistaken employee attendance entries from the admin journal.
grant delete on table public.tp_employee_shifts to authenticated;

-- Delete a product sale and put the sold unit back into stock atomically.
-- SECURITY INVOKER (default) keeps the existing RLS policies in force.
create or replace function public.tp_delete_sale(p_sale_id bigint)
returns public.tp_sales
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale public.tp_sales%rowtype;
begin
  select *
    into v_sale
  from public.tp_sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Продажа не найдена';
  end if;

  -- If the stock card still exists, restore the exact sold unit.
  update public.tp_stock
  set qty = qty + 1
  where id = v_sale.item_id;

  delete from public.tp_sales
  where id = p_sale_id;

  return v_sale;
end;
$function$;

grant execute on function public.tp_delete_sale(bigint) to authenticated;
