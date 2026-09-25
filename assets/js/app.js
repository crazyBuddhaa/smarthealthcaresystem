/* =============================================
   CarePoint Smart Health Centre Management System
   Core JS, localStorage data layer and helpers
   ============================================= */

'use strict';

// ── Storage helpers ──────────────────────────────────────────────────────────
const Store = {
  get(key, def = []) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  nextId(key) {
    const ids = Store.get(key, []).map(r => parseInt(r.id) || 0);
    return ids.length ? Math.max(...ids) + 1 : 1;
  }
};

// ── Auth ─────────────────────────────────────────────────────────────────────
const DEFAULT_STAFF_USERS = [
    { username: 'admin',    password: 'admin123',    role: 'admin',  name: 'System Admin' },
    { username: 'doctor1',  password: 'password1',   role: 'doctor', name: 'Dr. A. Okafor' },
    { username: 'nurse1',   password: 'password1',   role: 'nurse',  name: 'Nurse B. Adeleke' },
    { username: 'cashier1', password: 'password1',   role: 'cashier',name: 'C. Nwosu (Cashier)' },
];

const STAFF_ROLE_DEFINITIONS = [
  { value: 'doctor', label: 'Doctor' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'cashier', label: 'Cashier' }
];

const Auth = {
  users: DEFAULT_STAFF_USERS,
  allUsers() {
    const savedUsers = Store.get('hcms_staff_users', []);
    const defaults = this.users.map(defaultUser => {
      const saved = savedUsers.find(user =>
        user.username.toLowerCase() === defaultUser.username.toLowerCase()
      );
      return { ...defaultUser, ...(saved || {}), source: 'system' };
    });
    const defaultNames = new Set(this.users.map(user => user.username.toLowerCase()));
    const customUsers = savedUsers
      .filter(user => !defaultNames.has(user.username.toLowerCase()))
      .map(user => ({ ...user, source: 'custom' }));
    return [...defaults, ...customUsers];
  },
  find(username) {
    if (!username) return null;
    return this.allUsers().find(user =>
      user.username.toLowerCase() === String(username).trim().toLowerCase()
    ) || null;
  },
  isActive(user) {
    return Boolean(user && user.role && user.role !== 'unassigned' && user.active !== false);
  },
  login(username, password) {
    const u = this.find(username);
    if (u && u.password === password && this.isActive(u)) {
      sessionStorage.setItem('hcms_user', JSON.stringify(u));
      return u;
    }
    return null;
  },
  current() {
    try {
      const stored = JSON.parse(sessionStorage.getItem('hcms_user'));
      const current = this.find(stored?.username);
      if (!this.isActive(current)) {
        sessionStorage.removeItem('hcms_user');
        return null;
      }
      return current;
    } catch {
      return null;
    }
  },
  isAdmin() { return this.current()?.role === 'admin'; },
  logout() { sessionStorage.removeItem('hcms_user'); window.location.href = 'index.html'; },
  require() {
    if (!this.current()) { window.location.href = 'login.html'; return null; }
    return this.current();
  }
};

// ── Payment reference mock validator ─────────────────────────────────────────
// In production, this would call the health-centre payment API
const VALID_PAYMENT_PREFIXES = ['CARE', 'HCS', 'RRR', 'REMITA'];
function validatePaymentRef(ref) {
  if (!ref || ref.trim().length < 6) return false;
  const upper = ref.trim().toUpperCase();
  // Accept any ref starting with known health-centre/Remita prefixes, or any 10+ digit number
  return VALID_PAYMENT_PREFIXES.some(p => upper.startsWith(p)) || /^\d{10,}$/.test(upper);
}

