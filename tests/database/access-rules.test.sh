#!/usr/bin/env bash
# Tests the hcms_store and document-bucket access rules on a local PostgreSQL.
# Usage: PGHOST=... PGUSER=postgres tests/database/access-rules.test.sh
# Creates (and drops) a scratch database named carepoint_rules_test.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=carepoint_rules_test
Q="psql -v ON_ERROR_STOP=1 -q -X"
$Q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$Q -d $DB -f tests/database/supabase-stand-ins.sql >/dev/null 2>&1
for m in supabase/migrations/*.sql; do $Q -d $DB -f "$m" >/dev/null 2>&1; done
$Q -d $DB -c "insert into hcms_store(key,value) values ('hcms_patients','[]'),('hcms_records','[]'),('hcms_bills','[]'),('hcms_queue_settings','{}'),('hcms_staff_tasks','[]'),('hcms_seeded','true')" >/dev/null

attempt() { # role active sql -> ok|denied
  local claims="{\"app_metadata\":{\"role\":\"$1\",\"active\":$2,\"patientId\":\"7\"}}"
  if psql -X -q -t -A -d $DB -v ON_ERROR_STOP=1 >/tmp/carepoint_out 2>&1 <<SQL
begin; set local role authenticated; set local request.jwt.claims = '$claims';
$3
rollback;
SQL
  then echo "ok:$(tr -d '\n' </tmp/carepoint_out)"; else echo denied; fi
}
write() { attempt "$1" true "insert into hcms_store(key,value) values ('$2','[1]') on conflict (key) do update set value = excluded.value;"; }
upload() { attempt "$1" true "insert into storage.objects(bucket_id,name) values ('hcms-registration-documents','$2');"; }
fails=0
expect() { if [[ "$2" == "$3"* ]]; then echo "ok    $1"; else echo "FAIL  $1 (expected $3, got $2)"; fails=$((fails+1)); fi; }

expect "student reads no rows"               "$(attempt student true 'select count(*) from hcms_store;')" "ok:0"
expect "inactive staff reads no rows"        "$(attempt doctor false 'select count(*) from hcms_store;')" "ok:0"
expect "doctor reads every collection"       "$(attempt doctor true 'select count(*) from hcms_store;')" "ok:6"
for k in hcms_patients hcms_records hcms_bills hcms_queue_settings; do expect "student cannot write $k" "$(write student $k)" denied; done
for k in hcms_patients hcms_records hcms_bills hcms_queue_settings hcms_seeded; do expect "admin writes $k" "$(write admin $k)" ok; done
for r in doctor nurse; do
  expect "$r writes hcms_records"             "$(write $r hcms_records)" ok
  expect "$r cannot write hcms_bills"         "$(write $r hcms_bills)" denied
  expect "$r cannot write hcms_queue_settings" "$(write $r hcms_queue_settings)" denied
done
expect "cashier writes hcms_bills"           "$(write cashier hcms_bills)" ok
expect "cashier cannot write hcms_records"   "$(write cashier hcms_records)" denied
expect "cashier writes hcms_patients"        "$(write cashier hcms_patients)" ok
expect "nurse cannot write demo-data flag"   "$(write nurse hcms_seeded)" denied
expect "student uploads to own folder"       "$(upload student registration/7/healthReceipt-a-r.pdf)" ok
expect "student uploads bill receipt"        "$(upload student receipts/7/bill-3-a-r.pdf)" ok
expect "student photo as .jpg"               "$(upload student registration/7/passportPhoto-a-me.jpg)" ok
expect "student photo as .pdf refused"       "$(upload student registration/7/passportPhoto-a-me.pdf)" denied
expect "student upload to other folder"      "$(upload student registration/8/healthReceipt-a-r.pdf)" denied
expect "staff cannot upload as student"      "$(upload doctor registration/7/healthReceipt-a-r.pdf)" denied
anon=$(psql -X -q -t -A -d $DB -c "begin; set local role anon; select count(*) from hcms_store; rollback;" 2>&1 || true)
if grep -q "permission denied" <<<"$anon"; then echo "ok    visitor (anon) has no access"; else echo "FAIL  visitor (anon) has no access"; fails=$((fails+1)); fi

$Q -d postgres -c "drop database $DB" >/dev/null
echo "$fails failure(s)"; exit $fails
