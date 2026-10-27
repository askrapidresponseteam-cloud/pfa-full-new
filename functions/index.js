'use strict';

/* The whole API as one Cloud Function.
 *
 * api/index.js is a plain Node handler - `async (request, response)` with no
 * Vercel SDK anywhere - so it drops straight into onRequest. One thing differs
 * from Vercel, and the router already handles it:
 *
 *   Vercel rewrote /api/<x> to /api/index?__route=<x>. Firebase Hosting cannot
 *   add a query parameter in a rewrite, but the router falls back to reading
 *   the pathname, so /api/<x> resolves on its own.
 *
 * A second case, /products/<handle>, injected parameters from the path. It
 * retired with the shop.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
/* Settings that are not secrets, so they live here rather than in a file a
   fresh unzip does not have. On 8 Oct 2026 a deploy from a newly unzipped
   folder had no functions/.env, the function lost PFA_SMTP_USER, and the
   panel said "No email can leave the site" while the password sat ready in
   Secret Manager. functions/.env still overrides either one.

   PUBLIC_SITE_URL is where links in emails (the panel link in the inbox
   copy, the tracking link people get) and the CCAvenue return point. It is
   this deployment's own address, not peopleforanimalsindia.org, because on
   8 Oct 2026 that domain still served PFA's old site, where those links
   would land on nothing. Change it here once the domain points at this site. */
const DEFAULTS = {
  PFA_SMTP_USER: 'info@peopleforanimalsindia.org',
  PUBLIC_SITE_URL: 'https://pfa-new-website.web.app'
};
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!String(process.env[key] || '').trim()) process.env[key] = value;
}

const router = require('./api/index.js');

const REGION = 'asia-south1';   // Mumbai, beside the Firestore database

/* The secrets each function reads. Firebase mounts a secret from Secret
   Manager only into a function that names it here; one set with
   `firebase functions:secrets:set` and not named is simply absent, and
   until 7 Oct 2026 none was named, so email through info@ and the two
   schedules could never have worked on this deployment. They are named in
   functions/.env as PFA_FUNCTION_SECRETS=A,B,C: naming one that does not
   exist in Secret Manager fails the deploy, so the list is explicit.
   Since the evening of 7 Oct 2026 nothing is named unconditionally: naming
   PFA_SMTP_PASS and CRON_SECRET always meant a project without them could
   not deploy the API at all. scripts/firebase-secrets.js (part of
   npm run deploy:firebase) writes PFA_FUNCTION_SECRETS from what Secret
   Manager actually holds, so every secret that exists is mounted and a
   missing one turns off only its own feature. */
const SECRETS = [...new Set(String(process.env.PFA_FUNCTION_SECRETS || '').split(',').map((s) => s.trim()).filter(Boolean))];

exports.api = onRequest(
  { region: REGION, memory: '512MiB', timeoutSeconds: 60, invoker: 'public', secrets: SECRETS },
  async (request, response) => {
    return router(request, response);
  }
);

/* vercel.json ran this at 03:00 daily. Cloud Scheduler does it here, and the
   worker checks CRON_SECRET itself, so the schedule is the only change.

   27 Oct 2026: this is now the ten-minute job, and the reading of replies
   below has the two-minute schedule to itself (owner: "The info@ check
   could run every 2 minutes instead of every 10"). The same two Cloud
   Scheduler jobs as before, so nothing is added to the bill. Each part runs
   on its own, so one failing never stops the others:
   - the email worker: emails waiting for another try are sent within
     minutes (a refused login backs off on its own, lib/caregiver-store.js),
     and payments whose callback never came are asked about and settled
     (lib/payment-reconcile.js);
   - the panel's search index takes in what changed (lib/admin-search.js);
   - the watch on the reading of replies (lib/reply-watch.js): if replies
     have not been read for thirty minutes, the reading has stopped running
     and cannot say so itself, so it is said from here. */
exports.caregiverEmailWorker = onSchedule(
  { region: REGION, schedule: 'every 10 minutes', timeZone: 'Asia/Kolkata', memory: '512MiB', timeoutSeconds: 300, secrets: SECRETS },
  async () => {
    /* The worker checks CRON_SECRET itself, and it does - but until 7 Oct
       2026 nothing was presenting one. With no Authorization header the
       worker answered 401 every night and no caregiver email was ever sent
       from this deployment. */
    const token = String(process.env.CRON_SECRET || process.env.PFA_ADMIN_TOKEN || '');
    try {
      const worker = require('./lib/routes/caregiver/email-worker.js');
      const request = {
        method: 'POST', url: '/api/caregiver/email-worker', query: {}, body: {},
        headers: token ? { authorization: `Bearer ${token}` } : {}
      };
      const response = {
        statusCode: 200, _body: '',
        setHeader() {}, end(body) { this._body = body || ''; }
      };
      await worker(request, response);
      console.log('caregiver email worker', response.statusCode, String(response._body).slice(0, 200));
    } catch (error) {
      console.error('email worker failed', String(error && error.message).slice(0, 300));
    }
    try {
      const SEARCH = require('./lib/admin-search.js');
      const { getDb } = require('./lib/firebase.js');
      const ran = await SEARCH.sync(getDb(), { budgetMs: 60000 });
      console.log('admin search index', JSON.stringify(ran));
    } catch (error) {
      console.error('admin search index not brought up to date', String(error && error.message).slice(0, 300));
    }
    try {
      const WATCH = require('./lib/reply-watch.js');
      const { getDb } = require('./lib/firebase.js');
      const seen = await WATCH.watch(getDb());
      console.log('reply watch', JSON.stringify(seen).slice(0, 300));
    } catch (error) {
      console.error('reply watch failed', String(error && error.message).slice(0, 300));
    }
  }
);

/* Replies to the copies sent to PFA's inbox are read from the site's own
   mailbox and filed on the submission (lib/inbound-mail.js). Vercel Hobby
   can only do this once a day; Cloud Scheduler does it every two minutes
   (owner, 27 Oct 2026: "makes a typed Reply feel almost instant to the
   applicant"). Only the reading runs here, so a run is short; one reading
   at a time is kept by a lease on its record, and the route checks after
   each reading whether replies are being picked up (lib/reply-watch.js).
   Two minutes is 720 runs a day, well inside the free allowance. */
exports.inboundMailCheck = onSchedule(
  { region: REGION, schedule: 'every 2 minutes', timeZone: 'Asia/Kolkata', memory: '512MiB', timeoutSeconds: 110, secrets: SECRETS },
  async () => {
    const route = require('./lib/routes/inbound-mail.js');
    const token = String(process.env.CRON_SECRET || process.env.PFA_ADMIN_TOKEN || '');
    const request = {
      method: 'POST', url: '/api/inbound-mail', query: {}, body: {},
      headers: token ? { authorization: `Bearer ${token}` } : {}
    };
    const response = { statusCode: 200, _body: '', setHeader() {}, end(body) { this._body = body || ''; } };
    try {
      await route(request, response);
      console.log('inbound mail check', response.statusCode, String(response._body).slice(0, 300));
    } catch (error) {
      console.error('inbound mail check failed', String(error && error.message).slice(0, 300));
    }
  }
);
