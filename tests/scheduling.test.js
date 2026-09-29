// Tests the shared scheduling rules. Run: node tests/scheduling.test.js
const assert = require('assert');
const S = require('../assets/js/scheduling.js');
const f = o => S.findNextAvailableSlot({ appointments: [], queue: [], facultyBlocks: [], faculty: 'Law', todayKey: '2026-09-28', nowMinutes: 7 * 60, ...o });
// Monday 2026-09-28 before opening -> first slot today
assert.deepStrictEqual(f({}), { date: '2026-09-28', time: '08:00' });
// Past times skipped
assert.deepStrictEqual(f({ nowMinutes: 9 * 60 + 10 }), { date: '2026-09-28', time: '09:30' });
// Friday evening -> Monday (weekend skipped)
assert.deepStrictEqual(f({ todayKey: '2026-10-02', nowMinutes: 18 * 60 }), { date: '2026-10-05', time: '08:00' });
// Taken slot and cancelled ignored
assert.deepStrictEqual(f({ appointments: [{ date: '2026-09-28', time: '08:00', status: 'confirmed' }, { date: '2026-09-28', time: '08:30', status: 'cancelled' }] }), { date: '2026-09-28', time: '08:30' });
// An 08:10 appointment blocks 08:00 and 08:30 (less than 30 min away)
assert.deepStrictEqual(f({ appointments: [{ date: '2026-09-28', time: '08:10', status: 'confirmed' }] }), { date: '2026-09-28', time: '09:00' });
// Queue occupies today only
assert.deepStrictEqual(f({ queue: [{ time: '08:00', status: 'waiting' }, { time: '08:30', status: 'done' }] }), { date: '2026-09-28', time: '08:30' });
// Faculty calendar: only Law days
const blocks = [{ faculty: 'Arts', startDate: '2026-09-28', endDate: '2026-09-29' }, { faculty: 'Law', startDate: '2026-09-30', endDate: '2026-09-30' }];
assert.deepStrictEqual(f({ facultyBlocks: blocks }), { date: '2026-09-30', time: '08:00' });
// Calendar full -> null after 60 days
assert.strictEqual(f({ facultyBlocks: [{ faculty: 'Arts', startDate: '2026-09-28', endDate: '2027-12-31' }] }), null);
// Card rule
assert.strictEqual(S.cardIsIssued({}, null), true);
assert.strictEqual(S.cardIsIssued({ cardIssued: false }, null), false);
assert.strictEqual(S.cardIsIssued({ cardIssued: true }, { reviewStatus: 'awaiting-review' }), false);
assert.strictEqual(S.cardIsIssued({ cardIssued: true }, { reviewStatus: 'approved' }), true);
// Faculty calendar with "If capacity remains unused"
// Mon 28 and Tue 29 reserved for Arts, Mon 5 Oct for Law; Wed 30 to Fri 2 reserved for nobody.
const cal = [{ faculty: 'Arts', startDate: '2026-09-28', endDate: '2026-09-29' }, { faculty: 'Law', startDate: '2026-10-05', endDate: '2026-10-05' }];
// strict: a Law student waits for the Law day
assert.deepStrictEqual(f({ facultyBlocks: cal, policy: 'respect-groups' }), { date: '2026-10-05', time: '08:00' });
// share capacity, Arts students still waiting: Arts days stay theirs, the free Wednesday is used
assert.deepStrictEqual(f({ facultyBlocks: cal, policy: 'fill-available', waitingFaculties: new Set(['arts']) }), { date: '2026-09-30', time: '08:00' });
// share capacity, no Arts student waiting: the empty Arts day today is filled
assert.deepStrictEqual(f({ facultyBlocks: cal, policy: 'fill-available', waitingFaculties: new Set() }), { date: '2026-09-28', time: '08:00' });
// an Arts day that is full is skipped even when shared
const fullMon = S.AUTOMATIC_APPOINTMENT_SLOTS.map((t, i) => ({ date: '2026-09-28', time: t, status: 'confirmed' }));
assert.deepStrictEqual(f({ facultyBlocks: cal, policy: 'fill-available', waitingFaculties: new Set(), appointments: fullMon }), { date: '2026-09-29', time: '08:00' });
// queue check-in (no waiting list): another faculty's day is open when sharing, closed when strict
assert.strictEqual(S.dayOpenToFaculty({ blocks: cal, faculty: 'Law', dateKey: '2026-09-28', todayKey: '2026-09-28', policy: 'fill-available', waitingFaculties: null }), true);
assert.strictEqual(S.dayOpenToFaculty({ blocks: cal, faculty: 'Law', dateKey: '2026-09-28', todayKey: '2026-09-28', policy: 'respect-groups', waitingFaculties: null }), false);
// who is waiting: approved online student or staff-created record without an appointment
const pts = [
  { id: 1, faculty: 'Arts', profileComplete: true, selfRegistered: true, registrationStatus: 'approved' },
  { id: 2, faculty: 'Law', profileComplete: true, selfRegistered: true },
  { id: 3, faculty: 'Law', profileComplete: true, selfRegistered: false },
  { id: 4, faculty: 'Medical Sciences', profileComplete: true, selfRegistered: false }
];
assert.deepStrictEqual([...S.facultiesWaitingForAppointment(pts, [{ patientId: 4, status: 'confirmed' }], null)].sort(), ['arts', 'law']);
assert.deepStrictEqual([...S.facultiesWaitingForAppointment(pts, [{ patientId: 4, status: 'confirmed' }], 1)].sort(), ['law']);

// No-shows: confirmed/pending appointments before today become missed
const ap = [{ date: '2026-09-25', status: 'confirmed' }, { date: '2026-09-25', status: 'pending' }, { date: '2026-09-25', status: 'rescheduled' },
            { date: '2026-09-25', status: 'completed' }, { date: '2026-09-28', status: 'confirmed' }];
assert.strictEqual(S.markMissedAppointments(ap, '2026-09-28'), 2);
assert.deepStrictEqual(ap.map(a => a.status), ['missed', 'missed', 'rescheduled', 'completed', 'confirmed']);
assert.strictEqual(S.appointmentIsActive({ status: 'missed' }), false);
assert.strictEqual(S.appointmentIsActive({ status: 'confirmed' }), true);

// Booking eligibility: online sign-ups wait for document approval
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: true }), false);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: true, registrationStatus: 'documents-rejected' }), false);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: true, registrationStatus: 'approved' }), true);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: false }), true);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: false, selfRegistered: true, registrationStatus: 'approved' }), false);
console.log('scheduler, booking and card rules: all assertions passed');
