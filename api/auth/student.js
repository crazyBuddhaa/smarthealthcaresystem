/**
 * Creates a student account and the matching student profile.
 *
 * Student login uses the matric number in the UI. The Auth account uses a
 * deterministic internal email alias, while the student's real email is kept
 * as contact metadata. The profile record is written by the server so that
 * visitors who are not signed in never need write access to the data store.
 */
const {
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  json,
  readBody,
  serviceHeaders,
  readStoreValue,
  writeStoreValue
} = require('../_lib/supabase');

function authEmailForMatric(matric) {
  return `${String(matric).toLowerCase().replace(/[^a-z0-9._/-]/g, '').replace(/\//g, '-')}@student.carepoint.local`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function deleteAuthUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: serviceHeaders()
  }).catch(() => {});
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
    details = readBody(req);
  } catch {
    return json(res, 400, { message: 'Invalid request body.' });
  }
  const matric = String(details.matric || '').trim().toUpperCase();
  const password = String(details.password || '');
  const surname = String(details.surname || '').trim();
  const firstName = String(details.firstName || '').trim();
  const otherName = String(details.otherName || '').trim();
  const name = String(details.name || [surname, firstName, otherName].filter(Boolean).join(' ')).trim();
  const contactEmail = String(details.email || '').trim().toLowerCase();

  if (!/^[A-Z0-9/._-]{4,40}$/.test(matric) || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return json(res, 400, { message: 'Student account details are incomplete.' });
  }
  if (password.length < 6) {
    return json(res, 400, { message: 'Password must be at least 6 characters.' });
  }

  try {
    const patients = await readStoreValue('hcms_patients', []);
    const list = Array.isArray(patients) ? patients : [];
    if (list.some(patient => String(patient.matric || '').toUpperCase() === matric)) {
      return json(res, 409, { message: 'A student with that matric number is already registered.' });
    }
    const patientId = list.reduce((max, patient) => Math.max(max, Number(patient.id) || 0), 0) + 1;

    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        email: authEmailForMatric(matric),
        password,
        email_confirm: true,
        app_metadata: { role: 'student', active: true, patientId },
        user_metadata: { username: matric, matric, name, contactEmail }
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

    try {
      list.push({
        id: patientId,
        matric,
        name,
        surname,
        firstName,
        otherName,
        email: contactEmail,
        registeredOn: today(),
        selfRegistered: true,
        profileComplete: false,
        cardNo: `HC-${matric.replace(/[^0-9]/g, '').slice(-8) || patientId}`,
        cardIssued: false
      });
      await writeStoreValue('hcms_patients', list);
    } catch (error) {
      await deleteAuthUser(body.id);
      throw error;
    }

    return json(res, 201, {
      ok: true,
      user: { id: body.id, username: matric, role: 'student', patientId }
    });
  } catch (error) {
    return json(res, 502, { message: error.message || 'Unable to reach Supabase.' });
  }
};
