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
// Booking eligibility: online sign-ups wait for document approval
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: true }), false);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: true, registrationStatus: 'documents-rejected' }), false);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: true, registrationStatus: 'approved' }), true);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: true, selfRegistered: false }), true);
assert.strictEqual(S.canScheduleRegistrationAppointment({ profileComplete: false, selfRegistered: true, registrationStatus: 'approved' }), false);
console.log('scheduler, booking and card rules: all assertions passed');
