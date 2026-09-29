# CarePoint authentication

CarePoint now uses Supabase Auth for identity and password handling.

## Required server environment variables

Configure these in the Vercel/server environment:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Optional: `CAREPOINT_TIME_ZONE` (default `Africa/Lagos`) sets the clinic time
zone the server uses when it assigns a student appointment.

`SUPABASE_SERVICE_ROLE_KEY` is used only by the Vercel functions under
`api/auth/`, `api/storage/` and `api/student/`. It must never be returned by `api/config.js` or placed in a
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

Apply the migrations in order:

1. `supabase/migrations/20260927000000_secure_data_access.sql` copies existing
   roles into app_metadata and replaces the open `hcms_store` policies.
2. `supabase/migrations/20260928000000_role_scoped_data_access.sql` replaces
   those policies with the current rules:

- visitors who are not signed in have no access;
- students have **no direct access** to `hcms_store`. The student portal calls
  `api/student/data.js`, which verifies the student's token, reads the patient
  link from app_metadata and returns or changes only that student's own
  entries (profile, appointments, consultation records, bills and
  registration workflow). The student actions it accepts are: completing the
  health centre form, assigning the registration appointment, attaching a
  payment receipt to a pending bill, and requesting a reschedule;
- all active staff can read every collection;
- writes are limited by role: the administrator can change every collection;
  consultation records (`hcms_records`) can also be changed by doctors and
  nurses; bills (`hcms_bills`) also by cashier/reception; the queue policy,
  faculty calendar and demonstration data flags by the administrator only;
  all other collections by any active staff member.

The staff pages apply the same limits: `billing.html` and `register.html` open
only for the administrator and cashier/reception, `records.html` only for the
administrator, doctors and nurses, and `staff-management.html` and
`queue-settings.html` only for the administrator. The side menu is built for
each role from one definition in `app.js` (`SIDEBAR_SECTIONS`), so it only
lists pages the signed-in user can open. Demonstration data is loaded
only when the administrator signs in.

All users must sign in again after the first migration so that their access
token carries the new app_metadata.

### Remaining limitation

Each collection is still stored as one JSON value. Two staff members saving
the same collection at nearly the same time can overwrite each other's
change, and a staff save can overwrite a change a student made through the
server function in between. Moving the collections into separate relational
tables is the recommended next step.

## Registration document storage

Apply the migration
`supabase/migrations/20260926010000_add_registration_document_storage.sql`
to create the private `hcms-registration-documents` bucket. Student
registration receipts and passport photographs are uploaded directly to that
bucket (`registration/<patientId>/`) using the student's Supabase access token.
Bill payment receipts are uploaded the same way to `receipts/<patientId>/`.
Students can upload only into their own folder, and a passport photograph is
accepted only with a `.jpg`, `.jpeg` or `.png` file name. The workflow and the
bill store only the object path and file metadata, which the student portal
saves through `api/student/data.js`.

Staff do not receive direct public bucket access. The
`api/storage/registration.js` function verifies an active staff session and
returns a five-minute signed URL so authorized staff can open a registration
document or payment receipt, or download it locally.