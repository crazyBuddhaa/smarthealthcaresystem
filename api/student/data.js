/**
 * Student data access for the CarePoint student portal.
 *
 * Students have no direct access to the hcms_store table. The portal calls
 * this function with the student's Supabase access token instead. The
 * function confirms that the caller is an active student, reads the patient
 * link from app_metadata (which only the server can change), and then:
 *
 *   GET  returns only that student's own records, plus the queue policy and
 *        faculty calendar the portal displays.
 *   POST carries out the few changes a student may make, always on the
 *        student's own entries:
 *          complete-profile     save the health centre form, assign the
 *                               registration appointment, start the workflow
 *          ensure-appointment   assign the registration appointment if the
 *                               student is eligible and has none
 *          submit-bill-receipt  attach an uploaded receipt to a pending bill
 *          request-reschedule   ask the administrator for a different time
 *          request-follow-up    ask for another visit after an attended one
 *
 * Appointment search uses the same rules as the staff pages
 * (assets/js/scheduling.js), applied here to the full appointment list.
 */
const {
  SERVICE_ROLE_KEY,
  json,
  readBody,
  verifyRole,
  trustedAccess,
  readStoreValue,
  writeStoreValue
} = require('../_lib/supabase');
const Scheduling = require('../../assets/js/scheduling.js');

const STUDENT_ONLY = new Set(['student']);
const TIME_ZONE = process.env.CAREPOINT_TIME_ZONE || 'Africa/Lagos';
const PROFILE_FIELDS = [
  'gender', 'dob', 'phone', 'faculty', 'dept', 'level', 'address',
  'blood', 'genotype', 'allergies', 'conditions', 'emergency', 'notes'
];
const REQUIRED_PROFILE_FIELDS = ['gender', 'phone', 'dept', 'emergency'];
const REGISTRATION_DOCUMENTS = ['healthReceipt', 'schoolReceipt', 'passportPhoto'];

function clinicNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return {
    todayKey: `${parts.year}-${parts.month}-${parts.day}`,
    nowMinutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

// Staff pages display student-entered text inside HTML, so angle brackets
// are removed from everything a student submits.
function cleanText(value, max = 200) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

async function loadCollections(keys) {
  const entries = await Promise.all(keys.map(async key => [key, await readStoreValue(key, null)]));
  return Object.fromEntries(entries);
}

async function studentSnapshot(patientId) {
  const data = await loadCollections([
    'hcms_patients',
    'hcms_appointments',
    'hcms_records',
    'hcms_bills',
    'hcms_registration_workflows',
    'hcms_queue_settings',
    'hcms_faculty_schedules'
  ]);
  const own = key => asList(data[key]).filter(item => Number(item.patientId) === patientId);
  return {
    hcms_patients: asList(data.hcms_patients).filter(item => Number(item.id) === patientId),
    hcms_appointments: own('hcms_appointments'),
    hcms_records: own('hcms_records'),
    hcms_bills: own('hcms_bills'),
    hcms_registration_workflows: own('hcms_registration_workflows'),
    hcms_queue_settings: data.hcms_queue_settings || {},
    hcms_faculty_schedules: asList(data.hcms_faculty_schedules)
  };
}

function nextId(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

/**
 * Assigns the registration appointment when the student is eligible and has
 * no appointment that is still standing. Returns the appointment (new or
 * existing) or null. Saves hcms_appointments when a new one is created.
 */
async function ensureRegistrationAppointment(patient) {
  if (!Scheduling.canScheduleRegistrationAppointment(patient)) return null;

  const appointments = asList(await readStoreValue('hcms_appointments', []));
  const existing = appointments.find(item =>
    Number(item.patientId) === patient.id && item.status !== 'cancelled');
  if (existing) return existing;

  const [queue, facultyBlocks] = await Promise.all([
    readStoreValue('hcms_queue', []),
    readStoreValue('hcms_faculty_schedules', [])
  ]);
  const now = clinicNow();
  const slot = Scheduling.findNextAvailableSlot({
    appointments,
    queue: asList(queue),
    facultyBlocks: asList(facultyBlocks),
    faculty: patient.faculty,
    todayKey: now.todayKey,
    nowMinutes: now.nowMinutes
  });
  if (!slot) return null;

  const appointment = {
    id: nextId(appointments),
    patientId: patient.id,
    matric: patient.matric,
    name: patient.name,
    faculty: patient.faculty || '',
    dept: patient.dept || '',
    date: slot.date,
    time: slot.time,
    reason: 'Health Centre Registration & General Check-up',
    status: 'confirmed',
    paymentRef: '',
    assignment: 'automatic',
    cardNo: patient.cardNo || ''
  };
  appointments.push(appointment);
  await writeStoreValue('hcms_appointments', appointments);
  return appointment;
}

async function recordAppointmentOnWorkflow(patientId, appointment) {
  if (!appointment) return;
  const workflows = asList(await readStoreValue('hcms_registration_workflows', []));
  const workflow = workflows.find(item => Number(item.patientId) === patientId);
  if (!workflow || (workflow.appointmentDate === appointment.date && workflow.appointmentTime === appointment.time)) return;
  const todayKey = clinicNow().todayKey;
  workflow.appointmentDate = appointment.date;
  workflow.appointmentTime = appointment.time;
  const step = asList(workflow.steps).find(item => item.key === 'appointment-booked');
  if (step && step.status !== 'complete') {
    step.status = 'complete';
    step.completedOn = todayKey;
  }
  workflow.updatedOn = todayKey;
  await writeStoreValue('hcms_registration_workflows', workflows);
}

function validDocument(patientId, type, value) {
  const path = String(value?.path || '');
  const pattern = new RegExp(`^registration/${patientId}/${type}-[a-z0-9._-]+$`, 'i');
  return pattern.test(path) && !path.includes('..');
}

async function completeProfile(patientId, body) {
  const patients = asList(await readStoreValue('hcms_patients', []));
  const index = patients.findIndex(item => Number(item.id) === patientId);
  if (index < 0) return { status: 404, message: 'Your student profile could not be found.' };
  const patient = patients[index];
  if (patient.profileComplete === true) {
    return { status: 409, message: 'Your Health Centre profile has already been submitted.' };
  }

  const profile = body.profile || {};
  const values = {};
  PROFILE_FIELDS.forEach(field => { values[field] = cleanText(profile[field], field === 'notes' ? 1000 : 200); });
  if (REQUIRED_PROFILE_FIELDS.some(field => !values[field])) {
    return { status: 400, message: 'Please complete all required fields before continuing.' };
  }
  if (values.dob && !/^\d{4}-\d{2}-\d{2}$/.test(values.dob)) {
    return { status: 400, message: 'Enter a valid date of birth.' };
  }

  const documents = body.documents || {};
  if (!REGISTRATION_DOCUMENTS.every(type => validDocument(patientId, type, documents[type]))) {
    return { status: 400, message: 'Upload both receipts and one passport photograph before submitting.' };
  }
  const fileName = type => cleanText(documents[type].fileName || type, 200);

  const cardNo = patient.cardNo || `HC-${String(patient.matric || '').replace(/[^0-9]/g, '').slice(-8) || patient.id}`;
  const onlineDocuments = {
    healthReceipt: fileName('healthReceipt'),
    healthReceiptPath: documents.healthReceipt.path,
    schoolReceipt: fileName('schoolReceipt'),
    schoolReceiptPath: documents.schoolReceipt.path,
    passportPhotos: [fileName('passportPhoto')],
    passportPhotoPaths: [documents.passportPhoto.path]
  };
  patients[index] = {
    ...patient,
    ...values,
    blood: values.blood || 'Unknown',
    allergies: values.allergies || 'None',
    cardNo,
    onlineDocuments,
    profileComplete: true,
    cardIssued: false
  };
  await writeStoreValue('hcms_patients', patients);

  const appointment = await ensureRegistrationAppointment(patients[index]);

  const workflows = asList(await readStoreValue('hcms_registration_workflows', []));
  const workflow = Scheduling.buildRegistrationWorkflow(patientId, {
    appointmentDate: appointment?.date || '',
    appointmentTime: appointment?.time || '',
    formSubmitted: true,
    documents: onlineDocuments
  }, clinicNow().todayKey);
  const workflowIndex = workflows.findIndex(item => Number(item.patientId) === patientId);
  if (workflowIndex >= 0) workflows[workflowIndex] = workflow;
  else workflows.push(workflow);
  await writeStoreValue('hcms_registration_workflows', workflows);

  return { status: 200, appointment };
}

async function submitBillReceipt(patientId, body) {
  const billId = Number(body.billId);
  const receipt = body.receipt || {};
  const path = String(receipt.path || '');
  if (!Number.isInteger(billId) ||
      !new RegExp(`^receipts/${patientId}/bill-${billId}-[a-z0-9._-]+$`, 'i').test(path) ||
      path.includes('..')) {
    return { status: 400, message: 'The receipt upload could not be matched to this bill.' };
  }

  const bills = asList(await readStoreValue('hcms_bills', []));
  const bill = bills.find(item => Number(item.id) === billId && Number(item.patientId) === patientId);
  if (!bill) return { status: 404, message: 'That bill could not be found.' };
  if (bill.status === 'paid') return { status: 409, message: 'This bill has already been paid.' };

  bill.receipt = {
    path,
    fileName: cleanText(receipt.fileName || 'Payment receipt', 200),
    fileType: cleanText(receipt.fileType || 'application/octet-stream', 100),
    fileSize: Math.max(0, Number(receipt.fileSize) || 0),
    status: 'submitted',
    submittedOn: clinicNow().todayKey
  };
  await writeStoreValue('hcms_bills', bills);
  return { status: 200 };
}

async function requestReschedule(patientId, body) {
  const date = String(body.date || '');
  const time = String(body.time || '');
  const reason = cleanText(body.reason, 300);
  const todayKey = clinicNow().todayKey;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= todayKey) {
    return { status: 400, message: 'Choose a date from tomorrow onwards.' };
  }
  const weekday = Scheduling.weekdayOfKey(date);
  if (weekday === 0 || weekday === 6) {
    return { status: 400, message: 'The clinic is open Monday to Friday. Choose a weekday.' };
  }
  if (!Scheduling.AUTOMATIC_APPOINTMENT_SLOTS.includes(time)) {
    return { status: 400, message: 'Choose one of the clinic times.' };
  }

  const appointments = asList(await readStoreValue('hcms_appointments', []));
  const appointment = appointments.find(item =>
    Number(item.patientId) === patientId && !['cancelled', 'completed'].includes(item.status));
  if (!appointment) return { status: 404, message: 'No active appointment found.' };

  appointment.status = 'rescheduled';
  appointment.rescheduleDate = date;
  appointment.rescheduleTime = time;
  appointment.rescheduleReason = reason;
  appointment.rescheduleRequestedOn = todayKey;
  await writeStoreValue('hcms_appointments', appointments);
  return { status: 200 };
}

async function requestFollowUp(patientId, body) {
  const reason = cleanText(body.reason, 300);
  if (reason.length < 3) {
    return { status: 400, message: 'Please tell us briefly why you need another appointment.' };
  }
  const patients = asList(await readStoreValue('hcms_patients', []));
  const patient = patients.find(item => Number(item.id) === patientId);
  if (!patient || patient.profileComplete !== true) {
    return { status: 400, message: 'Complete your Health Centre profile before requesting another appointment.' };
  }

  const appointments = asList(await readStoreValue('hcms_appointments', []));
  const own = appointments.filter(item => Number(item.patientId) === patientId);
  if (own.some(item => !['cancelled', 'completed'].includes(item.status))) {
    return { status: 409, message: 'You already have an active appointment. Complete or cancel it before requesting another one.' };
  }
  if (!own.some(item => item.status === 'completed')) {
    return { status: 400, message: 'A follow-up can be requested after you have attended an appointment.' };
  }

  const [queue, facultyBlocks] = await Promise.all([
    readStoreValue('hcms_queue', []),
    readStoreValue('hcms_faculty_schedules', [])
  ]);
  const now = clinicNow();
  const slot = Scheduling.findNextAvailableSlot({
    appointments,
    queue: asList(queue),
    facultyBlocks: asList(facultyBlocks),
    faculty: patient.faculty,
    todayKey: now.todayKey,
    nowMinutes: now.nowMinutes
  });
  if (!slot) {
    return { status: 409, message: 'No clinic appointment slots are available at the moment. Please try again later.' };
  }

  const appointment = {
    id: nextId(appointments),
    patientId,
    matric: patient.matric,
    name: patient.name,
    faculty: patient.faculty || '',
    dept: patient.dept || '',
    date: slot.date,
    time: slot.time,
    reason,
    appointmentType: 'follow-up',
    requestedOn: now.todayKey,
    status: 'pending',
    paymentRef: '',
    cardNo: patient.cardNo || ''
  };
  appointments.push(appointment);
  await writeStoreValue('hcms_appointments', appointments);
  return { status: 200, appointment };
}

module.exports = async function studentDataHandler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return json(res, 503, { message: 'Student data access is not configured on the server.' });
  }

  const caller = await verifyRole(req, STUDENT_ONLY);
  const patientId = caller ? trustedAccess(caller).patientId : null;
  if (!caller || !Number.isInteger(patientId) || patientId <= 0) {
    return json(res, 403, { message: 'An active student account is required.' });
  }

  try {
    if (req.method === 'GET') {
      return json(res, 200, { data: await studentSnapshot(patientId) });
    }

    let body;
    try {
      body = readBody(req);
    } catch {
      return json(res, 400, { message: 'Invalid request body.' });
    }

    let result;
    switch (String(body.action || '')) {
      case 'complete-profile':
        result = await completeProfile(patientId, body);
        break;
      case 'ensure-appointment': {
        const patients = asList(await readStoreValue('hcms_patients', []));
        const patient = patients.find(item => Number(item.id) === patientId);
        const appointment = patient?.selfRegistered ? await ensureRegistrationAppointment(patient) : null;
        await recordAppointmentOnWorkflow(patientId, appointment);
        result = { status: 200, appointment };
        break;
      }
      case 'submit-bill-receipt':
        result = await submitBillReceipt(patientId, body);
        break;
      case 'request-reschedule':
        result = await requestReschedule(patientId, body);
        break;
      case 'request-follow-up':
        result = await requestFollowUp(patientId, body);
        break;
      default:
        return json(res, 400, { message: 'Unknown student action.' });
    }

    const data = await studentSnapshot(patientId);
    if (result.status !== 200) return json(res, result.status, { message: result.message, data });
    return json(res, 200, { ok: true, appointment: result.appointment || null, data });
  } catch (error) {
    return json(res, 502, { message: error.message || 'Unable to reach Supabase.' });
  }
};
