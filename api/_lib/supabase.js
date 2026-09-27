/**
 * Shared helpers for the CarePoint serverless functions.
 *
 * Files in api/_lib are not deployed as endpoints. Roles, account status and
 * the student's patient link are read from app_metadata, which only the
 * server (service-role key) can change. user_metadata is editable by the
 * signed-in user and is used for display details only.
 */
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://zuufspuvmssicerrnfug.supabase.co').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAFF_ROLES = new Set(['admin', 'doctor', 'nurse', 'cashier']);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body || {};
}

function requestToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function trustedAccess(user) {
  const app = user?.app_metadata || {};
  const declared = String(app.role || '').trim().toLowerCase();
  const role = declared === 'administrator' ? 'admin' : declared;
  return {
    role,
    active: app.active !== false && role !== '' && role !== 'unassigned',
    patientId: app.patientId ? Number(app.patientId) : null
  };
}

async function userFromRequest(req) {
  const token = requestToken(req);
  if (!token || !SERVICE_ROLE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY || SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function verifyRole(req, allowedRoles) {
  const user = await userFromRequest(req);
  const access = trustedAccess(user);
  return user && access.active && allowedRoles.has(access.role) ? user : null;
}

async function readStoreValue(key, fallback) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/hcms_store?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: serviceHeaders() }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || `Unable to read ${key}.`);
  return Array.isArray(rows) && rows.length ? rows[0].value : fallback;
}

async function writeStoreValue(key, value) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/hcms_store?on_conflict=key`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }])
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Unable to save ${key}.`);
  }
}

module.exports = {
  SUPABASE_URL,
  ANON_KEY,
  SERVICE_ROLE_KEY,
  STAFF_ROLES,
  json,
  readBody,
  requestToken,
  serviceHeaders,
  trustedAccess,
  userFromRequest,
  verifyRole,
  readStoreValue,
  writeStoreValue
};
