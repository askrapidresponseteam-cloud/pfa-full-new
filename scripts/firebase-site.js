#!/usr/bin/env node
'use strict';

/* The public website on Firebase Hosting (owner, 24 Nov 2026: "next month I
   plan to migrate main site to firebase", then "can you prep the whole site
   to work on firebase pls").

   The project has two Hosting sites, each with its own address:
     panel  pfa-new-website.web.app   the admin panel (public/), as before
     site   <SITE>.web.app            the public website (site/), the same
                                      pages Vercel serves, and the address
                                      peopleforanimalsindia.org is pointed at
   Two sites rather than one, so the panel's address is never the site's
   (owner, 12 Nov 2026: "we cant expose the firebase admin site url to
   people"), and so each keeps its own versions.

   A site's name is unique across all of Firebase, so the first of CANDIDATES
   that is free is created, once, and remembered in .firebaserc as the
   target "site". firebase.json's second hosting entry deploys to whatever
   that target names.

     node scripts/firebase-site.js            make sure the site exists (ship.sh)
     node scripts/firebase-site.js --name     print its name
     node scripts/firebase-site.js --url      print its address
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RC = path.join(ROOT, '.firebaserc');
const PROJECT = 'pfa-new-website';
const PANEL = 'pfa-new-website';
const CANDIDATES = ['peopleforanimalsindia', 'pfa-india-site', 'pfa-public-site', 'pfa-new-website-site'];

function readRc() { return JSON.parse(fs.readFileSync(RC, 'utf8')); }
/* the site's name, as .firebaserc has it, or '' before it is made */
function siteName() {
  try {
    const t = (((readRc().targets || {})[PROJECT] || {}).hosting || {}).site;
    return Array.isArray(t) && t[0] ? String(t[0]) : '';
  } catch (_) { return ''; }
}
function siteUrl() { const n = siteName(); return n ? `https://${n}.web.app` : ''; }
/* every Hosting site of the project: the panel's, and the website's once made */
function allSites() { return [PANEL].concat(siteName() ? [siteName()] : []); }

/* .firebaserc with the two targets; nothing else in it is touched */
function remember(name) {
  const rc = readRc();
  rc.targets = rc.targets || {};
  rc.targets[PROJECT] = rc.targets[PROJECT] || {};
  rc.targets[PROJECT].hosting = Object.assign({}, rc.targets[PROJECT].hosting, { panel: [PANEL], site: [name] });
  fs.writeFileSync(RC, JSON.stringify(rc, null, 2) + '\n');
}

function cli(args) {
  const direct = spawnSync('firebase', args, { encoding: 'utf8' });
  if (!direct.error) return direct;
  return spawnSync('npx', ['--yes', 'firebase-tools'].concat(args), { encoding: 'utf8' });
}
/* the project's sites, or null when Firebase could not be asked */
function listed(project) {
  const r = cli(['hosting:sites:list', '--project', project, '--json']);
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const sites = (j.result && (j.result.sites || j.result)) || [];
    return sites.map((s) => String(s.name || '').split('/').pop()).filter(Boolean);
  } catch (_) { return null; }
}

function ensure(project) {
  const have = listed(project);
  if (!have) { console.log('  Could not ask Firebase which Hosting sites exist (run `firebase login`?). Going on with .firebaserc as it is.'); return siteName(); }
  const known = siteName();
  if (known && have.includes(known)) { console.log(`  the website's Hosting site: ${known}.web.app`); return known; }
  /* made before, by another copy of this tree */
  const made = CANDIDATES.find((c) => have.includes(c));
  if (made) { remember(made); console.log(`  the website's Hosting site: ${made}.web.app`); return made; }
  for (const name of CANDIDATES) {
    const r = cli(['hosting:sites:create', name, '--project', project, '--non-interactive']);
    if (r.status === 0) { remember(name); console.log(`  made the website's Hosting site: ${name}.web.app`); return name; }
    const said = `${r.stdout || ''}${r.stderr || ''}`;
    if (!/already exists|taken|ALREADY_EXISTS|not available|reserved/i.test(said)) {
      console.log(`  Could not make the Hosting site ${name}: ${said.trim().split('\n').slice(-1)[0] || 'no reason given'}`);
      return '';
    }
  }
  console.log(`  None of ${CANDIDATES.join(', ')} is free. Add another name to CANDIDATES in scripts/firebase-site.js.`);
  return '';
}

module.exports = { siteName, siteUrl, allSites, remember, ensure, PROJECT, PANEL, CANDIDATES };

if (require.main === module) {
  if (process.argv.includes('--name')) { process.stdout.write(siteName()); process.exit(0); }
  if (process.argv.includes('--url')) { process.stdout.write(siteUrl()); process.exit(0); }
  const name = ensure(process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : PROJECT);
  process.exit(name ? 0 : 1);
}
