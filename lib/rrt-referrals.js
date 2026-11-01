'use strict';

/* Interns' RRT referral codes, kept in step with the RRT's own backend.

   The RRT (rapid-response.in and its app) records what happens to each
   code, first party and free: a click on the link, a tap through to the
   store, a first open of the app with the code, and a completed
   registration. Only a completed registration counts toward the week 3
   target; the other three are shown apart, never as joins. The RRT never
   tells PFA who registered: only the four counts per code.

   This side registers each intern's code there (with the intern's mobile,
   hashed, so the intern cannot credit their own registration), withdraws
   the code of an intern whose access is withdrawn (credits already earned
   stay), and reads the counts back: every six hours from the email worker,
   or on demand from the panel.

   PFA_RRT_API             the RRT backend (default: its Cloud Function)
   PFA_RRT_REFERRAL_SECRET the shared key; the RRT has the same in
                           REFERRAL_PARTNER_KEY. Without it nothing is sent
                           and the dashboard says counts are not connected. */

const META = { collection: 'intern_meta', doc: 'rrt' };
const EVERY_MS = 6 * 3600000;
const DEFAULT_API = 'https://asia-south1-rrt-new-backend.cloudfunctions.net/api';

function api() { return String(process.env.PFA_RRT_API || DEFAULT_API).replace(/\/+$/, ''); }
function secret() { return String(process.env.PFA_RRT_REFERRAL_SECRET || '').trim(); }
function configured() { return secret().length >= 16; }

async function call(path, { method = 'GET', body, fetchImpl, timeoutMs = 8000 } = {}) {
  const f = fetchImpl || global.fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(`${api()}${path}`, {
      method,
      headers: Object.assign({ 'x-pfa-referral-key': secret(), Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    if (!r.ok) {
      const e = new Error((json && (json.message || json.error)) || `The RRT answered ${r.status}.`);
      e.status = r.status;
      throw e;
    }
    return json || {};
  } finally {
    clearTimeout(timer);
  }
}

/* One code, there and active (or withdrawn). Idempotent on the RRT side. */
async function register(db, intern, deps = {}) {
  if (!configured() || !intern || !intern.referralCode) return { state: 'not-configured' };
  const active = intern.status !== 'revoked';
  await call('/referrals/codes', {
    method: 'POST', fetchImpl: deps.fetchImpl,
    body: { code: intern.referralCode, label: intern.internId, owner: 'pfa-internship', ownerMobileHash: intern.mobileHash || '', active }
  });
  await db.collection('interns').doc(intern.internId).set({ referralRegistered: active ? 'active' : 'withdrawn', referralRegisteredAt: new Date().toISOString() }, { merge: true });
  return { state: active ? 'active' : 'withdrawn' };
}

async function status(db) {
  const snap = await db.collection(META.collection).doc(META.doc).get();
  const d = snap.exists ? snap.data() || {} : {};
  return { configured: configured(), fetchedAt: d.fetchedAt || '', state: d.state || '', error: d.error || '', codes: Number(d.codes) || 0 };
}

/* Read every live code's counts and keep them on its intern. */
async function refresh(db, { force = false, nowMs = Date.now(), fetchImpl } = {}) {
  if (!configured()) return { state: 'not-configured' };
  const metaRef = db.collection(META.collection).doc(META.doc);
  const meta = await metaRef.get();
  const last = meta.exists ? Date.parse((meta.data() || {}).fetchedAt || '') || 0 : 0;
  if (!force && nowMs - last < EVERY_MS) return { state: 'fresh' };
  const snap = await db.collection('interns').get();
  const interns = (snap.docs || []).map((d) => Object.assign({ internId: d.id }, d.data())).filter((i) => i.referralCode && i.status !== 'reserving');
  try {
    for (const i of interns) {
      const want = i.status === 'revoked' ? 'withdrawn' : 'active';
      if (i.referralRegistered !== want) await register(db, i, { fetchImpl });
    }
    const codes = interns.map((i) => i.referralCode);
    const counts = {};
    for (let n = 0; n < codes.length; n += 100) {
      const r = await call(`/referrals/stats?codes=${encodeURIComponent(codes.slice(n, n + 100).join(','))}`, { fetchImpl });
      Object.assign(counts, r.codes || {});
    }
    const at = new Date(nowMs).toISOString();
    for (const i of interns) {
      const c = counts[i.referralCode] || {};
      await db.collection('interns').doc(i.internId).set({ referral: {
        clicks: Number(c.clicks) || 0, storeVisits: Number(c.storeVisits) || 0, firstOpens: Number(c.firstOpens) || 0,
        registrations: Number(c.registrations) || 0, fetchedAt: at
      } }, { merge: true });
    }
    await metaRef.set({ fetchedAt: at, state: 'ok', error: '', codes: codes.length }, { merge: true });
    return { state: 'ok', codes: codes.length };
  } catch (error) {
    await metaRef.set({ state: 'failed', error: String((error && error.message) || error).slice(0, 200), failedAt: new Date(nowMs).toISOString() }, { merge: true });
    return { state: 'failed', error: String((error && error.message) || error).slice(0, 200) };
  }
}

module.exports = { configured, register, refresh, status, api, EVERY_MS };
