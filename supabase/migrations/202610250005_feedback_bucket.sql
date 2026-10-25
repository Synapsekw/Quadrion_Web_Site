begin;
-- Private bucket for tester feedback attachments. The per-file limit is the largest type (video, 100 MB);
-- the smaller image and diagnostics caps are enforced by the API and the attachment table.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('quadrion-feedback','quadrion-feedback',false,100000000,array['image/png','image/jpeg','image/webp','video/mp4','video/webm','application/zip'])
  on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
do $$
begin
  if not exists(select 1 from storage.buckets where id='quadrion-feedback' and public=false and file_size_limit=100000000) then
    raise exception 'quadrion-feedback bucket not found';
  end if;
end $$;
commit;
