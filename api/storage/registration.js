/**
 * Returns a short-lived signed URL for a registration document.
 *
 * The bucket remains private. The browser sends the current Supabase Auth
 * access token, this function verifies that the caller is active staff, and
 * only then asks Supabase Storage for a temporary URL.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zuufspuvmssicerrnfug.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'hcms-registration-documents';
const STAFF_ROLES = new Set(['admin', 'doctor', 'nurse', 'cashier']);

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

async function verifyStaff(req) {
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
  return metadata.active !== false && STAFF_ROLES.has(metadata.role) ? user : null;
}

function storagePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function signedUrlFromResponse(body) {
  const values = [
    body?.signedURL,
    body?.signedUrl,
    body?.signed_url,
    body?.data?.signedURL,
    body?.data?.signedUrl,
    Array.isArray(body) ? body[0]?.signedURL : null,
    Array.isArray(body) ? body[0]?.signedUrl : null
  ];
  return values.find(value => typeof value === 'string' && value.length > 0) || '';
}

function absoluteStorageUrl(value) {
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  const base = SUPABASE_URL.replace(/\/$/, '');
  return value.startsWith('/storage/v1/')
    ? `${base}${value}`
    : `${base}/storage/v1${value.startsWith('/') ? value : `/${value}`}`;
}

module.exports = async function registrationStorageHandler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { message: 'Method not allowed.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return json(res, 503, { message: 'Registration document storage is not configured on the server.' });
  }

  const caller = await verifyStaff(req);
  if (!caller) return json(res, 403, { message: 'Active staff authorization is required.' });

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const path = requestUrl.searchParams.get('path') || '';
  const download = requestUrl.searchParams.get('download') === '1';
  if (!/^registration\/\d+\/[a-z0-9._-]+$/i.test(path) || path.includes('..')) {
    return json(res, 400, { message: 'Invalid registration document path.' });
  }

  const fileName = path.split('/').pop() || 'registration-document';
  try {
    const response = await fetch(
      `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/sign/${encodeURIComponent(BUCKET)}`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          paths: [path],
          expiresIn: 300
        })
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(res, response.status, {
        message: body.message || body.error || 'Unable to create a document access URL.'
      });
    }

    const signedUrl = signedUrlFromResponse(body);
    if (!signedUrl) {
      return json(res, 502, { message: 'Supabase did not return a document access URL.' });
    }

    let accessUrl = absoluteStorageUrl(signedUrl);
    if (download) {
      const downloadUrl = new URL(accessUrl);
      downloadUrl.searchParams.set('download', fileName);
      accessUrl = downloadUrl.toString();
    }

    return json(res, 200, {
      url: accessUrl,
      fileName
    });
  } catch (error) {
    return json(res, 502, { message: error.message || 'Unable to reach Supabase Storage.' });
  }
};