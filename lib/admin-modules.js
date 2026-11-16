/* Who may open what.

   Access is a custom claim on the Firebase user, set only by a super admin
   through the People page (or the first one, from the command line):

     { admin: true, role: 'super' }                       everything, and People
     { admin: true, role: 'staff', modules: ['submissions', ...] }

   The `admin: true` claim is what lets someone into the panel at all and is
   the same claim firestore.rules checks. Role and modules decide what they
   see once inside - and, more to the point, what the API will serve them,
   because a hidden link is not a locked door. Every admin route names the
   module it belongs to and the guard refuses anyone whose claims do not
   carry it.

   An account with `admin: true` and no role at all is from before roles
   existed. It keeps the access it has always had - everything - so nobody is
   locked out by an upgrade; the People page shows it as such and lets a
   super admin set it explicitly. */

'use strict';

const MODULES = [
  { key: 'overview',    label: 'Overview',        group: 'Today',     blurb: 'The dashboard: what is waiting, what arrived, what it was worth.' },
  { key: 'submissions', label: 'Submissions',     group: 'Inbox',     blurb: 'Cases from the site forms: reply, note, assign, close.' },
  /* Owner, 16 Nov 2026: "a chat UI for admin side, where people can answer
     questions- when online"; whoever has it answers the site's live chat
     (lib/routes/admin/live-chat.js). */
  { key: 'livechat',    label: 'Live chat',       group: 'Inbox',     blurb: 'Answer visitors on the site\'s chat while you are available: when someone asks for a person, or the site has no answer.' },
  /* Owner, 16 Nov 2026: medical notes sent by pet parents, caregivers,
     vets and doctors; read, corrected, sent back for changes, published
     (lib/routes/admin/med-notes.js). */
  { key: 'mednotes',    label: 'Medical notes',   group: 'Inbox',     blurb: 'Notes for pet parents and caregivers sent from the website: read them, correct them, ask the sender for changes, publish them.' },
  { key: 'wall',        label: 'The Wall',        group: 'Inbox',     blurb: 'Films sent from The Wall page: watch them, put the good ones on the wall, take one off.' },
  { key: 'volunteers',  label: 'Volunteers',      group: 'Registers', blurb: 'Volunteer applications and their stage.' },
  /* Owner, 3 Nov 2026: the panel by people. Those who applied through the
     careers page are job applicants, not employees ("these are not
     employees, they are people who applied"); assets/admin-people.js. */
  { key: 'employees',   label: 'Job applicants',  group: 'Registers', blurb: 'Applications from the careers page, by post.' },
  /* Owner, 10 Nov 2026: "a people's directory section. state, district,
     name, address, phone number. ensure no duplicates"; every register's
     people on one list, so a module of its own (lib/people-directory.js). */
  { key: 'directory',   label: 'People directory', group: 'Registers', blurb: 'Everyone PFA knows through the website, once each: state, district, name, address, phone, and whether member, caregiver, volunteer, intern, donor and more.' },
  { key: 'donations',   label: 'Donations',       group: 'Registers', blurb: 'General and animal-specific giving, with the transaction behind each.' },
  { key: 'caregivers',  label: 'Caregivers',      group: 'Registers', blurb: 'Colony caregivers: applications, their numbers, and their cards.' },
  /* Owner, 26 Oct 2026: members are emailed a link for their photograph,
     PFA approves it, and the membership card is printed. */
  { key: 'membership',  label: 'Members',         group: 'Registers', blurb: 'Every member and their number; ask for the photograph, approve it, print the membership card.' },
  /* Owner, 26 Oct 2026: the old website's members, on a page of their own
     and in nothing else (lib/routes/admin/old-members.js). */
  { key: 'oldmembers',  label: 'Old site members', group: 'Registers', blurb: 'People who joined on the old website. Kept apart from the current members; read only.' },
  { key: 'payments',    label: 'Payments',        group: 'Registers', blurb: 'Card payments: donations, caregiver postage.' },
  /* Owner, 28 Oct 2026: shop orders on their own, marked shipped with the
     courier and tracking number, and the customer emailed
     (lib/routes/admin/shop-orders.js). */
  { key: 'shop',        label: 'Shop orders',     group: 'Registers', blurb: 'Paid shop orders: mark them shipped with the courier and tracking number, and email the customer.' },
  /* Owner, 31 Oct 2026: "this certificate should be admin generatable"
     (lib/routes/admin/certificates.js). */
  /* Owner, 1 Nov 2026: the internship portal: batches and their weekly
     plan, approving interns and their sign-in details, review and scores (lib/routes/admin/internship.js). */
  { key: 'internship', label: 'Internship', group: 'Registers', blurb: 'Batches and their weekly plan, approving applications, sign-in details, reviewing and scoring proof, RRT referral counts.' },
  /* Every kind in one section of its own (owner, 16 Nov 2026: "having all
     kinds of certificates under internship is not sensible"); the key is
     unchanged, so everyone who had it keeps it. */
  { key: 'certificates', label: 'Certificates', group: 'Tools', blurb: 'Issue certificates for an internship, a volunteer, taking part in a camp or event, a recognition or a donor: download or email, and withdraw one if needed.' },
  { key: 'cards',       label: 'Print and post',  group: 'Tools',     blurb: 'Colony caregiver cards: print, then post to the holder.' },
  { key: 'verify',      label: 'Verify a card',   group: 'Tools',     blurb: 'Check any card number.' },
  /* Owner, 8 Oct 2026: show or hide any page or section of the public site
     from the panel. A super admin has it, as every module; staff only when
     ticked, since it changes what every visitor sees. */
  /* Owner, 3 Nov 2026: "admin to get analytics of how many visited which
     page..and whatever other analytics that is actually useful"
     (lib/routes/admin/analytics.js). Numbers only, never a person. */
  { key: 'analytics',   label: 'Analytics',       group: 'Site',      blurb: 'Visits and page views, the pages people open, where they come from, phones or computers, states, and pages with errors.' },
  { key: 'website',     label: 'Website',         group: 'Site',      blurb: 'Show or hide pages and sections of the public site.' },
  /* Owner, 10 Nov 2026: the Seasonal gifts page, its seasons by occasion and
     year, their collections and offers, and its own show or hide switch
     (lib/routes/admin/gifts.js). */
  { key: 'gifts',       label: 'Seasonal gifts',  group: 'Site',      blurb: 'Gift seasons for Deepawali, Christmas, New Year and more: their dates, collections and offers, and showing or hiding the gifts page.' }
];
const MODULE_KEYS = MODULES.map((m) => m.key);
const SUPER_ONLY = ['people'];

