-- Fix: student uploads were refused with "new row violates row-level security
-- policy".
--
-- Supabase Storage saves an upload with INSERT ... RETURNING *, so the new row
-- must pass a SELECT policy as well as the INSERT policy. Until now students had
-- only an INSERT policy on the document bucket. This policy lets an active
-- student read the objects in their own registration and receipts folders, which
-- is exactly what the upload needs. Staff still open documents only through the
-- five-minute signed links from api/storage/registration.js.

drop policy if exists hcms_documents_student_read_own on storage.objects;

create policy hcms_documents_student_read_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hcms-registration-documents'
    and (storage.foldername(name))[1] in ('registration', 'receipts')
    and (storage.foldername(name))[2] = (auth.jwt() -> 'app_metadata' ->> 'patientId')
    and public.hcms_is_student()
  );
