-- Follow-up for databases that already applied 001. Run only on the intended
-- project. New installations also get the same ACL correction from 001.
begin;
revoke execute on function public.gpa_read_snapshot() from anon, public;
revoke execute on function public.gpa_replace_snapshot(jsonb,jsonb,jsonb,bigint) from anon, public;
grant execute on function public.gpa_read_snapshot() to authenticated;
grant execute on function public.gpa_replace_snapshot(jsonb,jsonb,jsonb,bigint) to authenticated;
commit;