// ── Student self-registration helpers ────────────────────────────────────────
const StudentAuth = {
  login(matric, password) {
    const students = Store.get('hcms_students_auth', []);
    const u = students.find(s => s.matric.toLowerCase() === matric.toLowerCase() && s.password === password);
    if (u) { sessionStorage.setItem('hcms_student', JSON.stringify(u)); return u; }
    return null;
  },
  current() {
    try { return JSON.parse(sessionStorage.getItem('hcms_student')); } catch { return null; }
  },
  logout() { sessionStorage.removeItem('hcms_student'); window.location.href = 'student-portal.html'; },
  register(matric, password, patientId) {
    const students = Store.get('hcms_students_auth', []);
    if (students.find(s => s.matric.toLowerCase() === matric.toLowerCase())) return false;
    students.push({ matric, password, patientId });
    Store.set('hcms_students_auth', students);
    return true;
  }
};

// ── Student health-centre registration journey ───────────────────────────────
// The prototype stores online submissions locally. A production version should
// replace these updates with staff/API verification and secure document storage.
const REGISTRATION_STEP_DEFINITIONS = [
  {
    key: 'fee-paid',
    label: 'Pay Health Centre fee online',
    icon: 'fa-credit-card',
    description: 'Upload proof of your Health Centre payment with your registration documents.',
    action: 'Payment recorded'
  },
  {
    key: 'documents-uploaded',
    label: 'Upload receipts online',
    icon: 'fa-upload',
    description: 'Upload your Health Centre fee receipt and current school fees receipt in the portal.',
    action: 'Receipts uploaded'
  },
  {
    key: 'passport-photos-uploaded',
    label: 'Upload one passport photograph',
    icon: 'fa-picture-o',
    description: 'Upload one recent passport photograph for online verification.',
    action: 'Photo uploaded'
  },
  {
    key: 'form-submitted',
    label: 'Submit online health-centre form',
    icon: 'fa-pencil-square-o',
    description: 'Complete your personal, academic, emergency, and medical information online.',
    action: 'Form submitted'
  },
  {
    key: 'appointment-booked',
    label: 'Appointment scheduled automatically',
    icon: 'fa-calendar-check-o',
    description: 'The system assigns the next available clinic time based on appointments and the queue.',
    action: 'Appointment assigned'
  },
  {
    key: 'appointment-completed',
    label: 'Appointment completed',
    icon: 'fa-stethoscope',
    description: 'After your appointment, the Health Centre team updates your result in the portal.',
    action: 'Awaiting appointment'
  },
  {
    key: 'results-reviewed',
    label: 'Check your registration result',
    icon: 'fa-file-text-o',
    description: 'Check the portal after your appointment to see whether your registration was approved.',
    action: 'Awaiting result'
  },
  {
    key: 'card-activated',
    label: 'Health Centre Card activated',
    icon: 'fa-id-card-o',
    description: 'Your digital Health Centre Card becomes available automatically after approval.',
    action: 'Card activation pending'
  }
];

function createRegistrationWorkflow(patientId, details = {}) {
  const steps = REGISTRATION_STEP_DEFINITIONS.map(step => ({
    key: step.key,
    status: 'pending',
    completedOn: null
  }));

  const documents = details.documents || {};
  const completeKeys = [
    details.paymentRef || documents.healthReceipt ? 'fee-paid' : null,
    documents.healthReceipt && documents.schoolReceipt ? 'documents-uploaded' : null,
    documents.passportPhotos?.length ? 'passport-photos-uploaded' : null,
    details.formSubmitted ? 'form-submitted' : null,
    details.appointmentDate && details.appointmentTime ? 'appointment-booked' : null
  ].filter(Boolean);

  completeKeys.forEach(key => {
    const step = steps.find(item => item.key === key);
    step.status = 'complete';
    step.completedOn = today();
  });

  return {
    patientId,
    paymentRef: details.paymentRef || '',
    appointmentDate: details.appointmentDate || '',
    appointmentTime: details.appointmentTime || '',
    documents,
    reviewStatus: 'awaiting-appointment',
    resultStatus: 'scheduled',
    createdOn: today(),
    updatedOn: today(),
    steps
  };
}

