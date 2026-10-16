#!/usr/bin/env node
'use strict';

/* Tells Firebase how many Hosting versions to keep, and makes it stick.
 *
 *   node scripts/hosting-retention.js            (run by scripts/ship.sh)
 *   node scripts/hosting-retention.js --check    (report, change nothing)
 *
 * Firebase Hosting keeps every version you have ever deployed, for ever, by
 * default, and storage is the sum of all of them. The setting that caps it is
 * retainedReleaseCount on the live channel. It exists in the console under
 * Hosting > the site's three dot menu > Release storage settings, which is a
 * place nobody looks until the project is at 9.73 GB of 10, which is where
 * this one was on 13 Oct 2026.
 *
 * So it is set from here instead, on every ship, from the same service account
 * the rest of the release uses. Setting it to the number it already is changes
 * nothing, so this is safe to run as often as it likes. Content over the limit
 * is scheduled for deletion by Firebase, oldest first, which is what reclaims
 * the storage already used.
 *
 * This never stops a release. A project that cannot be reached keeps its
 * current setting and the deploy goes ahead: the build has already bounded the
 * bundle (scripts/hosting-limits.js), so a missed run here cannot do damage on
 * its own, it only leaves the older versions in place a while longer.
 */

const fs = require('fs');
const path = require('path');
const { RETAINED_RELEASES } = require('./hosting-limits.js');

const API = 'https://firebasehosting.googleapis.com/v1beta1';

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  /* Run on its own, outside ship.sh: use the same key chooser the rest of the
     release uses, so this can never land on a different project. */
  try {
    const { execFileSync } = require('child_process');
    /* stderr is swallowed on purpose. The finder explains at length how to
       generate a key, which is the right thing to say when a release needs
       one and the wrong thing to say here: not finding one is not a problem,
       it just means the version cap keeps whatever value it already has. */
    const found = execFileSync(process.execPath, [path.join(__dirname, 'firebase-project.js'), '--find'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found && fs.existsSync(found)) return JSON.parse(fs.readFileSync(found, 'utf8'));
  } catch { /* no key, or no project: handled by the caller */ }
  return null;
}

async function token(sa) {
  /* The subpath, never require('firebase-admin'). Under Node 22 the legacy
     root namespace does not survive the package's exports map and the call
     throws "admin.auth is not a function"; test/admin-audit.test.js holds
     lib/, scripts/ and api/ to the subpaths for that reason. */
  const { cert } = require('firebase-admin/app');
  const granted = await cert(sa).getAccessToken();
  return granted.access_token;
}

async function call(method, url, accessToken, body) {
  const res = await fetch(url, {
    method,
    headers: Object.assign(
      { Authorization: `Bearer ${accessToken}` },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error page, not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  const check = process.argv.includes('--check');
  const sa = serviceAccount();
  if (!sa || !sa.project_id) {
    console.log('  no service account to hand, so the retained version count is left as it is.');
    console.log(`  to set it by hand: Firebase console > Hosting > the site's three dot menu > Release storage settings > ${RETAINED_RELEASES}`);
    return 0;
  }

  const project = sa.project_id;
  /* The default site's id is the project id. A project with several sites
     would name them here; this one has the default site only. */
  const site = process.env.PFA_HOSTING_SITE || project;
  const url = `${API}/sites/${encodeURIComponent(site)}/channels/live`;

  let accessToken;
  try {
    accessToken = await token(sa);
  } catch (e) {
    console.log(`  could not authenticate to set the retained version count (${e.message}). Left as it is.`);
    return 0;
  }

  const before = await call('GET', url, accessToken);
  if (!before.ok) {
    console.log(`  could not read the live channel on ${site} (HTTP ${before.status}). Retained version count left as it is.`);
    return 0;
  }
  const current = before.json && before.json.retainedReleaseCount;
  console.log(`  site ${site}: keeping ${current === undefined ? 'every version (the default)' : current + ' versions'}`);

  if (current === RETAINED_RELEASES) {
    console.log(`  already ${RETAINED_RELEASES}, nothing to change`);
    return 0;
  }
  if (check) {
    console.log(`  --check: would set it to ${RETAINED_RELEASES}`);
    return 0;
  }

  const after = await call('PATCH', `${url}?updateMask=retainedReleaseCount`, accessToken, { retainedReleaseCount: RETAINED_RELEASES });
  if (!after.ok) {
    console.log(`  could not set the retained version count (HTTP ${after.status}). Left as it is.`);
    if (after.json && after.json.error && after.json.error.message) console.log(`  ${after.json.error.message}`);
    return 0;
  }
  console.log(`  set to ${RETAINED_RELEASES}. Firebase schedules everything older for deletion, oldest first.`);
  if (current === undefined) {
    console.log('  the storage already used is reclaimed over the next day or so; the Usage chart is an estimate and updates every 24 hours.');
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    /* Never stop a release over this. */
    console.log(`  the retained version count could not be set (${e.message}). Left as it is.`);
    process.exit(0);
  });
}

module.exports = { serviceAccount, RETAINED_RELEASES };
