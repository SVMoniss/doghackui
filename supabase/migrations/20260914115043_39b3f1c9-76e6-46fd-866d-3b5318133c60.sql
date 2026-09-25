revoke execute on function public.has_role(uuid, public.app_role) from anon;
revoke execute on function public.owns_judge(uuid) from anon;
revoke execute on function public.owns_assignment(uuid) from anon;
revoke execute on function public.assigned_to_me(uuid) from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;
