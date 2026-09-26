/**
 * Public browser configuration for the CarePoint frontend.
 *
 * SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY is safe to expose in a browser
 * when Supabase Row Level Security is configured correctly. Never return the
 * Supabase service-role key from this endpoint.
 */
module.exports = function configHandler(_req, res) {
  const url = process.env.SUPABASE_URL || 'https://zuufspuvmssicerrnfug.supabase.co';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');

  if (!anonKey) {
    res.statusCode = 503;
    res.end('window.SUPABASE_CONFIG_ERROR = "Missing SUPABASE_ANON_KEY";');
    return;
  }

  res.statusCode = 200;
  res.end(`window.SUPABASE_CONFIG = ${JSON.stringify({ url, anonKey })};`);
};