function getRegistrationWorkflow(patientId) {
  const workflows = Store.get('hcms_registration_workflows', []);
  let workflow = workflows.find(item => item.patientId === patientId);
  if (workflow) {
    // Migrate an older locally stored checklist to the online journey.
    const oldSteps = new Map((workflow.steps || []).map(step => [step.key, step]));
    const appointment = Store.get('hcms_appointments', [])
      .find(item => item.patientId === patientId && item.status !== 'cancelled');
    const legacyComplete = key => oldSteps.get(key)?.status === 'complete';
    const migratedComplete = {
      'fee-paid': legacyComplete('fee-paid') || Boolean(workflow.paymentRef) ||
        Boolean(workflow.documents?.healthReceipt),
      'appointment-booked': legacyComplete('appointment-booked') ||
        Boolean(workflow.appointmentDate && workflow.appointmentTime) ||
        Boolean(appointment?.date && appointment?.time)
    };

    workflow.steps = REGISTRATION_STEP_DEFINITIONS.map(definition => ({
      key: definition.key,
      status: migratedComplete[definition.key] ? 'complete' : (oldSteps.get(definition.key)?.status || 'pending'),
      completedOn: migratedComplete[definition.key]
        ? (oldSteps.get(definition.key)?.completedOn || today())
        : (oldSteps.get(definition.key)?.completedOn || null)
    }));
    workflow.documents = workflow.documents || {};
    workflow.reviewStatus = workflow.reviewStatus || 'awaiting-appointment';
    workflow.resultStatus = workflow.resultStatus || 'scheduled';
    if (!workflow.appointmentDate && appointment?.date) workflow.appointmentDate = appointment.date;
    if (!workflow.appointmentTime && appointment?.time) workflow.appointmentTime = appointment.time;
    workflow.steps = REGISTRATION_STEP_DEFINITIONS.map(definition =>
      workflow.steps.find(step => step.key === definition.key) ||
      { key: definition.key, status: 'pending', completedOn: null }
    );
    return workflow;
  }

  const patient = Store.get('hcms_patients', []).find(item => item.id === patientId);
  const appointment = Store.get('hcms_appointments', [])
    .find(item => item.patientId === patientId && item.status !== 'cancelled');
  workflow = createRegistrationWorkflow(patientId, {
    paymentRef: appointment?.paymentRef || '',
    appointmentDate: appointment?.date || '',
    appointmentTime: appointment?.time || '',
    formSubmitted: Boolean(patient?.profileComplete),
    documents: patient?.onlineDocuments || {}
  });

  // Existing non-self-registered records are not part of this journey.
  if (!patient?.selfRegistered) return null;

  workflows.push(workflow);
  Store.set('hcms_registration_workflows', workflows);
  return workflow;
}

// ── Staff administration ─────────────────────────────────────────────────────
// The prototype stores staff accounts and tasks in localStorage. A production
// version should move identity, authorization, and audit history to a backend.
function validStaffRole(role) {
  return STAFF_ROLE_DEFINITIONS.some(item => item.value === role);
}

function staffRoleLabel(role) {
  return STAFF_ROLE_DEFINITIONS.find(item => item.value === role)?.label || 'Unassigned';
}

function saveStaffUser(user) {
  const savedUsers = Store.get('hcms_staff_users', []);
  const index = savedUsers.findIndex(item =>
    item.username.toLowerCase() === user.username.toLowerCase()
  );
  const record = { ...user };
  delete record.source;
  if (index >= 0) savedUsers[index] = record;
  else savedUsers.push(record);
  Store.set('hcms_staff_users', savedUsers);
  return Auth.find(user.username);
}

