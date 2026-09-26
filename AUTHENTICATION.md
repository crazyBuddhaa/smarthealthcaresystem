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

## First administrator

Create the first administrator in Supabase Auth using the Dashboard or another
trusted server-side process. Set its user metadata to:

```json
{
  "username": "admin",
  "name": "System Admin",
  "role": "admin",
  "active": true
}
```

Use the internal staff email alias `admin@staff.carepoint.local` if the account
will be accessed with the existing `admin` staff ID field.

After the first administrator can sign in, new staff accounts should be
created from `staff-management.html`. The browser sends the request with the
administrator's Supabase access token; the server function verifies the role
before calling the Supabase Admin Auth API.

## Existing demo accounts

The old hardcoded accounts and the `hcms_students_auth`/
`hcms_staff_users` password records are no longer used. Existing demo users
must be recreated in Supabase Auth. Their old plaintext passwords should not
be migrated.

## Current boundary

This change moves identity, password hashing, session tokens, and staff-role
administration to Supabase Auth. The legacy `hcms_store` table still contains
the application's domain data and currently has broad public RLS policies.
Those policies must be replaced with user- and role-scoped policies before
storing real medical records.

## Registration document storage

Apply the migration
`supabase/migrations/20260926010000_add_registration_document_storage.sql`
to create the private `hcms-registration-documents` bucket. Student
registration receipts and passport photographs are uploaded directly to that
bucket using the student's Supabase access token. The workflow stores only the
object path and file metadata.

Staff do not receive direct public bucket access. The
`api/storage/registration.js` function verifies an active staff session and
returns a five-minute signed URL so authorized staff can open a document or
download it locally.