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
  { key: 'volunteers',  label: 'Volunteers',      group: 'Registers', blurb: 'Volunteer applications and their stage.' },
  { key: 'donations',   label: 'Donations',       group: 'Registers', blurb: 'General and animal-specific giving, with the transaction behind each.' },
  { key: 'caregivers',  label: 'Colony caregiver cards', group: 'Registers', blurb: 'Issued colony caregiver cards.' },
  /* Owner, 26 Oct 2026: members are emailed a link for their photograph,
     PFA approves it, and the membership card is printed. */
  { key: 'membership',  label: 'Membership cards', group: 'Registers', blurb: 'Ask members for their photograph, approve it, and print the membership card.' },
  /* Owner, 26 Oct 2026: the old website's members, on a page of their own
     and in nothing else (lib/routes/admin/old-members.js). */
  { key: 'oldmembers',  label: 'Old site members', group: 'Registers', blurb: 'People who joined on the old website. Kept apart from the current members; read only.' },
  { key: 'payments',    label: 'Payments',        group: 'Registers', blurb: 'Card payments: donations, caregiver postage.' },
  { key: 'cards',       label: 'Print and post',  group: 'Tools',     blurb: 'Colony caregiver cards: print, then post to the holder.' },
  { key: 'verify',      label: 'Verify a card',   group: 'Tools',     blurb: 'Check any card number.' },
  /* Owner, 8 Oct 2026: show or hide any page or section of the public site
     from the panel. A super admin has it, as every module; staff only when
     ticked, since it changes what every visitor sees. */
  { key: 'website',     label: 'Website',         group: 'Site',      blurb: 'Show or hide pages and sections of the public site.' }
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