const StaffAdmin = {
  roles: STAFF_ROLE_DEFINITIONS,
  listStaff() {
    return Auth.allUsers().map(user => ({
      ...user,
      active: Auth.isActive(user),
      roleLabel: user.role === 'admin' ? 'Administrator' : staffRoleLabel(user.role)
    }));
  },
  createStaff(details = {}) {
    if (!Auth.isAdmin()) return { ok: false, message: 'Only an administrator can create staff accounts.' };

    const name = String(details.name || '').trim();
    const username = String(details.username || '').trim();
    const password = String(details.password || '');
    const role = String(details.role || '');
    if (!name || !username || !password || !validStaffRole(role)) {
      return { ok: false, message: 'Enter a name, staff ID, password, and valid role.' };
    }
    if (password.length < 6) {
      return { ok: false, message: 'Staff passwords must be at least 6 characters.' };
    }
    if (Auth.find(username)) {
      return { ok: false, message: 'That staff ID is already in use.' };
    }

    const user = saveStaffUser({
      username,
      password,
      role,
      name,
      active: true,
      createdOn: today()
    });
    return { ok: true, user };
  },
  assignRole(username, role) {
    if (!Auth.isAdmin()) return { ok: false, message: 'Only an administrator can assign roles.' };
    if (!validStaffRole(role)) return { ok: false, message: 'Select a valid staff role.' };

    const user = Auth.find(username);
    if (!user) return { ok: false, message: 'Staff account not found.' };
    if (user.role === 'admin' || user.username.toLowerCase() === 'admin') {
      return { ok: false, message: 'The administrator account is protected.' };
    }

    const updated = saveStaffUser({
      ...user,
      role,
      active: true,
      revokedOn: null
    });
    return { ok: true, user: updated };
  },
  revokeRole(username) {
    if (!Auth.isAdmin()) return { ok: false, message: 'Only an administrator can revoke roles.' };

    const user = Auth.find(username);
    if (!user) return { ok: false, message: 'Staff account not found.' };
    if (user.role === 'admin' || user.username.toLowerCase() === 'admin') {
      return { ok: false, message: 'The administrator account is protected.' };
    }

    saveStaffUser({
      ...user,
      role: 'unassigned',
      active: false,
      revokedOn: today()
    });

    const tasks = Store.get('hcms_staff_tasks', []);
    let changed = false;
    tasks.forEach(task => {
      if (task.assigneeUsername === user.username && task.status !== 'revoked' && task.status !== 'completed') {
        task.status = 'revoked';
        task.revokedOn = today();
        changed = true;
      }
    });
    if (changed) Store.set('hcms_staff_tasks', tasks);
    return { ok: true };
  },
  listTasks() {
    return Store.get('hcms_staff_tasks', []);
  },
  createTask(details = {}) {
    if (!Auth.isAdmin()) return { ok: false, message: 'Only an administrator can create tasks.' };

    const title = String(details.title || '').trim();
    const description = String(details.description || '').trim();
    const assigneeUsername = String(details.assigneeUsername || '').trim();
    const dueDate = String(details.dueDate || '').trim();
    const assignee = Auth.find(assigneeUsername);
    if (!title || !assignee || !Auth.isActive(assignee) || assignee.role === 'admin') {
      return { ok: false, message: 'Choose an active staff member for this task.' };
    }

    const task = {
      id: Store.nextId('hcms_staff_tasks'),
      title,
      description,
      assigneeUsername: assignee.username,
      assigneeName: assignee.name,
      assigneeRole: assignee.role,
      dueDate,
      status: 'assigned',
      assignedBy: Auth.current().name,
      createdOn: today(),
      revokedOn: null
    };
    const tasks = Store.get('hcms_staff_tasks', []);
    tasks.push(task);
    Store.set('hcms_staff_tasks', tasks);
    return { ok: true, task };
  },
  revokeTask(taskId) {
    if (!Auth.isAdmin()) return { ok: false, message: 'Only an administrator can revoke tasks.' };

    const tasks = Store.get('hcms_staff_tasks', []);
    const task = tasks.find(item => String(item.id) === String(taskId));
    if (!task) return { ok: false, message: 'Task not found.' };
    if (task.status === 'completed') return { ok: false, message: 'Completed tasks cannot be revoked.' };

    task.status = 'revoked';
    task.revokedOn = today();
    Store.set('hcms_staff_tasks', tasks);
    return { ok: true, task };
  },
  updateTaskStatus(taskId, status) {
    const current = Auth.current();
    const allowed = ['assigned', 'in-progress', 'completed'];
    if (!current || !allowed.includes(status)) return { ok: false, message: 'Invalid task update.' };

    const tasks = Store.get('hcms_staff_tasks', []);
    const task = tasks.find(item => String(item.id) === String(taskId));
    if (!task || task.status === 'revoked') return { ok: false, message: 'Task is not available.' };
    if (current.role !== 'admin' && task.assigneeUsername !== current.username) {
      return { ok: false, message: 'You can only update tasks assigned to you.' };
    }

    task.status = status;
    Store.set('hcms_staff_tasks', tasks);
    return { ok: true, task };
  }
};

