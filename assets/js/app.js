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

window.StudentAuth      = StudentAuth;
window.validatePaymentRef = validatePaymentRef;

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
