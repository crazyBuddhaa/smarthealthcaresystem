/**
 * Creates a student in Supabase Auth without exposing the service-role key.
 *
 * Student login still uses the matric number in the UI. The Auth account uses
 * a deterministic internal email alias, while the student's real email is
 * retained as metadata for contact purposes.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zuufspuvmssicerrnfug.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(body));
}

function authEmailForMatric(matric) {
  return `${String(matric).toLowerCase().replace(/[^a-z0-9._/-]/g, '').replace(/\//g, '-')}@student.carepoint.local`;
}

module.exports = async function studentAuthHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  if (!SERVICE_ROLE_KEY) {
    return json(res, 503, { message: 'Student authentication is not configured on the server.' });
  }

  let details;
  try {
    details = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { message: 'Invalid request body.' });
  }
  const matric = String(details.matric || '').trim().toUpperCase();
  const password = String(details.password || '');
  const name = String(details.name || '').trim();
  const contactEmail = String(details.email || '').trim().toLowerCase();
  const patientId = Number(details.patientId);

  if (!matric || !name || !contactEmail || !Number.isInteger(patientId) || patientId < 1) {
    return json(res, 400, { message: 'Student account details are incomplete.' });
  }
  if (password.length < 6) {
    return json(res, 400, { message: 'Password must be at least 6 characters.' });
  }

  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: authEmailForMatric(matric),
        password,
        email_confirm: true,
        user_metadata: {
          role: 'student',
          username: matric,
          matric,
          patientId,
          name,
          contactEmail,
          active: true
        }
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.msg || body.message || body.error_description;
      const duplicate = response.status === 422 || /already|exist|duplicate/i.test(String(message || ''));
      return json(res, duplicate ? 409 : response.status, {
        message: duplicate ? 'A student account with that matric number already exists.' : (message || 'Unable to create the student account.')
      });
    }

    return json(res, 201, {
      ok: true,
      user: {
        id: body.id,
        email: body.email,
        username: matric,
        role: 'student',
        patientId
      }
    });
  } catch (error) {
    return json(res, 502, { message: error.message || 'Unable to reach Supabase Auth.' });
  }
};