/**
 * Server-side staff administration for Supabase Auth.
 *
 * The browser never receives the service-role key. Every action verifies the
 * caller's bearer token and requires the current Auth user to have role=admin.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zuufspuvmssicerrnfug.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VALID_ROLES = new Set(['doctor', 'nurse', 'cashier']);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(body));
}

function requestToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function authEmailForUsername(username) {
  return `${String(username).toLowerCase().replace(/[^a-z0-9._/-]/g, '').replace(/\//g, '-')}@staff.carepoint.local`;
}

function roleLabel(role) {
  return ({
    admin: 'Administrator',
    doctor: 'Doctor',
    nurse: 'Nurse',
    cashier: 'Cashier / Reception',
    unassigned: 'Unassigned'
  })[role] || 'Unassigned';
}

async function supabaseAdmin(path, options = {}) {
  return fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

async function verifyAdmin(req) {
  const token = requestToken(req);
  if (!token || !SERVICE_ROLE_KEY) return null;

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY || SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;

  const user = await response.json().catch(() => null);
  const metadata = user?.user_metadata || {};
  return metadata.role === 'admin' && metadata.active !== false ? user : null;
}

async function listUsers() {
  const response = await supabaseAdmin('/admin/users?page=1&per_page=1000');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.msg || body.message || 'Unable to load staff accounts.');
  }
  return body.users || [];
}

function asStaffUser(user) {
  const metadata = user.user_metadata || {};
  const role = metadata.role || 'unassigned';
  return {
    id: user.id,
    username: metadata.username || user.email || '',
    name: metadata.name || metadata.full_name || user.email || 'CarePoint staff',
    email: user.email || '',
    role,
    roleLabel: roleLabel(role),
    active: metadata.active !== false && role !== 'unassigned',
    createdOn: metadata.createdOn || user.created_at || null,
    revokedOn: metadata.revokedOn || null
  };
}

function findStaff(users, username) {
  const target = String(username || '').trim().toLowerCase();
  return users.find(user =>
    String(user.user_metadata?.username || '').toLowerCase() === target
  );
}

async function updateUser(user, metadata) {
  const response = await supabaseAdmin(`/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ user_metadata: metadata })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.msg || body.message || 'Unable to update the staff account.');
  }
  return body;
}

module.exports = async function staffAuthHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return json(res, 503, { message: 'Staff authentication is not configured on the server.' });
  }

  const caller = await verifyAdmin(req);
  if (!caller) return json(res, 403, { message: 'Administrator authorization is required.' });

  let details;
  try {
    details = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { message: 'Invalid request body.' });
  }
  const action = String(details.action || '');

  try {
    const users = await listUsers();
    const staffUsers = users.filter(user => {
      const role = user.user_metadata?.role;
      return role === 'admin' || role === 'doctor' || role === 'nurse' ||
        role === 'cashier' || role === 'unassigned';
    });

    if (action === 'list') {
      return json(res, 200, { staff: staffUsers.map(asStaffUser) });
    }

    if (action === 'create') {
      const name = String(details.name || '').trim();
      const username = String(details.username || '').trim();
      const password = String(details.password || '');
      const role = String(details.role || '');
      if (!name || !/^[a-zA-Z0-9._/-]{3,50}$/.test(username) || !VALID_ROLES.has(role)) {
        return json(res, 400, { message: 'Enter a valid staff ID, name, and role.' });
      }
      if (password.length < 6) {
        return json(res, 400, { message: 'Staff passwords must be at least 6 characters.' });
      }
      if (findStaff(staffUsers, username)) {
        return json(res, 409, { message: 'That staff ID is already in use.' });
      }

      const response = await supabaseAdmin('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: authEmailForUsername(username),
          password,
          email_confirm: true,
          user_metadata: {
            username,
            name,
            role,
            active: true,
            createdOn: new Date().toISOString().slice(0, 10)
          }
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        return json(res, response.status === 422 ? 409 : response.status, {
          message: body.msg || body.message || 'Unable to create the staff account.'
        });
      }
      return json(res, 201, { user: asStaffUser(body) });
    }

    const user = findStaff(staffUsers, details.username);
    if (!user) return json(res, 404, { message: 'Staff account not found.' });
    const metadata = { ...(user.user_metadata || {}) };
    if (metadata.role === 'admin' || metadata.username?.toLowerCase() === 'admin') {
      return json(res, 400, { message: 'The administrator account is protected.' });
    }

    if (action === 'assign-role') {
      const role = String(details.role || '');
      if (!VALID_ROLES.has(role)) return json(res, 400, { message: 'Select a valid staff role.' });
      metadata.role = role;
      metadata.active = true;
      delete metadata.revokedOn;
    } else if (action === 'revoke-role') {
      metadata.role = 'unassigned';
      metadata.active = false;
      metadata.revokedOn = new Date().toISOString().slice(0, 10);
    } else {
      return json(res, 400, { message: 'Unknown staff administration action.' });
    }

    const updated = await updateUser(user, metadata);
    return json(res, 200, { user: asStaffUser(updated) });
  } catch (error) {
    return json(res, 502, { message: error.message || 'Unable to complete the staff administration request.' });
  }
};