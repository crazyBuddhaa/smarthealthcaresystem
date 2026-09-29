// Tests api/student/data.js against an in-memory stand-in for Supabase.
// Run: node tests/student-data.test.js
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
const assert = require('assert');
const S = require('../assets/js/scheduling.js');

const users = {
  tok7: { id: 'u7', app_metadata: { role: 'student', active: true, patientId: 7 } },
  tok8: { id: 'u8', app_metadata: { role: 'student', active: true, patientId: 8 } },
  tokdoc: { id: 'd', app_metadata: { role: 'doctor', active: true } },
  tokoff: { id: 'o', app_metadata: { role: 'student', active: false, patientId: 7 } }
};
let store;
function reset() {
  store = {
    hcms_patients: [
      { id: 7, matric: 'STU/2024/0007', name: 'Test Seven', selfRegistered: true, profileComplete: false, faculty: 'Law' },
      { id: 8, matric: 'STU/2024/0008', name: 'Other Eight', selfRegistered: true, profileComplete: true, registrationStatus: 'approved', faculty: 'Arts', genotype: 'AS' }
    ],
    hcms_appointments: [{ id: 1, patientId: 8, date: '2099-01-01', time: '08:00', status: 'confirmed' }],
    hcms_records: [{ id: 1, patientId: 8, diagnosis: 'secret' }, { id: 2, patientId: 7, diagnosis: 'mine' }],
    hcms_bills: [{ id: 3, patientId: 7, total: 500, status: 'pending' }, { id: 4, patientId: 8, total: 900, status: 'pending' }],
    hcms_registration_workflows: [],
    hcms_queue: [],
    hcms_staff_tasks: [{ id: 1, title: 'staff only' }]
  };
}
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (u.pathname === '/auth/v1/user') {
    const user = users[(opts.headers.Authorization || '').replace('Bearer ', '')];
    return user ? res(200, user) : res(401, {});
  }
  if (u.pathname === '/rest/v1/hcms_store') {
    assert.strictEqual(opts.headers.apikey, 'service');
    if ((opts.method || 'GET') === 'GET') {
      const key = u.searchParams.get('key').replace('eq.', '');
      return res(200, key in store ? [{ value: JSON.parse(JSON.stringify(store[key])) }] : []);
    }
    JSON.parse(opts.body).forEach(row => { store[row.key] = row.value; });
    return res(201, {});
  }
  throw new Error('unexpected ' + url);
};
const handler = require('../api/student/data.js');
async function call(method, token, body) {
  const req = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, url: '/api/student/data' };
  let out = { headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k] = v; }, end: s => { out.body = JSON.parse(s); } };
  await handler(req, res);
  out.status = res.statusCode;
  return out;
}
const docs = pid => ({
  healthReceipt: { path: `registration/${pid}/healthReceipt-u1-a.pdf`, fileName: 'a.pdf' },
  schoolReceipt: { path: `registration/${pid}/schoolReceipt-u2-b.pdf`, fileName: 'b.pdf' },
  passportPhoto: { path: `registration/${pid}/passportPhoto-u3-c.jpg`, fileName: 'c.jpg' }
});
const profile = { gender: 'Female', phone: '0801', dept: 'Law', faculty: 'Law', emergency: 'Mum 0802', level: '200', cardIssued: true, registrationStatus: 'approved' };

