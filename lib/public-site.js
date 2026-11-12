'use strict';

/* The public site's address, for every link that goes to the public: a
   certificate, a tracking link, the logo and links in an email to a member,
   an intern or anyone who wrote to PFA.

   Owner, 12 Nov 2026: "we cant expose the firebase admin site url to
   people". On Firebase, PUBLIC_SITE_URL is the panel's own address
   (functions/index.js sets https://pfa-new-website.web.app), so a link
   built from it sent people to the admin site. So: PFA_PUBLIC_SITE_URL if
   set, then PUBLIC_SITE_URL (on Vercel, the site itself), then
   peopleforanimalsindia.org; a Firebase address (*.web.app,
   *.firebaseapp.com) is never used, whichever names it.

   Links for PFA's own staff (the panel link in the inbox copy, an admin
   invite) are not built here; they go to the panel on purpose. */

const DEFAULT_SITE = 'https://peopleforanimalsindia.org';
const FIREBASE_HOST = /(^|\.)(web\.app|firebaseapp\.com)$/i;

function originOf(value) {
  try {
    const u = new URL(String(value || '').trim());
    return /^https?:$/.test(u.protocol) && !FIREBASE_HOST.test(u.hostname) ? u.origin : '';
  } catch (_) {
    return '';
  }
}

function publicSite() {
  return originOf(process.env.PFA_PUBLIC_SITE_URL) || originOf(process.env.PUBLIC_SITE_URL) || DEFAULT_SITE;
}

module.exports = { publicSite, originOf, DEFAULT_SITE, FIREBASE_HOST };