/* Starting points for the common jobs; a super admin can adjust after. */
const PRESETS = [
  { key: 'rescue',     label: 'Rescue desk',       modules: ['overview', 'submissions', 'verify'] },
  { key: 'accounts',   label: 'Accounts',          modules: ['overview', 'payments'] },
  { key: 'everything', label: 'Everything',        modules: MODULE_KEYS.slice() }
];

function normaliseModules(list) {
  const wanted = new Set(Array.isArray(list) ? list.map((m) => String(m || '').trim().toLowerCase()) : []);
  return MODULE_KEYS.filter((key) => wanted.has(key));
}

/* What a set of claims grants. */
function accessOf(claims) {
  const c = claims || {};
  if (c.admin !== true) return { role: '', modules: [] };
  if (c.role === 'staff') return { role: 'staff', modules: normaliseModules(c.modules) };
  /* 'super', or an admin claim from before roles existed. */
  return { role: 'super', modules: MODULE_KEYS.slice(), legacy: c.role !== 'super' };
}

function canAccess(who, module) {
  if (!who) return false;
  if (!module) return true;
  if (who.role === 'super') return true;
  if (SUPER_ONLY.includes(module)) return false;
  return Array.isArray(who.modules) && who.modules.includes(module);
}

function labelOf(module) {
  if (module === 'people') return 'People';
  const found = MODULES.find((m) => m.key === module);
  return found ? found.label : module;
}

module.exports = { MODULES, MODULE_KEYS, PRESETS, SUPER_ONLY, accessOf, canAccess, labelOf, normaliseModules };
