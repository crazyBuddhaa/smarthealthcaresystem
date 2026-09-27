# CarePoint authentication

CarePoint now uses Supabase Auth for identity and password handling.

## Required server environment variables

Configure these in the Vercel/server environment:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` is used only by the Vercel functions under
`api/auth/`. It must never be returned by `api/config.js` or placed in a
browser script.

## Account identifiers

The existing UI continues to accept:

- A student matric number
- A staff ID
- An email address

The application maps matric numbers and staff IDs to internal Supabase Auth
email aliases. Students' real email addresses remain profile metadata and are
not required as their login identifier.

## Roles and trusted metadata

Each account's role (`admin`, `doctor`, `nurse`, `cashier`, `student` or
`unassigned`), its `active` flag and, for students, its `patientId` are stored
in the Supabase Auth **app_metadata**. Only the server (service-role key) can
change app_metadata, so users cannot raise their own access. The browser,
the serverless functions and the database policies all read the role from
app_metadata; user_metadata holds display details such as the name only.

## First administrator

Create the first administrator in Supabase Auth using the Dashboard with the
internal staff email alias `admin@staff.carepoint.local`, then run this in the
SQL editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role": "admin", "active": true}'::jsonb,
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  || '{"username": "admin", "name": "System Admin"}'::jsonb
where email = 'admin@staff.carepoint.local';
```

After the first administrator can sign in, new staff accounts should be
created from `staff-management.html`. The browser sends the request with the
administrator's Supabase access token; the server function verifies the role
before calling the Supabase Admin Auth API.

## Student sign-up

`api/auth/student.js` checks that the matric number is not already
registered, creates the Auth account and adds the student's profile to
`hcms_patients` in one request. If the profile cannot be saved, the new Auth
account is removed again.

## Existing demo accounts

The old hardcoded accounts and the `hcms_students_auth`/
`hcms_staff_users` password records are no longer used. Existing demo users
must be recreated in Supabase Auth. Their old plaintext passwords should not
be migrated.

## Data access rules

Apply `supabase/migrations/20260927000000_secure_data_access.sql`. It copies
existing roles into app_metadata and replaces the open `hcms_store` policies
with role-based rules:

- visitors who are not signed in have no access;
- active staff can read and write the operational data, and only the
  administrator can change the queue policy (`hcms_queue_settings`) and the
  faculty clinic calendar (`hcms_faculty_schedules`);
- students can read the shared data they need (not staff tasks) and can write
  only `hcms_patients`, `hcms_appointments`, `hcms_registration_workflows` and
  `hcms_bills`, which the student portal updates.

All users must sign in again after the migration so that their access token
carries the new app_metadata.

## Registration document storage

Apply the migration
`supabase/migrations/20260926010000_add_registration_document_storage.sql`
to create the private `hcms-registration-documents` bucket. Student
registration receipts and passport photographs are uploaded directly to that
bucket (`registration/<patientId>/`) using the student's Supabase access token.
Bill payment receipts are uploaded the same way to `receipts/<patientId>/`.
Students can upload only into their own folder. The workflow and the bill store
only the object path and file metadata.

Staff do not receive direct public bucket access. The
`api/storage/registration.js` function verifies an active staff session and
returns a five-minute signed URL so authorized staff can open a registration
document or payment receipt, or download it locally.