const AUTOMATIC_APPOINTMENT_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '14:00', '14:30', '15:00'
];

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes)
    ? hours * 60 + minutes
    : null;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateAfterDays(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function findNextAvailableAppointmentSlot() {
  const appointments = Store.get('hcms_appointments', []);
  const queue = Store.get('hcms_queue', []);
  const currentDate = localDateKey(new Date());
  const currentTime = timeToMinutes(nowTime());

  for (let offset = 0; offset <= 60; offset += 1) {
    const date = dateAfterDays(offset);
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (weekday === 0 || weekday === 6) continue;

    const occupiedTimes = appointments
      .filter(item => item.date === date && item.status !== 'cancelled')
      .map(item => item.time);

    // Queue entries represent today's clinic load; future dates have no queue yet.
    if (date === currentDate) {
      occupiedTimes.push(
        ...queue
          .filter(item => item.status !== 'done')
          .map(item => item.time)
      );
    }

    const isBusy = slot => occupiedTimes.some(occupied => {
      const occupiedMinutes = timeToMinutes(occupied);
      const slotMinutes = timeToMinutes(slot);
      return occupiedMinutes !== null &&
        slotMinutes !== null &&
        Math.abs(occupiedMinutes - slotMinutes) < 30;
    });

    for (const slot of AUTOMATIC_APPOINTMENT_SLOTS) {
      if (date === currentDate && currentTime !== null && timeToMinutes(slot) <= currentTime) {
        continue;
      }
      if (!isBusy(slot)) return { date, time: slot };
    }
  }

  return null;
}

function scheduleNextAvailableAppointment(patientId, reason = 'Health Centre Registration & General Check-up') {
  const patients = Store.get('hcms_patients', []);
  const patient = patients.find(item => item.id === patientId);
  if (!patient?.profileComplete) return null;

  const appointments = Store.get('hcms_appointments', []);
  const existing = appointments.find(item =>
    item.patientId === patientId && item.status !== 'cancelled'
  );
  if (existing) return existing;

  const slot = findNextAvailableAppointmentSlot();
  if (!slot) return null;

  const appointment = {
    id: Store.nextId('hcms_appointments'),
    patientId,
    matric: patient.matric,
    name: patient.name,
    dept: patient.dept,
    date: slot.date,
    time: slot.time,
    reason,
    status: 'confirmed',
    paymentRef: '',
    cardNo: patient.cardNo || ''
  };
  appointments.push(appointment);
  Store.set('hcms_appointments', appointments);
  return appointment;
}

function updateRegistrationStep(patientId, stepKey, status = 'complete') {
  const workflow = getRegistrationWorkflow(patientId);
  if (!workflow) return null;

  const stepIndex = workflow.steps.findIndex(step => step.key === stepKey);
  if (stepIndex < 0) return workflow;

  const previous = workflow.steps[stepIndex - 1];
  if (status === 'complete' && previous && previous.status !== 'complete') {
    return workflow;
  }

  workflow.steps[stepIndex].status = status;
  workflow.steps[stepIndex].completedOn = status === 'complete' ? today() : null;
  workflow.updatedOn = today();

  const workflows = Store.get('hcms_registration_workflows', []);
  const index = workflows.findIndex(item => item.patientId === patientId);
  if (index >= 0) workflows[index] = workflow;
  else workflows.push(workflow);
  Store.set('hcms_registration_workflows', workflows);

  if (stepKey === 'card-activated' && status === 'complete') {
    const patients = Store.get('hcms_patients', []);
    const patientIndex = patients.findIndex(item => item.id === patientId);
    if (patientIndex >= 0) {
      patients[patientIndex].cardIssued = true;
      patients[patientIndex].cardIssuedOn = today();
      Store.set('hcms_patients', patients);
    }
  }

  return workflow;
}

function reviewRegistrationWorkflow(patientId, decision) {
  const workflow = getRegistrationWorkflow(patientId);
  if (!workflow) return null;

  const complete = key => {
    const step = workflow.steps.find(item => item.key === key);
    if (step) {
      step.status = 'complete';
      step.completedOn = today();
    }
  };

  if (decision === 'appointment-completed') {
    if (workflow.steps.find(step => step.key === 'appointment-booked')?.status !== 'complete') return null;
    complete('appointment-completed');
    workflow.reviewStatus = 'awaiting-review';
    workflow.resultStatus = 'awaiting-review';
  } else if (decision === 'approve') {
    if (workflow.steps.find(step => step.key === 'appointment-completed')?.status !== 'complete') return null;
    complete('results-reviewed');
    complete('card-activated');
    workflow.reviewStatus = 'approved';
    workflow.resultStatus = 'approved';

    const patients = Store.get('hcms_patients', []);
    const patientIndex = patients.findIndex(item => item.id === patientId);
    if (patientIndex >= 0) {
      patients[patientIndex].cardIssued = true;
      patients[patientIndex].cardIssuedOn = today();
      Store.set('hcms_patients', patients);
    }
  } else if (decision === 'reject') {
    const resultStep = workflow.steps.find(step => step.key === 'results-reviewed');
    if (resultStep) {
      resultStep.status = 'rejected';
      resultStep.completedOn = null;
    }
    workflow.reviewStatus = 'rejected';
    workflow.resultStatus = 'rejected';
  } else {
    return null;
  }

  workflow.updatedOn = today();
  const workflows = Store.get('hcms_registration_workflows', []);
  const index = workflows.findIndex(item => item.patientId === patientId);
  if (index >= 0) workflows[index] = workflow;
  else workflows.push(workflow);
  Store.set('hcms_registration_workflows', workflows);
  return workflow;
}

function registrationProgress(workflow) {
  if (!workflow?.steps?.length) return { complete: 0, total: REGISTRATION_STEP_DEFINITIONS.length, percent: 0 };
  const complete = workflow.steps.filter(step => step.status === 'complete').length;
  return {
    complete,
    total: workflow.steps.length,
    percent: Math.round((complete / workflow.steps.length) * 100)
  };
}

window.StudentAuth      = StudentAuth;
window.validatePaymentRef = validatePaymentRef;
window.STAFF_ROLE_DEFINITIONS = STAFF_ROLE_DEFINITIONS;
window.staffRoleLabel = staffRoleLabel;
window.StaffAdmin = StaffAdmin;
window.REGISTRATION_STEP_DEFINITIONS = REGISTRATION_STEP_DEFINITIONS;
window.createRegistrationWorkflow = createRegistrationWorkflow;
window.getRegistrationWorkflow = getRegistrationWorkflow;
window.scheduleNextAvailableAppointment = scheduleNextAvailableAppointment;
window.updateRegistrationStep = updateRegistrationStep;
window.reviewRegistrationWorkflow = reviewRegistrationWorkflow;
window.registrationProgress = registrationProgress;

// ── Seed data ─────────────────────────────────────────────────────────────────
function seedData() {
  if (Store.get('hcms_seeded', false)) return;

  const patients = [
    { id:1, matric:'STU/2021/0012', name:'Oluwaseun Adeyemi', gender:'Male',   dob:'2002-04-15', dept:'Computer Science',   phone:'08012345678', blood:'O+', allergies:'None', address:'Hall 3, Campus' },
    { id:2, matric:'STU/2020/0089', name:'Amaka Okonkwo',     gender:'Female', dob:'2001-07-22', dept:'Biochemistry',        phone:'08087654321', blood:'A+', allergies:'Penicillin', address:'Off Campus, Ado-Ekiti' },
    { id:3, matric:'STU/2022/0234', name:'Babatunde Olatunji',gender:'Male',   dob:'2003-01-09', dept:'Mechanical Eng.',     phone:'07055551234', blood:'B-', allergies:'None', address:'Hall 1, Campus' },
    { id:4, matric:'STU/2021/0310', name:'Fatima Bello',      gender:'Female', dob:'2002-11-30', dept:'Law',                 phone:'09033334444', blood:'AB+',allergies:'Aspirin', address:'Hall 5, Campus' },
    { id:5, matric:'STU/2020/0055', name:'Chukwuemeka Eze',   gender:'Male',   dob:'2001-08-18', dept:'Accounting',          phone:'08099887766', blood:'O-', allergies:'None', address:'Off Campus, Iyin Rd' },
    { id:6, matric:'STU/2023/0078', name:'Ngozi Obi',         gender:'Female', dob:'2003-05-14', dept:'Nursing Science',     phone:'08177776655', blood:'A-', allergies:'Latex', address:'Hall 2, Campus' },
  ];

  const records = [
    { id:1, patientId:1, date:'2025-06-10', complaint:'Headache and mild fever', diagnosis:'Malaria', treatment:'Arthemether/Lumefantrine, Paracetamol', doctor:'Dr. A. Okafor', notes:'Patient to return in 3 days if no improvement.' },
    { id:2, patientId:2, date:'2025-06-12', complaint:'Stomach pain after eating', diagnosis:'Gastritis', treatment:'Omeprazole, Antacid syrup', doctor:'Dr. A. Okafor', notes:'Avoid spicy food and alcohol.' },
    { id:3, patientId:3, date:'2025-06-15', complaint:'Cough and cold for 5 days', diagnosis:'Upper Respiratory Tract Infection', treatment:'Amoxicillin, Vitamin C, Cough syrup', doctor:'Dr. A. Okafor', notes:'Rest, drink plenty of water.' },
    { id:4, patientId:1, date:'2025-07-02', complaint:'Follow-up, malaria symptoms resolved', diagnosis:'Recovered', treatment:'Continue multivitamins', doctor:'Dr. A. Okafor', notes:'Cleared for normal activities.' },
  ];

  const queue = [
    { id:1, patientId:1, name:'Oluwaseun Adeyemi', matric:'STU/2021/0012', dept:'Computer Science', time:'08:30', status:'done',    token:'001' },
    { id:2, patientId:2, name:'Amaka Okonkwo',     matric:'STU/2020/0089', dept:'Biochemistry',     time:'08:45', status:'active',  token:'002' },
    { id:3, patientId:5, name:'Chukwuemeka Eze',   matric:'STU/2020/0055', dept:'Accounting',       time:'09:00', status:'waiting', token:'003' },
    { id:4, patientId:6, name:'Ngozi Obi',         matric:'STU/2023/0078', dept:'Nursing Science',  time:'09:15', status:'waiting', token:'004' },
    { id:5, patientId:3, name:'Babatunde Olatunji',matric:'STU/2022/0234', dept:'Mechanical Eng.',  time:'09:30', status:'waiting', token:'005' },
  ];

  const bills = [
    { id:1, patientId:1, matric:'STU/2021/0012', name:'Oluwaseun Adeyemi', date:'2025-06-10', items:[{desc:'Consultation',amount:500},{desc:'Malaria Test',amount:1500},{desc:'Drugs',amount:2000}], total:4000, status:'paid',    ref:'RCP001' },
    { id:2, patientId:2, matric:'STU/2020/0089', name:'Amaka Okonkwo',     date:'2025-06-12', items:[{desc:'Consultation',amount:500},{desc:'Drugs',amount:1200}],                                    total:1700, status:'paid',    ref:'RCP002' },
    { id:3, patientId:3, matric:'STU/2022/0234', name:'Babatunde Olatunji',date:'2025-06-15', items:[{desc:'Consultation',amount:500},{desc:'Drugs',amount:2500}],                                    total:3000, status:'pending', ref:'' },
    { id:4, patientId:5, matric:'STU/2020/0055', name:'Chukwuemeka Eze',   date:'2025-07-01', items:[{desc:'Consultation',amount:500},{desc:'Lab Test',amount:3000}],                                 total:3500, status:'pending', ref:'' },
  ];

  const appointments = [
    { id:1, patientId:1, matric:'STU/2021/0012', name:'Oluwaseun Adeyemi', dept:'Computer Science', date:'2026-08-10', time:'09:00', reason:'General Check-up', status:'confirmed',  paymentRef:'CARE2026001', cardNo:'HC-2021-0012' },
    { id:2, patientId:2, matric:'STU/2020/0089', name:'Amaka Okonkwo',     dept:'Biochemistry',     date:'2026-08-10', time:'09:30', reason:'Blood Test',       status:'confirmed',  paymentRef:'CARE2026002', cardNo:'HC-2020-0089' },
    { id:3, patientId:5, matric:'STU/2020/0055', name:'Chukwuemeka Eze',   dept:'Accounting',       date:'2026-08-11', time:'10:00', reason:'Eye Test',         status:'pending',    paymentRef:'CARE2026003', cardNo:'HC-2020-0055' },
    { id:4, patientId:6, matric:'STU/2023/0078', name:'Ngozi Obi',         dept:'Nursing Science',  date:'2026-08-12', time:'11:00', reason:'General Check-up', status:'pending',    paymentRef:'CARE2026004', cardNo:'HC-2023-0078' },
  ];

  Store.set('hcms_patients',     patients);
  Store.set('hcms_records',      records);
  Store.set('hcms_queue',        queue);
  Store.set('hcms_bills',        bills);
  Store.set('hcms_appointments', appointments);
  Store.set('hcms_seeded',       true);
}

// ── Toast notifications ───────────────────────────────────────────────────────
function toast(msg, type = 'success', duration = 3000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success:'fa-check-circle', error:'fa-times-circle', info:'fa-info-circle', warning:'fa-exclamation-triangle' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa ${icons[type]||icons.success}"></i> ${msg}`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(30px)'; t.style.transition='0.3s'; setTimeout(()=>t.remove(), 320); }, duration);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Close modal when clicking backdrop
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});