(async () => {
  reset();
  // Access control
  assert.strictEqual((await call('GET', null)).status, 403);
  assert.strictEqual((await call('GET', 'tokdoc')).status, 403);
  assert.strictEqual((await call('GET', 'tokoff')).status, 403);

  // Snapshot holds only own data
  let r = await call('GET', 'tok7');
  assert.strictEqual(r.status, 200);
  const d = r.body.data;
  assert.deepStrictEqual(d.hcms_patients.map(p => p.id), [7]);
  assert.deepStrictEqual(d.hcms_records.map(x => x.id), [2]);
  assert.deepStrictEqual(d.hcms_bills.map(x => x.id), [3]);
  assert.strictEqual(d.hcms_appointments.length, 0);
  assert.ok(!('hcms_staff_tasks' in d) && !('hcms_queue' in d));
  console.log('ok  snapshot returns only the student\'s own records');

  // Profile: bad documents (another student's folder) rejected
  r = await call('POST', 'tok7', { action: 'complete-profile', profile, documents: docs(8) });
  assert.strictEqual(r.status, 400);
  r = await call('POST', 'tok7', { action: 'complete-profile', profile: { ...profile, phone: '' }, documents: docs(7) });
  assert.strictEqual(r.status, 400);
  console.log('ok  profile rejected for missing field or documents outside own folder');

  // Valid profile: saved, extra fields ignored, workflow started, NO appointment yet
  r = await call('POST', 'tok7', { action: 'complete-profile', profile, documents: docs(7) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const p7 = store.hcms_patients.find(p => p.id === 7);
  assert.strictEqual(p7.profileComplete, true);
  assert.strictEqual(p7.cardIssued, false);
  assert.strictEqual(p7.registrationStatus, undefined);
  assert.strictEqual(r.body.appointment, null);
  assert.ok(!store.hcms_appointments.some(a => a.patientId === 7));
  let wf = store.hcms_registration_workflows.find(w => w.patientId === 7);
  assert.strictEqual(wf.steps.filter(s => s.status === 'complete').length, 4);
  assert.strictEqual(wf.reviewStatus, 'awaiting-document-review');
  assert.deepStrictEqual(store.hcms_patients.find(p => p.id === 8).genotype, 'AS');
  console.log('ok  profile saved, protected fields ignored, 4/8 steps, no appointment before approval');

  // Opening the portal before approval still books nothing
  r = await call('POST', 'tok7', { action: 'ensure-appointment' });
  assert.strictEqual(r.body.appointment, null);
  assert.ok(!store.hcms_appointments.some(a => a.patientId === 7));

  // Administrator approves the documents (as patients.html does)
  store.hcms_patients.find(p => p.id === 7).registrationStatus = 'approved';
  wf.documentReviewStatus = 'approved'; wf.reviewStatus = 'awaiting-appointment';
  r = await call('POST', 'tok7', { action: 'ensure-appointment' });
  assert.ok(r.body.appointment && r.body.appointment.patientId === 7);
  const wd = S.weekdayOfKey(r.body.appointment.date);
  assert.ok(wd >= 1 && wd <= 5);
  wf = store.hcms_registration_workflows.find(w => w.patientId === 7);
  assert.strictEqual(wf.steps.find(s => s.key === 'appointment-booked').status, 'complete');
  console.log('ok  weekday appointment assigned only after documents are approved');

  // Resubmission refused; ensure-appointment returns existing, no duplicate
  assert.strictEqual((await call('POST', 'tok7', { action: 'complete-profile', profile, documents: docs(7) })).status, 409);
  const before = store.hcms_appointments.length;
  r = await call('POST', 'tok7', { action: 'ensure-appointment' });
  assert.strictEqual(r.body.appointment.id, store.hcms_appointments.find(a => a.patientId === 7).id);
  assert.strictEqual(store.hcms_appointments.length, before);
  console.log('ok  no duplicate appointment or resubmission');

  // Bill receipt: own bill ok, another student's bill refused
  r = await call('POST', 'tok7', { action: 'submit-bill-receipt', billId: 4, receipt: { path: 'receipts/7/bill-4-u-r.pdf' } });
  assert.strictEqual(r.status, 404);
  r = await call('POST', 'tok7', { action: 'submit-bill-receipt', billId: 3, receipt: { path: 'receipts/8/bill-3-u-r.pdf' } });
  assert.strictEqual(r.status, 400);
  r = await call('POST', 'tok7', { action: 'submit-bill-receipt', billId: 3, receipt: { path: 'receipts/7/bill-3-u-r.pdf', fileName: 'r.pdf' } });
  assert.strictEqual(r.status, 200);
  const b3 = store.hcms_bills.find(b => b.id === 3);
  assert.strictEqual(b3.status, 'pending');
  assert.strictEqual(b3.receipt.status, 'submitted');
  assert.strictEqual(store.hcms_bills.find(b => b.id === 4).receipt, undefined);
  console.log('ok  receipt attaches only to own pending bill; bill stays pending');

  // Reschedule request
  r = await call('POST', 'tok7', { action: 'request-reschedule', date: '2000-01-03', time: '09:00' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', 'tok7', { action: 'request-reschedule', date: '2099-01-03', time: '09:00' }); // Saturday
  assert.strictEqual(r.status, 400);
  r = await call('POST', 'tok7', { action: 'request-reschedule', date: '2099-01-05', time: '09:00', reason: 'exam' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(store.hcms_appointments.find(a => a.patientId === 7).status, 'rescheduled');
  assert.strictEqual(store.hcms_appointments.find(a => a.patientId === 8).status, 'confirmed');
  console.log('ok  reschedule request validated and limited to own appointment');

  // Follow-up: refused while an appointment is active, allowed after it is attended
  r = await call('POST', 'tok7', { action: 'request-follow-up', reason: 'Review results' });
  assert.strictEqual(r.status, 409);
  store.hcms_appointments.find(a => a.patientId === 7).status = 'completed';
  r = await call('POST', 'tok7', { action: 'request-follow-up', reason: 'ok' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', 'tok7', { action: 'request-follow-up', reason: '<img src=x onerror=alert(1)> Review results' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.appointment.status, 'pending');
  assert.strictEqual(r.body.appointment.appointmentType, 'follow-up');
  assert.ok(!/[<>]/.test(r.body.appointment.reason));
  assert.strictEqual((await call('POST', 'tok7', { action: 'request-follow-up', reason: 'Again please' })).status, 409);
  console.log('ok  follow-up only after an attended visit, one at a time, text cleaned');

  assert.strictEqual((await call('POST', 'tok7', { action: 'delete-everything' })).status, 400);
  console.log('ok  unknown actions refused');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
