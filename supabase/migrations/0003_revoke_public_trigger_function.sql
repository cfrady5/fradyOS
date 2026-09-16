-- The signup trigger function is only ever run by the auth.users trigger; it must not be an RPC endpoint.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.bootstrap_user(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