// ── Confirm dialogs ───────────────────────────────────────────────────────────
function confirmAction(msg, onConfirm) {
  if (window.confirm(msg)) onConfirm();
}

// ── Set active nav item ───────────────────────────────────────────────────────
function setActiveNav() {
  const page = window.location.pathname.split('/').pop();
  document.querySelectorAll('.sidebar-item a').forEach(a => {
    const href = a.getAttribute('href');
    if (href && href === page) a.classList.add('active');
  });
}

// ── Render user info in topnav ────────────────────────────────────────────────
function renderTopnavUser() {
  const u = Auth.current();
  if (!u) return;
  const el = document.getElementById('topnav-user');
  if (el) el.textContent = u.name;
  const roleEl = document.getElementById('topnav-role');
  if (roleEl) roleEl.textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
}

// ── Date/time utils ───────────────────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }
function nowTime() { return new Date().toTimeString().slice(0,5); }
function formatDate(d) {
  if (!d) return 'Not available';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// ── Format currency (NGN) ─────────────────────────────────────────────────────
function formatNaira(n) { return '₦' + Number(n).toLocaleString('en-NG', {minimumFractionDigits:2}); }

// ── Sidebar mobile toggle ─────────────────────────────────────────────────────
function initSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (btn && sidebar) {
    btn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
}

// ── Shared layout init (called on every inner page) ───────────────────────────
function initPage() {
  const user = Auth.require();
  if (!user) return null;
  seedData();
  setActiveNav();
  renderTopnavUser();
  initSidebarToggle();
  document.querySelectorAll('[data-admin-only]').forEach(item => {
    item.style.display = user.role === 'admin' ? '' : 'none';
  });
  return user;
}

// ── Export (for inline scripts) ───────────────────────────────────────────────
window.Store    = Store;
window.Auth     = Auth;
window.toast    = toast;
window.openModal  = openModal;
window.closeModal = closeModal;
window.confirmAction = confirmAction;
window.initPage = initPage;
window.formatDate  = formatDate;
window.formatNaira = formatNaira;
window.today    = today;
window.nowTime  = nowTime;
window.seedData = seedData;
window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[char]));
