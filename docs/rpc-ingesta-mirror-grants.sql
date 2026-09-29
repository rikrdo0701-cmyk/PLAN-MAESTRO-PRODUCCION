-- Refuerza el permiso del RPC: SOLO service_role. Supabase otorga EXECUTE por
-- default ACL a anon/authenticated al crear la funcion; hay que quitarlo con
-- REVOKE nominado, porque el REVOKE FROM PUBLIC no toca esos grants directos.
revoke all on function public.ingesta_mirror(text, jsonb) from anon;
revoke all on function public.ingesta_mirror(text, jsonb) from authenticated;
revoke all on function public.ingesta_mirror(text, jsonb) from public;
grant execute on function public.ingesta_mirror(text, jsonb) to service_role;