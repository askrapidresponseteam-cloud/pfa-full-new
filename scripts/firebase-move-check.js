#!/usr/bin/env node
'use strict';

/* Is the website on Firebase ready to take peopleforanimalsindia.org from
   Vercel? (owner, 24 Nov 2026: "cant risk a disruption in the service ...
   once firebase is perfect.. I will migrate").

     node scripts/firebase-move-check.js
     node scripts/firebase-move-check.js https://<site>.web.app

   Reads, from this computer, the site Vercel serves and the copy on Firebase,
   and checks, without anyone's details or any setting's value:
     - both run the same build;
     - every page and the files the pages load answer on Firebase;
     - the API answers there: the forms, the chat, the visit counter, the shop;
     - the old addresses still redirect;
     - Firebase has every setting Vercel has (payments, email, the shop's
       orders, photographs), by name, and the same tracking key;
     - payments are switched on and email can leave.
   Ends with READY or NOT READY and, for each thing missing, the one command
   or line that mends it. DEPLOY.command runs it after every deploy. Nothing
   here changes anything. */

const VERCEL = 'https://pfa-full-website.vercel.app';
const DOMAIN = 'https://peopleforanimalsindia.org';
const PROJECT = 'pfa-new-website';

/* the pages a visitor lands on, and what they load */
const PAGES = ['/', '/donate', '/report', '/get-involved', '/cinekind', '/pet-health', '/rabies', '/units', '/laws', '/shop',
  '/track', '/verify-certificate', '/internship', '/events', '/wall', '/founder', '/privacy', '/ask', '/careers',
  '/assets/assistant-answers.json', '/search-index.json', '/robots.txt', '/sitemap.xml', '/.well-known/security.txt'];
/* what the pages ask the server, by GET, with what a working answer is */
const API = [
  ['/api/payment/health', [200, 503]],
  ['/api/live-chat', [200]],
  ['/api/site-visibility', [200]],
  ['/api/chat-taught', [200]],
  ['/api/med-notes', [200]],
  ['/api/shop/pieces', [200]],
  ['/api/wall', [200]],
  ['/api/location-lookup?pin=110001', [200]],
  ['/api/signature?for=card', [200, 302]]
];
const REDIRECTS = [['/the-wire', '/newsroom.html'], ['/make-a-gift.html', '/donate.html?gift=1'], ['/dispatch', '/newsroom.html']];

/* a key or a password: set in Secret Manager. Anything else: a line in functions/.env. */
const SECRET = /(KEY|PASS|SECRET|TOKEN|PEPPER|SERVICE_ACCOUNT|WORKING|ACCESS_CODE|MERCHANT_ID)/;

