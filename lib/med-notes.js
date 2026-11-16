'use strict';

/* Medical notes, for pet parents and caregivers (owner, 16 Nov 2026: "a pet
   parents/caregiver's section, where you can find medical information sent
   by owners of animals/caregivers/vet/doctors. allow new submissions also,
   it needs to go to the admin, gandhim. and once approved, submitter will
   get an email confirming success. also admin should have option to
   send/ask for edit, update").

   A note arrives as an ordinary submission (kind PFA-MED, through
   /api/pfa-submissions), so it is numbered, confirmed to the sender, copied
   to gandhim and filed in the panel like every other form. What is
   particular to it lives here:

     - the note itself, `record.note`: the words and files the site shows.
       It starts as what the sender sent. An administrator may correct it
       (save), the sender may update it through a private link when asked
       (ask-changes, then sender-update), and every earlier version is kept in
       `record.revisions`. Nothing is deleted: a file replaced by an update
       stays on the record, only no longer shown.
     - publication is the status: a note is on the site while it is
       "approved" (Published), and only then. Moving it to any other stage
       takes it off, so there is no second switch to forget.
     - the link that lets the sender update their note: one live link per
       note, 14 days, used once, kept only as a hash (medNoteLinks).
     - notes PFA put on the site itself, from data/med-notes.json (the first
       is the one-page guide to diabetes in dogs the owner supplied), each of
       which can be taken off and put back from the panel (medNoteSeeds). */

const crypto = require('crypto');
const RULES = require('../assets/field-rules.js');

const KIND = 'PFA-MED';
const LINKS = 'medNoteLinks';
const SEEDS = 'medNoteSeeds';
const LINK_DAYS = 14;
const LINK_MS = LINK_DAYS * 24 * 60 * 60 * 1000;
const MAX_FILES = 6;
const ASK_MAX = 2000;

/* What the site shows of a note, in the order the form asks for it. */
const CONTENT = ['role', 'regNo', 'animal', 'title', 'summary', 'noteText', 'sources', 'credit'];
const REQUIRED = {
  role: 'Choose who you are.',
  animal: 'Choose the animal it is about.',
  title: 'Give the note a title.',
  summary: 'Say in a few lines what the note covers.',
  credit: 'Say how your name should appear with the note.'
};
const LIMITS = { regNo: 60, title: 140, summary: 240, noteText: 8000, sources: 400, credit: 120 };

function options() {
  return require('./submission-fields').KINDS[KIND].options;
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max || 400);
}

/* ---- the note ------------------------------------------------------------ */

