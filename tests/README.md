# CarePoint tests

Automated checks for the rules the server and database enforce.

| Test | What it checks | Run |
|---|---|---|
| `scheduling.test.js` | Appointment search (weekdays, past times, 30-minute gap, today's queue, faculty calendar, 60-day limit) and the health card rule | `node tests/scheduling.test.js` |
| `student-data.test.js` | `api/student/data.js` against an in-memory stand-in for Supabase: only active students, own records only, profile validation, no duplicate appointments, bill receipts, reschedule and follow-up requests, text cleaning | `node tests/student-data.test.js` |
| `database/access-rules.test.sh` | All migrations applied to a plain PostgreSQL server, then reads, writes and document uploads tried as each role | `PGHOST=... PGUSER=postgres tests/database/access-rules.test.sh` |

The database test uses `database/supabase-stand-ins.sql` in place of Supabase's
own `auth` and `storage` schemas, so it checks the policies' logic, not a live
Supabase project. After applying the migrations to Supabase, repeat the key
checks there through the application (see the functional test table in the
project write-up).
