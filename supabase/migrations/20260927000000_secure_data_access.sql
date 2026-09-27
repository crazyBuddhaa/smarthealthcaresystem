-- Secure data access for CarePoint.
--
-- 1. Copies each account's role, status and patient link into app_metadata,
--    which only the server can change. The application now trusts only
--    app_metadata for these values.
-- 2. Replaces the open hcms_store policies with role-based rules:
--      * visitors who are not signed in have no access;
--      * active staff can read and write the operational data, and only the
--        administrator can change the queue policy and faculty calendar;
--      * students can read the shared data they need (except staff tasks)
--        and can write only the collections the student portal updates.
-- 3. Lets students upload registration documents and bill receipts only into
--    their own folder of the private document bucket.
--
-- After applying this migration, every user must sign in again so that their
-- access token carries the new app_metadata.

-- ── 1. Trusted account metadata ─────────────────────────────────────────────
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
  'role', coalesce(raw_app_meta_data ->> 'role', raw_user_meta_data ->> 'role'),
  'active', coalesce(raw_app_meta_data -> 'active', raw_user_meta_data -> 'active', 'true'::jsonb),
  'patientId', coalesce(raw_app_meta_data -> 'patientId', raw_user_meta_data -> 'patientId')
))
where raw_user_meta_data ? 'role'
  and not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'role');

-- ── 2. Role helpers ─────────────────────────────────────────────────────────
create or replace function public.hcms_role()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', ''));
$$;

create or replace function public.hcms_active()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'active')::boolean, true);
$$;

create or replace function public.hcms_is_staff()
returns boolean
language sql
stable
as $$
  select public.hcms_role() in ('admin', 'doctor', 'nurse', 'cashier') and public.hcms_active();
$$;

create or replace function public.hcms_is_admin()
returns boolean
language sql
stable
as $$
  select public.hcms_role() = 'admin' and public.hcms_active();
$$;

create or replace function public.hcms_is_student()
returns boolean
language sql
stable
as $$
  select public.hcms_role() = 'student' and public.hcms_active();
$$;

-- ── 3. hcms_store policies ──────────────────────────────────────────────────
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
  with check (
    public.hcms_is_staff()
    and (key not in ('hcms_queue_settings', 'hcms_faculty_schedules') or public.hcms_is_admin())
  );

create policy hcms_store_staff_update
  on public.hcms_store for update
  to authenticated
  using (
    public.hcms_is_staff()
    and (key not in ('hcms_queue_settings', 'hcms_faculty_schedules') or public.hcms_is_admin())
  )
  with check (
    public.hcms_is_staff()
    and (key not in ('hcms_queue_settings', 'hcms_faculty_schedules') or public.hcms_is_admin())
  );

create policy hcms_store_student_read
  on public.hcms_store for select
  to authenticated
  using (public.hcms_is_student() and key <> 'hcms_staff_tasks');

create policy hcms_store_student_insert
  on public.hcms_store for insert
  to authenticated
  with check (
    public.hcms_is_student()
    and key in ('hcms_patients', 'hcms_appointments', 'hcms_registration_workflows', 'hcms_bills')
  );

create policy hcms_store_student_update
  on public.hcms_store for update
  to authenticated
  using (
    public.hcms_is_student()
    and key in ('hcms_patients', 'hcms_appointments', 'hcms_registration_workflows', 'hcms_bills')
  )
  with check (
    public.hcms_is_student()
    and key in ('hcms_patients', 'hcms_appointments', 'hcms_registration_workflows', 'hcms_bills')
  );

-- ── 4. Private document bucket ──────────────────────────────────────────────
drop policy if exists hcms_registration_documents_student_upload on storage.objects;
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
  );
