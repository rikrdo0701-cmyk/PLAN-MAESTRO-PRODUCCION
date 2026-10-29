-- Refuerza el permiso del RPC: SOLO service_role. Supabase otorga EXECUTE por
-- default ACL a anon/authenticated al crear la funcion; hay que quitarlo con
-- REVOKE nominado, porque el REVOKE FROM PUBLIC no toca esos grants directos.
--
-- MEDIDO 2026-10-01: ESTOS MISMOS PERMISOS YA ESTAN EN docs/rpc-ingesta-mirror.sql,
-- que es la copia CANONICA del RPC, asi que aplicar este archivo ya no cambia nada.
-- Se conserva porque es idempotente y porque `revoke all` es mas amplio que el
-- `revoke execute` de la copia canonica: si algun dia la funcion tuviera otro
-- privilegio, este sigue siendo el archivo que lo quita. Si cambias los permisos
-- del RPC, cambialos en la copia canonica.
revoke all on function public.ingesta_mirror(text, jsonb) from anon;
revoke all on function public.ingesta_mirror(text, jsonb) from authenticated;
revoke all on function public.ingesta_mirror(text, jsonb) from public;
grant execute on function public.ingesta_mirror(text, jsonb) to service_role;