async function get(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, Object.assign({ redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'pfa-move-check' } }, opts));
    const text = await r.text().catch(() => '');
    return { status: r.status, location: r.headers.get('location') || '', text };
  } catch (e) {
    return { status: 0, location: '', text: '', error: e.name === 'AbortError' ? 'no answer in 20 seconds' : e.message };
  } finally { clearTimeout(t); }
}
function json(text) { try { return JSON.parse(text); } catch (_) { return null; } }
function buildOf(html) { const m = String(html || '').match(/pfa-build" content="([^"]+)"/); return m ? m[1] : ''; }

async function main() {
  let site = process.argv[2] && /^https:\/\//.test(process.argv[2]) ? process.argv[2].replace(/\/+$/, '') : '';
  if (!site) { try { site = require('./firebase-site.js').siteUrl(); } catch (_) { site = ''; } }
  if (!site) {
    console.log('The website has no Hosting site on Firebase yet. Deploy once (DEPLOY.command), then run this again.');
    return 1;
  }
  const problems = [];
  const fixes = [];
  const say = (ok, text) => { console.log(`  ${ok ? 'ok ' : 'NO '} ${text}`); if (!ok) problems.push(text); };

  /* which one is Vercel: the domain, until it has been moved */
  const domainHealth = json((await get(`${DOMAIN}/api/payment/health`)).text) || {};
  const moved = domainHealth.host === 'firebase';
  const vercel = moved ? VERCEL : DOMAIN;
  console.log(`Vercel:   ${vercel}${moved ? '  (peopleforanimalsindia.org already points at Firebase)' : ''}`);
  console.log(`Firebase: ${site}\n`);

  console.log('The same build');
  const vHome = await get(`${vercel}/`);
  const fHome = await get(`${site}/`);
  const vb = buildOf(vHome.text), fb = buildOf(fHome.text);
  say(fb && (fb === vb || !vb), `Firebase runs ${fb || 'nothing readable'}${vb ? `, Vercel ${vb}` : ''}`);

  console.log('\nPages and the files they load');
  for (const p of PAGES) {
    const r = await get(site + p);
    say(r.status === 200, `${p}  ${r.status || r.error}`);
  }

  console.log('\nThe server behind the pages');
  for (const [p, okStatus] of API) {
    const r = await get(site + p);
    say(okStatus.includes(r.status), `${p}  ${r.status || r.error}`);
  }

  console.log('\nOld addresses still arrive');
  for (const [from, to] of REDIRECTS) {
    const r = await get(site + from);
    /* Firebase keeps the query open with a trailing & (donate.html?gift=1&) */
    const ok = [301, 308].includes(r.status) && r.location.replace(/^https?:\/\/[^/]+/, '').replace(/[?&]+$/, '') === to;
    say(ok, `${from} -> ${to}  (${r.status}${r.location ? ' ' + r.location : ''})`);
  }

  console.log('\nSettings: Firebase has everything Vercel has (names only, never values)');
  const vh = moved ? (json((await get(`${VERCEL}/api/payment/health`)).text) || {}) : domainHealth;
  const fh = json((await get(`${site}/api/payment/health`)).text) || {};
  if (!Array.isArray(vh.settings) || !Array.isArray(fh.settings)) {
    say(false, 'could not read the settings of both servers (deploy this build to both first)');
  } else {
    const missing = vh.settings.filter((n) => !fh.settings.includes(n));
    say(missing.length === 0, missing.length ? `Firebase lacks ${missing.length}: ${missing.join(', ')}` : `all ${vh.settings.length} of Vercel's settings are on Firebase`);
    for (const n of missing) {
      if (SECRET.test(n)) fixes.push(`npx firebase-tools functions:secrets:set ${n} --project ${PROJECT}     (paste the value from Vercel > Settings > Environment Variables)`);
      else fixes.push(`add the line  ${n}=<the value in Vercel>  to ~/Desktop/PFA_Website/functions/.env`);
    }
    say(vh.pepper === fh.pepper, `the same tracking key (PFA_AUTH_PEPPER) on both${vh.pepper === fh.pepper ? '' : ': copy Vercel\'s to Firebase'}`);
    if (vh.pepper !== fh.pepper) fixes.push(`npx firebase-tools functions:secrets:set PFA_AUTH_PEPPER --project ${PROJECT}     (the value from Vercel)`);
  }
  say(fh.ok === true, `payments are switched on (CCAvenue's keys, the database)${fh.ccavenue ? '' : ''}`);
  say(fh.mail === true, 'email can leave (acknowledgements, receipts, welcome letters)');
  say(!vh.shopOrders || fh.shopOrders === vh.shopOrders, `shop orders go where Vercel sends them (${fh.shopOrders || '?'}${vh.shopOrders ? ' / ' + vh.shopOrders : ''})`);
  say(!vh.files || fh.files === vh.files, `photographs are kept where Vercel keeps them (${fh.files || '?'})`);

  console.log('');
  if (!problems.length) {
    console.log('READY: the website on Firebase does everything the one on Vercel does.');
    console.log('Next: Firebase console > Hosting > the website\'s site > Add custom domain (see the steps in ARCHITECTURE.md, "Moving the website to Firebase").');
    return 0;
  }
  console.log(`NOT READY: ${problems.length} thing${problems.length === 1 ? '' : 's'} above. Keep the domain on Vercel for now.`);
  if (fixes.length) {
    console.log('\nTo mend the settings, then deploy again:');
    for (const f of [...new Set(fixes)]) console.log(`  ${f}`);
  }
  return 1;
}

if (require.main === module) main().then((code) => process.exit(code)).catch((e) => { console.log(`The check could not run: ${e.message}`); process.exit(1); });
module.exports = { PAGES, API, REDIRECTS, SECRET, buildOf };
