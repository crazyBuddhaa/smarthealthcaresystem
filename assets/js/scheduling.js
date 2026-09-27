/* =============================================
   CarePoint shared scheduling rules
   Used by the browser (assets/js/app.js) and by the Vercel functions
   (api/student/data.js), so the appointment search and the registration
   checklist follow exactly the same rules on both sides.
   ============================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CarePointScheduling = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AUTOMATIC_APPOINTMENT_SLOTS = [
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
    '11:00', '11:30', '12:00', '14:00', '14:30', '15:00'
  ];
  const SEARCH_DAYS = 60;
  const MIN_GAP_MINUTES = 30;

  const REGISTRATION_STEP_KEYS = [
    'fee-paid',
    'documents-uploaded',
    'passport-photos-uploaded',
    'form-submitted',
    'appointment-booked',
    'appointment-completed',
    'results-reviewed',
    'card-activated'
  ];

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  }

  // Date keys are plain YYYY-MM-DD strings. Arithmetic is done in UTC so the
  // result does not depend on the time zone of the machine running the code.
  function addDaysToKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  function weekdayOfKey(dateKey) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  function normalizeFaculty(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function validFacultyBlock(block) {
    return Boolean(block) &&
      typeof block.faculty === 'string' && block.faculty.trim() !== '' &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(block.startDate || '')) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(block.endDate || '')) &&
      block.startDate <= block.endDate;
  }

  // While any current or future faculty block exists, a day is open only to
  // the faculty reserved for it. Otherwise every faculty can use every day.
  function facultyEligibleOnDate(blocks, faculty, dateKey, todayKey) {
    const valid = (Array.isArray(blocks) ? blocks : []).filter(validFacultyBlock);
    if (!valid.some(block => block.endDate >= todayKey)) return true;
    const block = valid.find(item => item.startDate <= dateKey && item.endDate >= dateKey);
    return Boolean(block) && normalizeFaculty(block.faculty) === normalizeFaculty(faculty);
  }

  /**
   * Finds the first free weekday slot within SEARCH_DAYS days.
   * A slot is taken when a non-cancelled appointment, or (today only) a
   * student still in the queue, is less than 30 minutes away from it.
   * @param {object} input { appointments, queue, facultyBlocks, faculty, todayKey, nowMinutes }
   */
  function findNextAvailableSlot(input) {
    const appointments = Array.isArray(input.appointments) ? input.appointments : [];
    const queue = Array.isArray(input.queue) ? input.queue : [];
    const todayKey = input.todayKey;
    const nowMinutes = input.nowMinutes;

    for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
      const date = addDaysToKey(todayKey, offset);
      const weekday = weekdayOfKey(date);
      if (weekday === 0 || weekday === 6) continue;
      if (!facultyEligibleOnDate(input.facultyBlocks, input.faculty, date, todayKey)) continue;

      const occupied = appointments
        .filter(item => item.date === date && item.status !== 'cancelled')
        .map(item => timeToMinutes(item.time));
      if (date === todayKey) {
        occupied.push(...queue
          .filter(item => item.status !== 'done')
          .map(item => timeToMinutes(item.time)));
      }

      for (const slot of AUTOMATIC_APPOINTMENT_SLOTS) {
        const slotMinutes = timeToMinutes(slot);
        if (date === todayKey && nowMinutes !== null && slotMinutes <= nowMinutes) continue;
        const busy = occupied.some(minutes =>
          minutes !== null && Math.abs(minutes - slotMinutes) < MIN_GAP_MINUTES);
        if (!busy) return { date, time: slot };
      }
    }
    return null;
  }

  function buildRegistrationWorkflow(patientId, details, todayKey) {
    const steps = REGISTRATION_STEP_KEYS.map(key => ({ key, status: 'pending', completedOn: null }));
    const documents = details.documents || {};
    const completeKeys = [
      details.paymentRef || documents.healthReceipt ? 'fee-paid' : null,
      documents.healthReceipt && documents.schoolReceipt ? 'documents-uploaded' : null,
      documents.passportPhotos && documents.passportPhotos.length ? 'passport-photos-uploaded' : null,
      details.formSubmitted ? 'form-submitted' : null,
      details.appointmentDate && details.appointmentTime ? 'appointment-booked' : null
    ].filter(Boolean);
    completeKeys.forEach(key => {
      const step = steps.find(item => item.key === key);
      step.status = 'complete';
      step.completedOn = todayKey;
    });
    return {
      patientId,
      paymentRef: details.paymentRef || '',
      appointmentDate: details.appointmentDate || '',
      appointmentTime: details.appointmentTime || '',
      documents,
      documentReviewStatus: details.documentReviewStatus || 'awaiting-review',
      reviewStatus: details.reviewStatus || 'awaiting-document-review',
      resultStatus: details.resultStatus || 'pending-review',
      createdOn: todayKey,
      updatedOn: todayKey,
      steps
    };
  }

  // A student receives one automatic registration appointment. It is not
  // assigned again once an appointment exists, unless that one was cancelled.
  function canScheduleRegistrationAppointment(patient) {
    if (!patient || patient.profileComplete !== true) return false;
    if (patient.selfRegistered && patient.registrationStatus &&
        patient.registrationStatus !== 'approved') return false;
    return true;
  }

  // Staff-created records have no online workflow; their card follows the
  // cardIssued flag. Self-registered students need final approval.
  function cardIsIssued(patient, workflow) {
    if (!patient) return false;
    if (!workflow) return patient.cardIssued !== false;
    return patient.cardIssued === true && workflow.reviewStatus === 'approved';
  }

  return {
    AUTOMATIC_APPOINTMENT_SLOTS,
    SEARCH_DAYS,
    REGISTRATION_STEP_KEYS,
    timeToMinutes,
    addDaysToKey,
    weekdayOfKey,
    normalizeFaculty,
    validFacultyBlock,
    facultyEligibleOnDate,
    findNextAvailableSlot,
    buildRegistrationWorkflow,
    canScheduleRegistrationAppointment,
    cardIsIssued
  };
}));