function filesOf(record) {
  const d = record || {};
  if (d.note && Array.isArray(d.note.files)) return d.note.files.map(String).filter((n) => /^\d{1,2}$/.test(n));
  const n = Math.max(0, Math.min(MAX_FILES, Number(d.attachments) || 0));
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

/* The note as it stands: what was corrected or updated, or what was sent. */
function noteOf(record) {
  const d = record || {};
  const from = d.note && typeof d.note === 'object' ? d.note : (d.fields || {});
  const out = {};
  CONTENT.forEach((k) => { out[k] = clean(from[k], LIMITS[k] || 120); });
  out.noteText = String(from.noteText == null ? '' : from.noteText).trim().slice(0, LIMITS.noteText);
  out.files = filesOf(d);
  return out;
}

/* A note given by an administrator or the sender, judged by the same rules
   the form uses. Resolves { errors, note }. */
function checkNote(given) {
  const g = given || {};
  const errors = [];
  const note = {};
  const opts = options();
  CONTENT.forEach((k) => {
    const raw = k === 'noteText' ? String(g[k] == null ? '' : g[k]).trim() : clean(g[k], (LIMITS[k] || 120) + 200);
    if (!raw) {
      if (REQUIRED[k]) errors.push({ field: k, message: REQUIRED[k] });
      note[k] = '';
      return;
    }
    let message = RULES.checkField(k, raw, { options: opts[k], optionMessage: REQUIRED[k] });
    if (!message && LIMITS[k] && raw.length > LIMITS[k]) message = `Keep this under ${LIMITS[k]} characters.`;
    if (message) errors.push({ field: k, message });
    note[k] = opts[k] ? RULES.squash(raw) : (k === 'noteText' ? RULES.normaliseField(k, raw) : RULES.normaliseField(k, raw));
  });
  return { errors, note };
}

function sameNote(a, b) {
  return CONTENT.every((k) => String((a || {})[k] || '') === String((b || {})[k] || ''))
    && JSON.stringify((a || {}).files || []) === JSON.stringify((b || {}).files || []);
}

function changedKeys(a, b) {
  const out = CONTENT.filter((k) => String((a || {})[k] || '') !== String((b || {})[k] || ''));
  if (JSON.stringify((a || {}).files || []) !== JSON.stringify((b || {}).files || [])) out.push('files');
  return out;
}

const WORDS = { role: 'who they are', regNo: 'registration number', animal: 'animal', title: 'title', summary: 'summary', noteText: 'text', sources: 'sources', credit: 'name shown', files: 'files shown' };
function describeChanges(keys) {
  const list = (keys || []).map((k) => WORDS[k] || k);
  return list.length ? list.join(', ') : 'nothing';
}

function isPublished(record) {
  const d = record || {};
  return d.kind === KIND && d.status === 'approved';
}

/* ---- what the public may see --------------------------------------------- */

function fileUrl(reference, n) {
  return `/api/med-notes?ref=${encodeURIComponent(reference)}&file=${encodeURIComponent(n)}`;
}

/* Only what the note says and who it is credited to. Never the sender's
   name as typed, their email, mobile, address, or anything PFA wrote. */
function publicOf(reference, record, files) {
  const d = record || {};
  const n = noteOf(d);
  if (!n.title || !n.summary) return null;
  const meta = files || {};
  return {
    id: reference,
    title: n.title,
    summary: n.summary,
    text: n.noteText,
    animal: n.animal,
    role: n.role,
    credit: n.credit,
    sources: n.sources,
    at: (d.published && d.published.at) || d.createdAt || null,
    files: n.files.map((f) => Object.assign({ url: fileUrl(reference, f) }, meta[f] || {}))
  };
}

/* Notes PFA put on the site itself. Read once; a missing or broken file is
   no notes, never an error on the page. */
let seedCache = null;
function seeds() {
  if (seedCache) return seedCache;
  try {
    /* required, not read, so the deploy's file tracer bundles it */
    const raw = require('../data/med-notes.json');
    seedCache = (Array.isArray(raw.notes) ? raw.notes : []).filter((s) => s && s.id && s.title && s.summary);
  } catch (error) {
    console.warn('med-notes: data/med-notes.json not read', error && error.message);
    seedCache = [];
  }
  return seedCache;
}

function seedPublic(seed) {
  return {
    id: `pfa-${seed.id}`,
    title: seed.title,
    summary: seed.summary,
    text: seed.text || '',
    animal: seed.animal || '',
    role: seed.role || '',
    credit: seed.credit || '',
    sources: seed.sources || '',
    at: seed.at || null,
    files: (seed.files || []).map((f) => ({ url: `/${String(f.src).replace(/^\/+/, '')}`, type: f.type || 'application/pdf', size: Number(f.size) || 0, label: f.label || '' }))
  };
}

/* ---- the sender's link ---------------------------------------------------- */

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function newToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

function isToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

/* What a link can do now: the link knows its time and use, the record knows
   which link is current and whether changes are still wanted. */
function linkState(link, record, nowMs) {
  if (!link) return 'unknown';
  const d = record || {};
  if (link.usedAt) return 'used';
  const current = d.changes && d.changes.linkHash;
  if (current && current !== link.hash) return 'replaced';
  if (d.status !== 'changes') return 'closed';
  const expires = Date.parse(link.expiresAt || '');
  if (!Number.isFinite(expires) || expires <= nowMs) return 'expired';
  return 'live';
}

const SAY = {
  unknown: 'This link is not one we recognise. Check you opened the whole link from the email, or write to PFA for a new one.',
  expired: 'This link has expired. Write to PFA and you will be sent a new one.',
  used: 'This link has already been used to update your note. PFA is reading it; you will hear by email.',
  replaced: 'A newer link has been sent to your email. Please use the latest email from PFA.',
  closed: 'This note no longer needs updating. If you think that is a mistake, write to PFA.'
};

function editLink(site, token) {
  return `${String(site || '').replace(/\/+$/, '')}/pet-health.html#edit=${encodeURIComponent(token)}`;
}

function pageLink(site, reference) {
  return `${String(site || '').replace(/\/+$/, '')}/pet-health.html#note=${encodeURIComponent(reference)}`;
}

/* The sender's own name and email, from what they sent. */
function senderOf(record) {
  const f = (record && record.fields) || {};
  return { name: clean(f.name, 80), email: clean(f.email, 254).toLowerCase() };
}

module.exports = {
  KIND, LINKS, SEEDS, LINK_DAYS, LINK_MS, MAX_FILES, ASK_MAX, CONTENT, LIMITS, SAY,
  clean, noteOf, filesOf, checkNote, sameNote, changedKeys, describeChanges, isPublished,
  publicOf, fileUrl, seeds, seedPublic, hashToken, newToken, isToken, linkState, editLink, pageLink, senderOf,
  _resetSeeds() { seedCache = null; }
};
