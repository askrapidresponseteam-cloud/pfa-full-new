'use strict';
/* Films and pictures uploaded from the panel for "From PFA" updates
   (lib/site-updates.js).

   A film is far bigger than any request the server can take (Firebase
   functions stop at 32 MB, Vercel at 4.5 MB), so the bytes never pass
   through it. The server opens a resumable upload in the project's Storage
   bucket (the bucket lib/file-store.js finds) for the panel's own address,
   and hands the panel that one upload's address; the panel sends the file
   straight to Storage, showing how far it has got, then asks the server to
   check it.

   The bucket stays private (storage.rules refuses every browser). A file
   under public/updates/ is given a Firebase download token when it is
   opened, and is read back through Firebase Storage's address with that
   token, which is how every visitor's browser plays it: with range
   requests, so a film can be skipped through without downloading it all.
   Nothing else in the bucket has a token, so nothing else is reachable.

     start({ kind: 'video' | 'photo', type, size, origin })
       -> { ok, upload, path }          upload is where the panel PUTs the file
     finish(path)
       -> { ok, url, type, size }       url is what the update keeps */

const crypto = require('crypto');
const FS = require('./file-store');

const LIMITS = {
  video: { types: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }, max: 1024 * 1024 * 1024, say: '1 GB' },
  photo: { types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, max: 10 * 1024 * 1024, say: '10 MB' }
};
const PATH = /^public\/updates\/\d{4}\/[a-f0-9]{24}\.(mp4|webm|mov|jpg|png|webp)$/;

let stub = null;   // tests: () => { name, bucket } as FS.bucket() gives
function where() { return stub ? Promise.resolve(stub()) : FS.bucket(); }

function urlOf(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

const ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(web\.app|firebaseapp\.com|vercel\.app|peopleforanimalsindia\.org)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

async function start(o) {
  const opt = o || {};
  const L = LIMITS[opt.kind];
  if (!L) return { ok: false, message: 'Say whether it is a film or a picture.' };
  const ext = L.types[String(opt.type || '').toLowerCase()];
  if (!ext) return { ok: false, message: opt.kind === 'video' ? 'Films can be MP4, WebM or MOV.' : 'Pictures can be JPG, PNG or WebP.' };
  const size = Number(opt.size) || 0;
  if (size <= 0) return { ok: false, message: 'That file is empty.' };
  if (size > L.max) return { ok: false, message: `That file is larger than ${L.say}.` };
  const origin = ORIGIN.test(String(opt.origin || '')) ? String(opt.origin) : '';
  if (!origin) return { ok: false, message: 'Uploads are only taken from the admin panel.' };
  const w = await where();
  if (!w) return { ok: false, storage: false, message: 'Uploading needs Storage switched on in Firebase. Paste a YouTube, Vimeo, Instagram or Facebook link instead for now.' };
  const path = `public/updates/${new Date().getUTCFullYear()}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
  const token = crypto.randomUUID();
  const [upload] = await w.bucket.file(path).createResumableUpload({
    origin,
    metadata: { contentType: opt.type, cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } }
  });
  return { ok: true, upload, path };
}

async function finish(path) {
  const p = String(path || '');
  if (!PATH.test(p)) return { ok: false, message: 'That upload is not one of ours.' };
  const w = await where();
  if (!w) return { ok: false, message: 'Storage cannot be reached just now.' };
  let meta;
  try { [meta] = await w.bucket.file(p).getMetadata(); } catch (_) { return { ok: false, message: 'The file did not arrive. Upload it again.' }; }
  const type = String(meta.contentType || '');
  const kind = /^video\//.test(type) ? 'video' : 'photo';
  const size = Number(meta.size) || 0;
  if (!LIMITS[kind].types[type] || size <= 0 || size > LIMITS[kind].max) return { ok: false, message: 'That file is not a film or picture the site can show.' };
  const token = String(((meta.metadata || {}).firebaseStorageDownloadTokens || '')).split(',')[0];
  if (!/^[a-f0-9-]{36}$/.test(token)) return { ok: false, message: 'The file did not arrive. Upload it again.' };
  return { ok: true, url: urlOf(w.name, p, token), type, size, kind };
}

module.exports = { start, finish, urlOf, LIMITS, _stub(fn) { stub = fn; } };
