-- Role-scoped data access for CarePoint.
--
-- hcms_store keeps each collection (all patients, all bills, ...) as a single
-- JSON value, so a table policy cannot limit a student to their own entries
-- inside a collection. This migration therefore:
--
-- 1. Removes every student policy on hcms_store. Students no longer read or
--    write the table at all. The student portal uses the api/student/data.js
--    server function, which checks the student's token and returns or changes
--    only that student's own entries.
-- 2. Limits which staff roles may change each collection:
--      * hcms_queue_settings, hcms_faculty_schedules and the demonstration
--        data flags: administrator only;
--      * hcms_records (consultations): administrator, doctor and nurse;
--      * hcms_bills: administrator and cashier/reception;
--      * all other collections: any active staff member.
--    All active staff may still read every collection.
-- 3. Accepts a passport photograph upload only with a .jpg, .jpeg or .png
--    file name (the bucket itself also allows PDF files for the receipts).

-- ── 1. Write rules per collection ───────────────────────────────────────────
create or replace function public.hcms_can_write(store_key text)
returns boolean
language sql
stable
as $$
  select case
    when not public.hcms_is_staff() then false
    when public.hcms_is_admin() then true
    when store_key in ('hcms_queue_settings', 'hcms_faculty_schedules', 'hcms_seeded')
      or store_key like 'hcms\_synthetic\_%' then false
    when store_key = 'hcms_records' then public.hcms_role() in ('doctor', 'nurse')
    when store_key = 'hcms_bills' then public.hcms_role() = 'cashier'
    else true
  end;
$$;

-- ── 2. hcms_store policies ──────────────────────────────────────────────────
alter table public.hcms_store enable row level security;
revoke all on public.hcms_store from anon;
grant select, insert, update on public.hcms_store to authenticated;

drop policy if exists hcms_store_public_read on public.hcms_store;
drop policy if exists hcms_store_public_write on public.hcms_store;
drop policy if exists hcms_store_staff_read on public.hcms_store;
drop policy if exists hcms_store_staff_insert on public.hcms_store;
drop policy if exists hcms_store_staff_update on public.hcms_store;
drop policy if exists hcms_store_student_read on public.hcms_store;
drop policy if exists hcms_store_student_insert on public.hcms_store;
drop policy if exists hcms_store_student_update on public.hcms_store;

create policy hcms_store_staff_read
  on public.hcms_store for select
  to authenticated
  using (public.hcms_is_staff());

create policy hcms_store_staff_insert
  on public.hcms_store for insert
  to authenticated
  with check (public.hcms_can_write(key));

create policy hcms_store_staff_update
  on public.hcms_store for update
  to authenticated
  using (public.hcms_can_write(key))
  with check (public.hcms_can_write(key));

-- ── 3. Private document bucket ──────────────────────────────────────────────
drop policy if exists hcms_documents_student_upload on storage.objects;

create policy hcms_documents_student_upload
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hcms-registration-documents'
    and (storage.foldername(name))[1] in ('registration', 'receipts')
    and (storage.foldername(name))[2] = (auth.jwt() -> 'app_metadata' ->> 'patientId')
    and public.hcms_is_student()
    and (
      storage.filename(name) not like 'passportPhoto-%'
      or lower(storage.filename(name)) ~ '\.(jpe?g|png)$'
    )
  );
