/* GET /api/admin/attachment?reference=PFA-C-2026-00042&n=1
   GET /api/admin/attachment?reference=PFA-C-2026-00042&n=in-3f2a...-1

   A photo sent with a report, for the panel, or a file that came with a
   reply filed on the conversation (lib/inbound-mail.js names those by the
   message they arrived with). The bytes live in the private Storage bucket
   (or, for older records, in Firestore beside the submission) and nowhere
   public; this is the only way out, and it needs an administrator's token.
   Returned as base64 in JSON because the panel fetches with a bearer
   header, which an <img src> cannot send.

   8 Oct 2026 (review D4): a file that could not be read just now used to
   come back as an empty 200, which the panel showed as no photo at all.
   It reads with FILES.readStrict now and says what happened: 503 "try
   again" for a refusal or timeout, 404 FILE_MISSING when the record points
   at a file that is not there. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb } = require('../../../lib/firebase');
const S = require('../../../lib/submissions');
const FILES = require('../../../lib/file-store');

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const who = await requireAdmin(request, response, 'submissions');
  if (!who) return;

  const query = request.query || {};
  const reference = String(query.reference || '').trim().toUpperCase().replace(/\s+/g, '');
  const raw = String(query.n || '').trim();
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  const fromMessage = /^in-[a-f0-9]{24}-\d{1,2}$/.test(raw);
  if (!S.isReference(reference) || !(fromMessage || (n >= 1 && n <= S.MAX_PHOTOS_ANY))) {
    return sendJson(response, 400, { code: 'BAD_REQUEST', message: 'Which photo?' });
  }

  try {
    const snapshot = await getDb().collection('submissions').doc(reference).collection('attachments').doc(fromMessage ? raw : String(n)).get();
    if (!snapshot.exists) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'No such photo.' });
    const data = snapshot.data() || {};
    /* from the Storage bucket, or from the document for older records;
       null only for a file emptied on purpose (a used staging copy) */
    let bytes;
    try {
      bytes = (await FILES.readStrict(data)) || Buffer.alloc(0);
    } catch (error) {
      console.error('admin attachment not readable', { reference, n: raw, reason: error.reason, message: String(error.message).slice(0, 200) });
      if (error.code === 'FILE_MISSING') {
        return sendJson(response, 404, { code: 'FILE_MISSING', message: 'This file is on record, but its contents could not be found in storage.' });
      }
      response.setHeader('Retry-After', '30');
      return sendJson(response, 503, { code: 'FILE_UNAVAILABLE', message: 'That file could not be opened just now. Please try again in a minute.' });
    }
    return sendJson(response, 200, {
      ok: true, reference, n: fromMessage ? raw : n,
      label: data.label || '',
      contentType: S.imageType(bytes) || data.contentType || 'image/jpeg',
      size: bytes.length,
      data: bytes.toString('base64')
    });
  } catch (error) {
    console.error('admin attachment failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That photo could not be read.' });
  }
};
