begin;
-- Raise the private software-release bucket's per-file limit to 10 GB (decimal) so large installers fit.
-- Matches the server default PORTAL_RELEASE_MAX_BYTES=10000000000. The project bucket and the global limit are unchanged.
update storage.buckets set file_size_limit=10000000000 where id='quadrion-software';
do $$
begin
  if not exists(select 1 from storage.buckets where id='quadrion-software' and file_size_limit=10000000000) then
    raise exception 'quadrion-software bucket not found';
  end if;
end $$;
commit;
