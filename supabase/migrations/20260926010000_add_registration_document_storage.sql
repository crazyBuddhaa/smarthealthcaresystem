-- Private storage for student registration receipts and passport photographs.
-- Students may upload only into their own patient folder. Staff access is
-- provided through the server-side signed-URL endpoint.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'hcms-registration-documents',
  'hcms-registration-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists hcms_registration_documents_student_upload
  on storage.objects;

create policy hcms_registration_documents_student_upload
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hcms-registration-documents'
    and (storage.foldername(name))[1] = 'registration'
    and (storage.foldername(name))[2] =
      (auth.jwt() -> 'user_metadata' ->> 'patientId')
  );