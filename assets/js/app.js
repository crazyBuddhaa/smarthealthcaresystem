/* =============================================
   CarePoint Smart Health Centre Management System
   Core JS — localStorage data layer + helpers
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
const Auth = {
  users: [
    { username: 'admin',    password: 'admin123',    role: 'admin',  name: 'System Admin' },
    { username: 'doctor1',  password: 'password1',   role: 'doctor', name: 'Dr. A. Okafor' },
    { username: 'nurse1',   password: 'password1',   role: 'nurse',  name: 'Nurse B. Adeleke' },
    { username: 'cashier1', password: 'password1',   role: 'cashier',name: 'C. Nwosu (Cashier)' },
  ],
  login(username, password) {
    const u = this.users.find(u => u.username === username && u.password === password);
    if (u) { sessionStorage.setItem('hcms_user', JSON.stringify(u)); return u; }
    return null;
  },
  current() {
    try { return JSON.parse(sessionStorage.getItem('hcms_user')); } catch { return null; }
  },
  logout() { sessionStorage.removeItem('hcms_user'); window.location.href = 'index.html'; },
  require() {
    if (!this.current()) { window.location.href = 'index.html'; return null; }
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
  logout() { sessionStorage.removeItem('hcms_student'); window.location.href = 'index.html'; },
  register(matric, password, patientId) {
    const students = Store.get('hcms_students_auth', []);
    if (students.find(s => s.matric.toLowerCase() === matric.toLowerCase())) return false;
    students.push({ matric, password, patientId });
    Store.set('hcms_students_auth', students);
    return true;
  }
};

// ── Student health-centre registration journey ─────────────────────────────────
// This is a browser-only prototype, so the checklist records confirmations
// locally. A production version should replace these updates with staff/API
// verification and secure document storage.
const REGISTRATION_STEP_DEFINITIONS = [
  {
    key: 'fee-paid',
    label: 'Pay Health Centre fee',
    icon: 'fa-money',
    description: 'Pay the approved Health Centre fee before starting your clinic registration.',
    action: 'Confirm fee paid'
  },
  {
    key: 'receipt-obtained',
    label: 'Get Health Centre fee receipt',
    icon: 'fa-file-text-o',
    description: 'Keep the receipt or payment confirmation with you for your clinic visit.',
    action: 'Confirm receipt received'
  },
  {
    key: 'clinic-visit',
    label: 'Go to the Health Centre',
    icon: 'fa-hospital-o',
    description: 'Attend your booked appointment and bring your school ID and all required documents.',
    action: 'Confirm clinic visit'
  },
  {
    key: 'health-receipt-submitted',
    label: 'Submit Health Centre receipt',
    icon: 'fa-ticket',
    description: 'Present your Health Centre fee receipt at the registration desk.',
    action: 'Confirm receipt submitted'
  },
  {
    key: 'school-fees-receipt-submitted',
    label: 'Submit school fees receipt',
    icon: 'fa-file-text',
    description: 'Present your current school fees receipt for verification.',
    action: 'Confirm receipt submitted'
  },
  {
    key: 'passports-submitted',
    label: 'Submit 2 passport photographs',
    icon: 'fa-picture-o',
    description: 'Submit two recent passport photographs in the format requested by the Health Centre.',
    action: 'Confirm passports submitted'
  },
  {
    key: 'form-collected',
    label: 'Collect and fill registration form',
    icon: 'fa-pencil-square-o',
    description: 'Collect the Health Centre registration form, complete every required field, and sign it.',
    action: 'Confirm form collected'
  },
  {
    key: 'form-submitted',
    label: 'Submit completed form',
    icon: 'fa-check-square-o',
    description: 'Return the completed and signed form to the registration desk.',
    action: 'Confirm form submitted'
  },
  {
    key: 'urine-test',
    label: 'Complete urine test',
    icon: 'fa-flask',
    description: 'Follow the clinic staff instructions for the urine sample and test.',
    action: 'Confirm urine test completed'
  },
  {
    key: 'screening',
    label: 'Complete screening',
    icon: 'fa-stethoscope',
    description: 'Male students complete the required screening. Female students complete breast screening as directed by clinic staff.',
    action: 'Confirm screening completed'
  },
  {
    key: 'remaining-procedures',
    label: 'Complete remaining procedures',
    icon: 'fa-medkit',
    description: 'Finish any remaining checks or procedures assigned by the Health Centre team.',
    action: 'Confirm procedures completed'
  },
  {
    key: 'card-collected',
    label: 'Collect Health Centre Card',
    icon: 'fa-id-card-o',
    description: 'Collect your Health Centre Card after all registration requirements have been completed.',
    action: 'Confirm card collected'
  }
];

function createRegistrationWorkflow(patientId, details = {}) {
  const steps = REGISTRATION_STEP_DEFINITIONS.map(step => ({
    key: step.key,
    status: 'pending',
    completedOn: null
  }));

  // Online payment verification establishes the first two prerequisites.
  ['fee-paid', 'receipt-obtained'].forEach(key => {
    const step = steps.find(item => item.key === key);
    step.status = 'complete';
    step.completedOn = today();
  });

  return {
    patientId,
    paymentRef: details.paymentRef || '',
    appointmentDate: details.appointmentDate || '',
    appointmentTime: details.appointmentTime || '',
    createdOn: today(),
    updatedOn: today(),
    steps
  };
}

function getRegistrationWorkflow(patientId) {
  const workflows = Store.get('hcms_registration_workflows', []);
  let workflow = workflows.find(item => item.patientId === patientId);
  if (workflow) {
    // Keep older locally stored workflows compatible if new steps are added.
    const existingKeys = new Set((workflow.steps || []).map(step => step.key));
    REGISTRATION_STEP_DEFINITIONS.forEach(definition => {
      if (!existingKeys.has(definition.key)) {
        workflow.steps.push({ key: definition.key, status: 'pending', completedOn: null });
      }
    });
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
    appointmentTime: appointment?.time || ''
  });

  // Existing non-self-registered records are not part of this journey.
  if (!patient?.selfRegistered) return null;

  workflows.push(workflow);
  Store.set('hcms_registration_workflows', workflows);
  return workflow;
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

  if (stepKey === 'card-collected' && status === 'complete') {
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
window.REGISTRATION_STEP_DEFINITIONS = REGISTRATION_STEP_DEFINITIONS;
window.createRegistrationWorkflow = createRegistrationWorkflow;
window.getRegistrationWorkflow = getRegistrationWorkflow;
window.updateRegistrationStep = updateRegistrationStep;
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
    { id:4, patientId:1, date:'2025-07-02', complaint:'Follow-up — malaria symptoms resolved', diagnosis:'Recovered', treatment:'Continue multivitamins', doctor:'Dr. A. Okafor', notes:'Cleared for normal activities.' },
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
  if (!d) return '—';
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
  Auth.require();
  seedData();
  setActiveNav();
  renderTopnavUser();
  initSidebarToggle();
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
