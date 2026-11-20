/**
 * Borderless community visions. The private Google Sheet is the source of truth.
 * The public Apps Script web app only accepts new Pending entries and returns
 * Approved entries. No Google credentials or Spreadsheet ID are stored here.
 */
const GOOGLE_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzfuTpLy48entco4j2SNa12o5UY9IC9p367BHgXKjQevznSDIoOswJslvcSgHAVz66a/exec';

function reply(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

async function googleJSON(options = {}) {
  const url = options.method === 'POST'
    ? GOOGLE_SCRIPT_URL
    : `${GOOGLE_SCRIPT_URL}?_=${Date.now()}`;
  const upstream = await fetch(url, {
    ...options,
    redirect: 'follow',
    headers: options.method === 'POST'
      ? { 'Content-Type': 'text/plain;charset=utf-8' }
      : { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
  });
  if (!upstream.ok) throw new Error(`Google Apps Script responded ${upstream.status}`);
  const data = await upstream.json();
  if (!data || typeof data !== 'object') throw new Error('Unexpected Apps Script response');
  return data;
}

export async function handleGoogleVisions(request) {
  if (request.method === 'GET') {
    try {
      const data = await googleJSON();
      if (data.error || !Array.isArray(data.visions)) throw new Error('Google Sheet is unavailable');
      // Never send private rows. The Apps Script itself selects Approved only.
      const visions = data.visions
        .filter(item => item && typeof item.vision === 'string' && item.vision.trim())
        .slice(-200)
        .map(item => ({ id: String(item.id || ''), vision: item.vision.trim().slice(0, 240) }));
      return reply({ visions });
    } catch (error) {
      console.error('Visions read error:', error);
      return reply({ visions: [], error: 'Visions are temporarily unavailable.' }, 503);
    }
  }

  if (request.method === 'POST') {
    try {
      const contentLength = Number(request.headers.get('content-length') || '0');
      if (contentLength > 2000) return reply({ error: 'Submission too long.' }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 2000) return reply({ error: 'Submission too long.' }, 413);
      const payload = JSON.parse(raw);
      if (payload && payload.website) return reply({ error: 'Unable to submit.' }, 400); // simple bot honeypot
      const vision = String(payload?.vision ?? '').replace(/\s+/g, ' ').trim();
      if ([...vision].length < 3 || [...vision].length > 120) {
        return reply({ error: 'Write between 3 and 120 characters.' }, 400);
      }
      // This function never authorizes approvals or any editing operation.
      const data = await googleJSON({ method: 'POST', body: JSON.stringify({ vision }) });
      if (data.ok !== true || !data.id) throw new Error('Apps Script did not confirm saving');
      return reply({ ok: true, id: String(data.id), vision });
    } catch (error) {
      console.error('Visions write error:', error);
      return reply({ error: 'Unable to save right now. Please try again.' }, 502);
    }
  }

  return reply({ error: 'Method not allowed.' }, 405);
}
