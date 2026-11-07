'use strict';

/* Transactional email for the Colony Caregiver Card.

   Sending is deliberately decoupled from the request that caused it: the row is
   written to caregiverEmails inside the originating transaction, and delivery
   is attempted afterwards on a best-effort basis and again by the worker. A
   slow or down mail provider therefore delays an email; it never fails an
   application or loses a payment callback. */

const crypto = require('crypto');
const SHOP = require('./shop');
const CAREGIVER = require('./caregiver');
const CONFIRM = require('./confirmations');
const MT = require('./mail-thread');
const SENT = require('./sent-copy');

const FROM = process.env.PFA_MAIL_FROM || 'People for Animals <cards@peopleforanimalsindia.org>';
const REPLY_TO = process.env.PFA_MAIL_REPLY_TO || '';
const PROVIDER_ENDPOINT = process.env.PFA_MAIL_ENDPOINT || 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* "4 October 2026, 10:47 am", in India's time, for when something arrived.
   A date with no time in it reads as the date alone. */
function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return formatDate(iso);
  const day = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase().replace(/\s+/g, ' ');
  return `${day}, ${time}`;
}

/* The other emails (a card issued, shipping, a staff invite, the forward to
   PFA's inbox) take the same letter, without the greeting line: their own
   opening sentence already says who they are for. The logo comes from
   PUBLIC_SITE_URL, as these are sent outside a page request. */
function shell({ heading, intro, rows, cta, footnote, signoff }) {
  return letter({
    title: heading,
    headline: heading,
    greeting: null,
    lead: intro,
    rows,
    button: cta,
    signoff,
    fine: [footnote],
    siteUrl: process.env.PUBLIC_SITE_URL || ''
  });
}

function textFrom(parts) {
  return parts.filter(Boolean).join('\n');
}

/* ---- the letter ----------------------------------------------------------

   Every confirmation is this letter (owner, 4 Oct 2026): white paper, black
   type, and the logo the only colour, set as a letter from PFA rather than
   a form's receipt. The logo alone at the top; a serif headline in sentence
   case; "Dear Asha," and the message in serif; the number the person will
   quote set large in bold sans over a black rule; the details below it as
   plain ruled lines, label left and value right; one black button; signed
   "With thanks, People for Animals". No cards, rounded corners, grey panels
   or stage timelines.

   Tables and inline styles throughout, because that is what mail clients
   honour, and no web font, because none arrives in a mail client either.
   The logo is two parts (owner, 8 Oct 2026, a screenshot from Gmail in dark
   mode where the black "PEOPLE FOR ANIMALS" under the mark had vanished into
   the dark ground). The mark, img/mail/logo-mark.png, is the coloured bird
   and hands, which read on paper and on a dark ground alike. The lettering
   under it is TEXT, not part of the picture: a mail app in dark mode
   recolours text (Gmail, Outlook and Apple Mail all turn #111 light) but
   never a picture, and Gmail ignores every way of offering a second, dark
   picture. As text it is ink on paper and light in the dark, with no box
   behind it, and it still reads with images blocked. The old single image,
   img/mail/logo-ink.png, stays in the tree for emails already sent.
   A small style block lets a phone set
   the headline and number smaller; a client that drops it still gets a
   letter that reads, because every number can wrap at its hyphens. */
const INK = '#111111';
const BODY = '#2b2b2b';
const SOFT = '#6b6b6b';
const HAIR = '#d6d6d6';
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";
const ADDRESS = '4-T, DCM Building, 16 Barakhamba Road, New Delhi 110001';
const MARK = '/img/mail/logo-mark.png';
/* The wordmark's face: the logo is set in Trajan, which some readers have;
   the rest get Georgia, in capitals and spaced, which keeps its shape. */
const WORDMARK = "'Trajan Pro',Trajan,Cinzel,Marcellus,Georgia,'Times New Roman',serif";

/* "Asha Rao" is Asha; so are "K. Asha" and "Dr. Asha". An initial or a title
   is not a name to open a letter with. */
function firstName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.find((word) => !/\.$/.test(word) && word.length > 1) || words[0] || '';
}

/* The site the letter's links and mark point at: the one the request came
   from, never a guess. */
function siteOf(payload) {
  const raw = String((payload && (payload.siteUrl || payload.followUrl)) || '');
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.origin : '';
  } catch (_) {
    return '';
  }
}

/* "Asha," becomes "Dear Asha,"; a greeting that is not a name stays as it is. */
function salutation(greeting) {
  const g = String(greeting || '').trim();
  if (!g) return 'Hello,';
  return /^(hello|hi|thank you|thanks|welcome|dear)\b/i.test(g) ? g : `Dear ${g}`;
}

/* The lead used to follow the greeting on the same line ("Asha, your
   report..."); on its own line it starts with a capital. */
function sentence(text) {
  const t = String(text || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/* The headline was set one thought to a line; as a sentence it is one line. */
function headlineOf(parts) {
  return (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function paragraph(html, extra) {
  return `<tr><td style="padding:14px 0 0;font-family:${SERIF};font-size:17px;line-height:1.65;color:${BODY}${extra || ''}">${html}</td></tr>`;
}

function letter(o) {
  const site = String(o.siteUrl || '').replace(/\/+$/, '');
  const words = `<span class="pfa-wordmark" style="font-family:${WORDMARK};font-size:15px;line-height:1;letter-spacing:.5px;color:${INK};white-space:nowrap">PEOPLE FOR ANIMALS<span style="font-size:7px;letter-spacing:0;vertical-align:top;padding-left:2px">&trade;</span></span>`;
  const mark = site
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:0"><img src="${escapeHtml(site)}${MARK}" alt="" width="56" style="display:block;width:56px;height:auto;border:0;outline:none;text-decoration:none"></td></tr><tr><td align="center" style="padding:5px 0 0">${words}</td></tr></table>`
    : words;

  /* The number the person will quote: the first row marked big. */
  const all = (o.rows || []).filter((row) => row && row.value);
  const lead = all.find((row) => row.big);
  const rest = all.filter((row) => row !== lead);
  const number = lead
    ? `<tr><td style="padding:36px 0 0;font-family:${SERIF};font-size:15px;font-style:italic;color:${SOFT}">Your ${escapeHtml(CONFIRM.inSentence(lead.label))}</td></tr>
  <tr><td class="pfa-ref" style="padding:4px 0 14px;font-family:${SANS};font-size:38px;line-height:1.1;font-weight:800;letter-spacing:-0.5px;color:${INK};border-bottom:2px solid ${INK}">${escapeHtml(lead.value)}</td></tr>`
    : (rest.length ? `<tr><td style="padding:30px 0 0;border-bottom:2px solid ${INK};font-size:0;line-height:0">&nbsp;</td></tr>` : '');
  const lines = rest.map((row) => `<tr>
      <td valign="top" style="padding:13px 16px 13px 0;border-bottom:1px solid ${HAIR};font-family:${SERIF};font-size:15px;line-height:1.4;color:${SOFT};white-space:nowrap">${escapeHtml(row.label)}</td>
      <td valign="top" align="right" style="padding:13px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:15px;line-height:1.4;font-weight:600;color:${INK}">${/^https?:\/\//i.test(String(row.href || '')) ? `<a href="${escapeHtml(row.href)}" style="color:${INK};text-decoration:underline">${escapeHtml(row.linkText || row.value)}</a>` : escapeHtml(row.value)}</td></tr>`).join('');

  /* What is on its way, what the fee covers: a heading in italic, then the
     items as plain lines. */
  const sections = (o.sections || []).filter((sec) => sec && ((sec.items || []).filter(Boolean).length || sec.note)).map((sec) => {
    const items = (sec.items || []).filter(Boolean);
    return (sec.title ? `<tr><td style="padding:30px 0 4px;font-family:${SERIF};font-size:15px;font-style:italic;color:${SOFT}">${escapeHtml(sec.title)}</td></tr>` : '<tr><td style="padding:16px 0 0"></td></tr>')
      + items.map((item) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${HAIR};font-family:${SERIF};font-size:16px;line-height:1.5;color:${INK}">${escapeHtml(item)}</td></tr>`).join('')
      + (sec.note ? `<tr><td style="padding:${items.length ? 12 : 0}px 0 0;font-family:${SERIF};font-size:15px;line-height:1.6;color:${SOFT}">${escapeHtml(sec.note)}</td></tr>` : '');
  }).join('');

  const button = o.button && o.button.url
    ? `<tr><td style="padding:30px 0 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${INK}" style="background:${INK}"><a href="${escapeHtml(o.button.url)}" style="display:inline-block;padding:15px 24px;font-family:${SANS};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(o.button.label)}&nbsp;&rarr;</a></td></tr></table></td></tr>`
    : '';
  const after = o.afterHtml
    ? `<tr><td style="padding:12px 0 0;font-family:${SERIF};font-size:15px;line-height:1.55;color:${SOFT}">${o.afterHtml}</td></tr>`
    : '';
  const fine = (o.fine || []).filter(Boolean).map(escapeHtml).join(' ');
  const preheader = o.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#ffffff">${escapeHtml(o.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(o.title)}</title>
<style>@media only screen and (max-width:520px){.pfa-h1{font-size:36px !important}.pfa-ref{font-size:28px !important}}</style></head>
<body style="margin:0;padding:0;background:#ffffff">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff"><tr><td align="center" style="padding:36px 20px 48px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td>${mark}</td></tr>
  ${o.kicker ? `<tr><td style="padding:48px 0 0;font-family:${SERIF};font-size:15px;font-style:italic;color:${SOFT}">${escapeHtml(o.kicker)}</td></tr>` : ''}
  ${headlineOf(o.headline) ? `<tr><td class="pfa-h1" style="padding:${o.kicker ? 6 : 56}px 0 0;font-family:${SERIF};font-size:46px;line-height:1.05;letter-spacing:-0.5px;color:${INK}">${escapeHtml(headlineOf(o.headline))}</td></tr>` : ''}
  ${o.greeting === null ? '<tr><td style="padding:14px 0 0"></td></tr>' : `<tr><td style="padding:28px 0 0;font-family:${SERIF};font-size:18px;line-height:1.6;color:${INK}">${escapeHtml(salutation(o.greeting))}</td></tr>`}
  ${o.lead ? paragraph(escapeHtml(sentence(o.lead))) : ''}
  ${(o.bodyHtml || []).map((html) => paragraph(html)).join('')}
  ${o.urgent ? paragraph(escapeHtml(o.urgent), `;font-weight:bold;color:${INK}`) : ''}
  ${number}
  ${lines ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines}</table></td></tr>` : ''}
  ${sections}${button}${after}
  ${o.signoff === false ? '' : `<tr><td style="padding:36px 0 0;font-family:${SERIF};font-size:17px;line-height:1.6;color:${BODY}">${o.signoff ? escapeHtml(o.signoff) : `<div>With thanks,</div><div style="color:${INK}">People for Animals</div>`}</td></tr>`}
  <tr><td style="padding:40px 0 0"><div style="border-top:1px solid ${HAIR};font-size:0;line-height:0">&nbsp;</div></td></tr>
  <tr><td style="padding:14px 0 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${SOFT}">${fine ? `<div>${fine}</div>` : ''}<div>People for Animals &middot; ${ADDRESS}</div></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* The line under a number: what following it asks for. */
const FOLLOW_NOTE = 'To follow it you will be asked for this number and the email or mobile you gave, so that only you can see it.';

/* The threading headers for an email about a submission (lib/mail-thread.js).
   `part` names this email; `answers` names the part it continues, if any,
   so In-Reply-To and References point at it. Nothing is set for a record
   that has no threadId (those written before threads existed), and the
   email still goes. */
function threadHeaders(payload, part, answers) {
  const p = payload || {};
  const reference = p.reference || p.applicationRef || p.memberId;
  if (!reference || !MT.isThreadId(p.threadId)) return { messageId: '', inReplyTo: '', references: '' };
  const domain = MT.domainOf(sender());
  const messageId = MT.messageId({ reference, threadId: p.threadId, part }, domain);
  const earlier = answers ? MT.messageId({ reference, threadId: p.threadId, part: answers }, domain) : '';
  return { messageId, inReplyTo: earlier, references: earlier ? MT.references(p.references || [], earlier) : '' };
}

/* The admin panel, open at the section a report is about (owner, 4 Nov
   2026: "each report should have option to login to admin panel"):
   admin.html#tab=<section>. The panel asks the reader to sign in first,
   then opens that section (or the first one they may see). */
function panelLink(tab) {
  const base = require('./weekly-digest').panelUrl();
  return tab ? `${base}#tab=${encodeURIComponent(tab)}` : base;
}
const PANEL_BUTTON = 'Sign in to the admin panel';
/* each section report's own section of the panel (lib/section-report.js KINDS) */
const SECTION_TABS = { volunteers: 'volunteers', jobs: 'employees', interns: 'internship', shop: 'shop', caregivers: 'caregivers', members: 'membership' };

/* The payments report, monthly or for a period (lib/finance-report.js). */
function paymentsReport(payload, period) {
  const p = payload || {};
  const heads = Array.isArray(p.heads) ? p.heads : [];
  const cell = (v, extra) => `<td style="padding:8px 8px 8px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;line-height:1.45;color:${INK};vertical-align:top${extra || ''}">${escapeHtml(v)}</td>`;
  const th = (v, extra) => `<th align="left" style="padding:8px 8px 8px 0;border-bottom:2px solid ${INK};font-family:${SANS};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${SOFT};font-weight:700${extra || ''}">${escapeHtml(v)}</th>`;
  const summary = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 0">`
    + `<tr>${th('Category')}${th('Payments', ';text-align:right')}${th('Subtotal', ';text-align:right')}</tr>`
    + heads.map((h) => `<tr>${cell(h.label)}${cell(String(h.count), ';text-align:right')}${cell(h.subtotal, ';text-align:right;white-space:nowrap')}</tr>`).join('')
    + `<tr><td style="padding:12px 8px 0 0;font-family:${SANS};font-size:15px;font-weight:800;color:${INK}">Grand total</td><td align="right" style="padding:12px 8px 0 0;font-family:${SANS};font-size:15px;font-weight:800;color:${INK}">${escapeHtml(String(p.count || 0))}</td><td align="right" style="padding:12px 0 0;font-family:${SANS};font-size:15px;font-weight:800;color:${INK};white-space:nowrap">${escapeHtml(p.total || '')}</td></tr>`
    + `</table>`;
  const sections = heads.map((h) => {
    const title = `<div style="margin:30px 0 4px;font-family:${SERIF};font-size:20px;color:${INK}">${escapeHtml(h.label)}</div>`
      + `<div style="font-family:${SANS};font-size:13px;color:${SOFT}">${escapeHtml(String(h.count))} payment${h.count === 1 ? '' : 's'} &middot; subtotal ${escapeHtml(h.subtotal)}</div>`;
    if (!h.count) return title;
    const rows = (h.rows || []).map((r) => `<tr>${cell(r.name)}${cell(`${r.date}, ${r.time}`, ';white-space:nowrap')}${cell(r.purpose)}${cell(r.amount, ';text-align:right;white-space:nowrap')}${cell(r.status)}${cell([r.orderId, r.reference].filter(Boolean).join(' / '), ';font-size:12px')}</tr>`).join('');
    return title + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 0">`
      + `<tr>${th('Payer')}${th('Paid on (IST)')}${th('Purpose')}${th('Amount', ';text-align:right')}${th('Status')}${th('Transaction / reference')}</tr>${rows}</table>`
      + (h.more > 0 ? `<div style="margin:8px 0 0;font-family:${SANS};font-size:12px;color:${SOFT}">and ${escapeHtml(String(h.more))} more in the attached CSV</div>` : '');
  }).join('');
  /* a month that brings in the old site's payments says how each was counted once */
  const rec = p.reconciliation;
  const recHtml = rec && rec.summary ? (() => {
    const s = rec.summary;
    const line = (label, value) => `<tr><td style="padding:7px 8px 7px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;color:${INK}">${escapeHtml(label)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;font-weight:700;color:${INK}">${escapeHtml(String(value))}</td></tr>`;
    const listOf = (title, items) => (items && items.length ? `<div style="margin:14px 0 4px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${SOFT}">${escapeHtml(title)}</div>` + items.map((t) => `<div style="padding:4px 0;font-family:${SANS};font-size:13px;line-height:1.45;color:${INK}">${escapeHtml(t)}</div>`).join('') : '');
    return `<div style="margin:30px 0 4px;font-family:${SERIF};font-size:20px;color:${INK}">How this month was reconciled</div>`
      + (rec.note ? `<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:${SOFT}">${escapeHtml(rec.note)} Each payment is counted once, matched by its gateway identifiers (CCAvenue order id, tracking number, bank reference), never by name or amount.</div>` : '')
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 0">`
      + line('Old site records', s.oldSite) + line('New site records', s.newSite) + line('On both sites, counted once', s.matched)
      + line('Counted in this report', s.counted) + line('Confirmed with CCAvenue', s.confirmed) + line('Amount corrected to CCAvenue\u2019s', s.corrected)
      + line('Not confirmed with CCAvenue (counted as recorded)', s.unconfirmed) + line('Left out: not successful at CCAvenue', s.excluded)
      + `</table>`
      + listOf('Counted once', rec.matched) + listOf('Left out', rec.excluded) + listOf('Amount corrected', rec.corrected)
      + listOf('Not confirmed with CCAvenue', rec.unconfirmed) + listOf('Alike, but different payments (both counted)', rec.lookalikes);
  })() : '';
  const html = letter({
    title: `PFA payments report: ${p.label || ''}`,
    preheader: `${p.label}: ${p.count || 0} successful payments, ${p.total || ''}.`,
    siteUrl: siteOf(p),
    kicker: period ? 'Payments report' : 'Monthly payments report',
    headline: p.label || '',
    greeting: null,
    lead: `${period ? `Every successful payment PFA's website took${p.purpose ? ` for ${p.purpose}` : ''}, ${p.label}, India time: ` : `Every successful payment PFA's website took in ${p.label}, India time: `}${p.count || 0} payment${Number(p.count) === 1 ? '' : 's'}, ${p.total || ''} in all. They are grouped below by what they were for, each with its subtotal. The full list, with bank and CCAvenue references, is in the attached CSV (${p.csvName || 'CSV'}).`,
    bodyHtml: [summary, recHtml, sections].filter(Boolean),
    button: { label: PANEL_BUTTON, url: panelLink('payments') },
    signoff: period ? 'Sent from the PFA website\u2019s admin panel.' : 'Sent automatically by the PFA website on the 1st of the month.',
    fine: [
      'Only payments that CCAvenue confirmed as successful are counted. Rupee and dollar payments are totalled separately.',
      'Amounts are as paid; refunds, if any, are not shown here.'
    ]
  });
  const text = textFrom([
    `PFA payments report: ${p.label}`,
    `${p.count || 0} successful payments, ${p.total || ''}.`,
    ...heads.map((h) => `${h.label}: ${h.count} payment${h.count === 1 ? '' : 's'}, ${h.subtotal}`),
    `Grand total: ${p.total || ''}`,
    `The full list is in the attached CSV (${p.csvName || 'CSV'}).`,
    `Admin panel: ${panelLink('payments')}`
  ]);
  return { subject: `PFA payments report: ${period && p.purpose ? `${p.purpose}, ` : ''}${p.label} (${p.count || 0} payments, ${p.total || ''})`, html, text };
}

const TEMPLATES = {
  /* The back office approved the application and gave the card its
     number (owner, 24 Oct 2026: "card wont be issued to the applicant
     without it being approved by the team at the back office. and only
     physical card will go to the applicant"). So this is a notice, not a
     card: no card number, no link to one, nothing to download or show. The
     printed card is the only copy and it comes by post; the number is on it. */
  card_issued(payload) {
    const p = payload || {};
    const hello = firstName(p.name) ? `${firstName(p.name)}, y` : 'Y';
    const postTo = (Array.isArray(p.postTo) ? p.postTo : [p.postTo]).filter(Boolean).join(', ');
    const ref = p.applicationRef || p.reference || '';
    return {
      subject: `Your Colony Caregiver Card is approved${ref ? ` - ${ref}` : ''}`,
      html: shell({
        heading: 'Your card is approved.',
        intro: `${hello}our application has been approved by People for Animals. Your Colony Caregiver Card is now being printed, and the printed card will be posted to you. It is the only copy: the card is not sent by email or shown online.`,
        rows: [
          { label: 'Application number', value: ref },
          { label: 'Approved on', value: formatDate(p.issuedAt) },
          { label: 'Valid until', value: formatDate(p.validUntil) },
          { label: 'Posting to', value: postTo }
        ],
        cta: p.followUrl ? { label: 'Follow your application', url: p.followUrl } : null,
        footnote: 'You will be emailed again when the card is in the post. If the address above is wrong, write to us now through Ask PFA, quoting the application number.'
      }),
      text: textFrom([
        `${hello}our application has been approved by People for Animals. Your Colony Caregiver Card is now being printed, and the printed card will be posted to you. It is the only copy: the card is not sent by email or shown online.`,
        ref ? `Application number: ${ref}` : '',
        `Approved on: ${formatDate(p.issuedAt)}`,
        p.validUntil ? `Valid until: ${formatDate(p.validUntil)}` : '',
        postTo ? `Posting to: ${postTo}` : '',
        p.followUrl ? `Follow your application: ${p.followUrl}` : '',
        'You will be emailed again when the card is in the post. If the address above is wrong, write to us now through Ask PFA, quoting the application number.'
      ])
    };
  },

  /* The printed card has gone into the post (Mark as posted, in the panel).
     Like the approval, it carries no card number: that is on the card. */
  card_posted(payload) {
    const p = payload || {};
    const hello = firstName(p.name) ? `${firstName(p.name)}, y` : 'Y';
    const postTo = (Array.isArray(p.postTo) ? p.postTo : [p.postTo]).filter(Boolean).join(', ');
    const ref = p.applicationRef || p.reference || '';
    return {
      subject: `Your Colony Caregiver Card is in the post${ref ? ` - ${ref}` : ''}`,
      html: shell({
        heading: 'Your card is in the post.',
        intro: `${hello}our printed Colony Caregiver Card was posted to you on ${formatDate(p.postedAt)}. Carry it when you feed, and show it when you are asked.`,
        rows: [
          { label: 'Posted on', value: formatDate(p.postedAt) },
          { label: 'Posted to', value: postTo },
          { label: 'Application number', value: ref }
        ],
        footnote: 'Post within India usually takes a few working days. If the card has not arrived in two weeks, write to us through Ask PFA, quoting the application number.'
      }),
      text: textFrom([
        `${hello}our printed Colony Caregiver Card was posted to you on ${formatDate(p.postedAt)}. Carry it when you feed, and show it when you are asked.`,
        postTo ? `Posted to: ${postTo}` : '',
        ref ? `Application number: ${ref}` : '',
        'Post within India usually takes a few working days. If the card has not arrived in two weeks, write to us through Ask PFA, quoting the application number.'
      ])
    };
  },

  /* A reply written by a member of staff. Their text is the body; it is
     escaped and its line breaks kept, so nothing they type can become
     markup and nothing they meant as a paragraph is lost.

     It answers the confirmation the person was sent: same subject with
     "Re:", In-Reply-To and References naming that confirmation's
     Message-ID, so Gmail and Outlook show it in the same conversation. Its
     own Message-ID names the submission and the thread, so the person's
     answer to it is filed on the same record. */
  submission_reply(payload) {
    const paragraphs = String(payload.text || '').split(/\n{2,}/).map((para) => escapeHtml(para).replace(/\n/g, '<br>'));
    const what = String(payload.kindLabel || 'submission').toLowerCase();
    const thread = threadHeaders(payload, `reply.${Number(payload.n) || 1}`, 'confirm');
    return {
      subject: payload.threadSubject ? `Re: ${payload.threadSubject}` : `Re: ${payload.reference} - a reply from People for Animals`,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html: letter({
        title: `A reply about ${payload.reference}`,
        preheader: `A reply from People for Animals about ${payload.reference}.`,
        siteUrl: siteOf(payload),
        kicker: `About your ${what} ${payload.reference}`,
        headline: '',
        greeting: firstName(payload.name) ? `${firstName(payload.name)},` : 'Hello,',
        bodyHtml: paragraphs,
        button: payload.followUrl ? { label: 'See where it stands', url: payload.followUrl } : null,
        signoff: payload.signoff || '',
        fine: [`${payload.replyHint || 'You can reply to this email and it will reach PFA.'} Please keep the reference number in the subject.`]
      }),
      text: textFrom([
        firstName(payload.name) ? `${firstName(payload.name)},` : 'Hello,',
        '',
        String(payload.text || ''),
        '',
        payload.signoff || 'People for Animals',
        '',
        `About your ${what} ${payload.reference}.`,
        payload.followUrl ? `See where it stands: ${payload.followUrl}` : ''
      ])
    };
  },

  staff_invite(payload) {
    const what = Array.isArray(payload.modules) && payload.modules.length ? payload.modules.join(', ') : '';
    const again = payload.reason === 'reset';
    return {
      subject: again ? 'Set a new password for the PFA admin panel' : 'You have been given access to the PFA admin panel',
      html: shell({
        heading: again ? 'Set a new password.' : 'You are in.',
        intro: `${firstName(payload.name) ? firstName(payload.name) + ', y' : 'Y'}ou ${again ? 'asked for a new password for' : 'have been given access to'} the People for Animals admin panel`
          + (again ? '.' : ` as ${payload.role === 'super' ? 'a super admin' : 'staff'}${what ? `, with: ${what}` : ''}.`)
          + ' Use the button to set your password; it works once and only for a little while.',
        rows: [{ label: 'Sign in at', value: payload.adminUrl }],
        cta: { label: 'Set my password', url: payload.link },
        footnote: 'If you did not expect this, ignore it and nothing happens. Nobody at PFA will ever ask you for your password.'
      }),
      text: textFrom([
        `${firstName(payload.name) ? firstName(payload.name) + ', y' : 'Y'}ou ${again ? 'asked for a new password for' : 'have been given access to'} the People for Animals admin panel${again || !what ? '' : ', with: ' + what}.`,
        `Set your password: ${payload.link}`,
        `Then sign in at ${payload.adminUrl}`
      ])
    };
  },

  /* A shop order, paid. The shopper's record of what they bought, what they
     paid and where it is going, with the order number to quote. A purchase
     is not a gift, so nothing here mentions 80G. */
  shop_order_confirmed(payload) {
    const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
    const delivery = Number(payload.shipping) > 0 ? rupees(payload.shipping) : 'Free';
    const first = firstName(payload.name);
    const site = siteOf(payload);
    const items = (Array.isArray(payload.items) ? payload.items : []).map((i) => `${SHOP.describe(i)}, ${rupees(i.lineTotal)}`);
    const d = payload.delivery || {};
    const address = [...new Set([d.name, d.address, d.city, d.district, `${d.state || ''} ${d.zip || ''}`.trim(), d.tel ? `Mobile ${d.tel}` : ''].filter(Boolean))];
    const html = letter({
      title: 'Your PFA order is placed',
      preheader: `Order ${payload.orderId} is paid and placed. ${rupees(payload.total)}.`,
      siteUrl: site,
      headline: ['Your', 'order', 'is placed.'],
      greeting: first ? `${first},` : 'Thank you,',
      lead: 'your order is paid and placed with People for Animals. PFA packs it and sends it to the address below, and will be in touch on this email or your mobile if anything needs checking. Every purchase supports PFA’s work for animals.',
      rows: [
        { label: 'Order number', value: payload.orderId, big: true },
        { label: 'Paid', value: `${rupees(payload.total)} on ${formatDate(payload.paidAt)}${payload.bankReference ? ` · bank reference ${payload.bankReference}` : ''}` },
        { label: 'Items', value: rupees(payload.subtotal) },
        { label: 'Delivery', value: delivery }
      ],
      sections: [
        { title: 'Your order', items },
        { title: 'Delivering to', items: address }
      ],
      button: site ? { label: 'Back to the shop', url: `${site}/shop.html` } : null,
      fine: [
        'This is a purchase, so no 80G receipt is issued for it.',
        'Quote the order number in any message about this order, or call PFA on +91 99533 13319.',
        'PFA never sees your card, bank or UPI details; the payment was taken by CCAvenue.'
      ]
    });
    return {
      subject: `Your PFA order ${payload.orderId} is placed`,
      messageId: threadHeaders(payload, 'confirm').messageId,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our order is paid and placed with People for Animals.`,
        `Order number: ${payload.orderId}`,
        `Paid: ${rupees(payload.total)} on ${formatDate(payload.paidAt)} (items ${rupees(payload.subtotal)}, delivery ${delivery.toLowerCase()})`,
        ...(payload.bankReference ? [`Bank reference: ${payload.bankReference}`] : []),
        'Your order:',
        ...items.map((i) => `  ${i}`),
        'Delivering to:',
        ...address.map((a) => `  ${a}`),
        'PFA packs it and sends it to this address. Quote the order number in any message, or call +91 99533 13319.',
        'This is a purchase, so no 80G receipt is issued for it.'
      ])
    };
  },

  /* The order is on its way (owner, 28 Oct 2026: "enter details of courier
     ... trigger email in the pfa template to the person who ordered - the
     standard tracking id and details. and a ecom style amazing message").
     Sent from Shop orders in the panel (lib/routes/admin/shop-orders.js)
     once the courier and tracking number are saved. A small tracker shows
     where the parcel is; the tracking number is the big line, with the
     courier's link when one was given. It continues the order's own
     conversation, so a reply reaches PFA and is kept on the order. */
  shop_order_shipped(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    const courier = String(p.courier || 'the courier');
    const items = (Array.isArray(p.items) ? p.items : []).map((i) => (typeof i === 'string' ? i : SHOP.describe(i))).filter(Boolean);
    const d = p.delivery || {};
    const address = [...new Set([d.name, d.address, d.city, d.district, `${d.state || ''} ${d.zip || ''}`.trim(), d.tel ? `Mobile ${d.tel}` : ''].filter(Boolean))];
    const link = /^https?:\/\//i.test(String(p.trackingUrl || '')) ? String(p.trackingUrl) : '';
    const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
    const step = (label, when, done, last) => `<td width="33%" valign="top" style="padding:0${last ? '' : ' 6px 0 0'}"><div style="height:6px;line-height:6px;font-size:0;background:${done ? INK : HAIR}">&nbsp;</div>`
      + `<div style="padding:10px 0 0;font-family:${SANS};font-size:14px;font-weight:700;color:${done ? INK : SOFT}">${escapeHtml(label)}</div>`
      + `<div style="padding:2px 0 0;font-family:${SANS};font-size:12px;color:${SOFT}">${escapeHtml(when)}</div></td>`;
    const tracker = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 4px"><tr>`
      + step('Ordered', day(p.paidAt) || 'Done', true) + step('Shipped', day(p.shippedAt) || 'Today', true) + step('Delivered', 'On its way', false, true)
      + '</tr></table>';
    const thread = threadHeaders(Object.assign({}, p, { reference: p.reference || p.orderId }), 'shipped', 'confirm');
    const html = letter({
      title: 'Your PFA order is on its way',
      preheader: `Order ${p.orderId} is with ${courier}. Tracking number ${p.trackingNumber || ''}.`,
      siteUrl: site,
      kicker: `Order ${p.orderId || ''}`,
      headline: ['It’s', 'on', 'its', 'way.'],
      greeting: first ? `${first},` : 'Good news,',
      lead: `your order has left People for Animals and is with ${courier}. Follow it all the way to your door with the tracking number below.`,
      bodyHtml: [tracker],
      rows: [
        { label: 'Tracking number', value: p.trackingNumber || '', big: true },
        { label: 'Courier', value: courier },
        { label: 'Shipped on', value: formatDate(p.shippedAt) },
        { label: 'Order number', value: p.orderId || '' },
        link ? { label: 'Track it', value: link, href: link, linkText: `Follow it on ${courier}` } : null
      ].filter(Boolean),
      sections: [
        { title: 'In the parcel', items },
        { title: 'Coming to', items: address }
      ],
      button: link ? { label: 'Track your parcel', url: link } : (site ? { label: 'Visit the PFA shop', url: `${site}/shop.html` } : null),
      afterHtml: link ? '' : `Track it on ${escapeHtml(courier)}’s website or app with the tracking number above.`,
      fine: [
        'Thank you: every purchase supports PFA’s work for animals.',
        `Something not right when it arrives? Reply to this email or call PFA on +91 99533 13319, quoting order ${p.orderId || 'number'}.`
      ]
    });
    return {
      subject: `${first ? `${first}, your` : 'Your'} PFA order is on its way - ${courier} ${p.trackingNumber || ''}`.trim(),
      gateway: true,
      capture: true,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our order has left People for Animals and is on its way.`,
        '',
        `Tracking number: ${p.trackingNumber || ''}`,
        `Courier: ${courier}`,
        `Shipped on: ${formatDate(p.shippedAt)}`,
        `Order number: ${p.orderId || ''}`,
        link ? `Track it: ${link}` : `Track it on ${courier}'s website or app with the tracking number above.`,
        '',
        'In the parcel:',
        ...items.map((i) => `  ${i}`),
        'Coming to:',
        ...address.map((a) => `  ${a}`),
        '',
        'Thank you: every purchase supports PFA\u2019s work for animals.',
        `Something not right when it arrives? Reply to this email or call +91 99533 13319, quoting order ${p.orderId || 'number'}.`
      ])
    };
  },

  /* The same order, for the people at PFA who pack it. Sent only when
     PFA_SHOP_ORDERS_EMAIL names an inbox; the order is in the pfa-oldsite
     panel either way. */
  shop_order_staff(payload) {
    const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
    const d = payload.delivery || {};
    const items = (Array.isArray(payload.items) ? payload.items : []).map((i) => SHOP.describe(i));
    const address = [...new Set([d.name, d.address, d.city, d.district, `${d.state || ''} ${d.zip || ''}`.trim()].filter(Boolean))].join(', ');
    return {
      subject: `New shop order ${payload.orderId}: ${rupees(payload.total)}`,
      html: shell({
        heading: 'A shop order is paid.',
        intro: `${payload.name || 'A shopper'} has paid for ${items.join('; ')}. It is ready to pack, and on record in the admin panel under Payments.`,
        rows: [
          { label: 'Order number', value: payload.orderId },
          { label: 'Paid', value: rupees(payload.total) },
          { label: 'Deliver to', value: address },
          { label: 'Mobile', value: d.tel },
          { label: 'Email', value: payload.email },
          { label: 'CCAvenue tracking ID', value: payload.trackingId }
        ],
        footnote: 'Sent by the PFA shop. Reply to the shopper from the address above, not to this email.',
        signoff: false
      }),
      text: textFrom([
        `Shop order ${payload.orderId} paid: ${rupees(payload.total)}`,
        ...items,
        `Deliver to: ${address}`,
        `Mobile: ${d.tel || ''}`,
        `Email: ${payload.email || ''}`,
        `CCAvenue tracking ID: ${payload.trackingId || ''}`
      ])
    };
  },

  /* A submission, forwarded to PFA's inbox (lib/submission-forward.js).
     Plain and complete: who sent it, how to reach them, and every field they
     filled in, so it can be read and answered from the inbox alone. Reply-To
     is the submitter's own address, so pressing Reply writes to them. */
  submission_forward(payload) {
    const p = payload || {};
    const who = p.name || 'Someone';
    const when = p.receivedAt ? new Date(p.receivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    /* The address as one line, with a map (24 Oct 2026, owner: "ensure all
       the forms have the address clearly captured and sent to gandhim").
       Where the thing is happening comes straight after what it is; a
       person's own address after how to reach them. */
    const place = p.place && p.place.value
      ? [{ label: p.place.label || 'Address', value: p.place.value },
        p.place.map ? { label: 'Map', value: p.place.map, href: p.place.map, linkText: 'Open in Google Maps' } : null].filter(Boolean)
      : [];
    const first = p.place && p.place.first ? place : [];
    const after = p.place && p.place.first ? [] : place;
    const rows = [
      { label: 'Reference', value: p.reference },
      { label: 'Type', value: p.kindLabel }
    ].concat(first, [
      { label: 'Received', value: when },
      { label: 'Name', value: p.name },
      { label: 'Email', value: p.email },
      { label: 'Mobile', value: p.mobile }
    ], after).concat(Array.isArray(p.rows) ? p.rows : []);
    /* A second copy, carrying a photograph the first could not (8 Oct 2026):
       its own Message-ID, answering the first, so it threads under it. */
    const photoFollowUp = p.followUp === 'photo';
    if (photoFollowUp) rows.unshift({ label: 'Why a second copy', value: 'The photograph could not be attached to the first copy of this submission. It is attached here.' });
    if (p.attachments) {
      const n = Number(p.attachedToEmail) || 0;
      const files = Number(p.attachments) === 1 ? 'file' : 'files';
      rows.push({
        label: 'Photographs and documents',
        value: n >= Number(p.attachments)
          ? `${p.attachments} ${files}, attached to this email and kept in the admin panel`
          : n > 0
            ? `${p.attachments} ${files}: ${n} attached to this email, all of them in the admin panel`
            : `${p.attachments} ${files}, in the admin panel`
      });
    }
    const how = p.email
      ? (p.gatewayAt
        ? `Reply to this email. PFA sends your reply to ${who} at ${p.email}, from ${p.replyFrom || 'PFA'}, and keeps it with this submission in the admin panel. Reply is enough; you do not need Reply All, and there is no address to remember.`
        : `Reply to this email to answer ${who} directly at ${p.email}. Your reply goes from your mailbox to theirs; the website keeps no copy of it.`)
      : `${who} gave no email address, so a reply to this email will not reach them.${p.mobile ? ` Call or message them on ${p.mobile}.` : ''}`;
    const thread = photoFollowUp ? threadHeaders(p, 'forward.photo', 'forward') : threadHeaders(p, 'forward');
    return {
      subject: `${photoFollowUp ? 'Re: ' : ''}${p.reference}: ${p.kindLabel} from ${who}`,
      replyTo: p.email || '',
      gateway: true,
      capture: true,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html: shell({
        heading: photoFollowUp ? `The photograph for ${p.reference}.` : `${p.kindLabel}, from ${who}.`,
        intro: how,
        rows,
        cta: p.attachments && p.adminUrl ? { label: 'See the photographs', url: p.adminUrl } : null,
        footnote: `Sent by the People for Animals website${p.page ? ` from ${p.page}` : ''}. The submission is also on record in the admin panel under ${p.reference}.`,
        signoff: false
      }),
      text: textFrom([
        `${p.reference}: ${p.kindLabel} from ${who}`,
        how,
        '',
        ...rows.filter((r) => r && r.value).map((r) => `${r.label}: ${r.value}`)
      ])
    };
  },

  /* A message the person wrote to PFA about their submission, relayed to
     PFA's inbox (lib/inbound-mail.js). It continues the copy of the
     submission already in that inbox: In-Reply-To and References name the
     forward, so it lands in the same conversation there, and Reply-To is
     the person again, so a Reply from the inbox answers them directly. */
  submission_followup(payload) {
    const p = payload || {};
    const who = p.name || p.email || 'The sender';
    const when = p.receivedAt ? new Date(p.receivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const paragraphs = String(p.text || '').trim().split(/\n{2,}/).map((para) => escapeHtml(para).replace(/\n/g, '<br>'));
    const thread = threadHeaders(p, `relay.${Number(p.n) || 1}`, 'forward');
    const rows = [
      { label: 'Reference', value: p.reference },
      { label: 'Type', value: p.kindLabel },
      { label: 'From', value: p.email },
      { label: 'Received', value: when },
      { label: 'Their subject', value: p.subject || '' }
    ];
    /* Says only what is true of this email (8 Oct 2026): the files actually
       attached, the ones kept only in the panel, and any the site could not
       keep at all (too large, or refused). */
    const files = (k) => `${k} ${k === 1 ? 'file' : 'files'}`;
    const count = Number(p.attachments) || 0;
    if (count) {
      const n = Math.min(Number(p.attachedToEmail) || 0, count);
      rows.push({
        label: 'Attachments',
        value: n >= count
          ? `${files(count)}, attached to this email and kept in the admin panel`
          : n > 0
            ? `${files(count)}: ${n} attached to this email, all of them in the admin panel`
            : `${files(count)}, in the admin panel`
      });
    }
    const lost = Number(p.notKept) || 0;
    if (lost > 0) rows.push({ label: 'Could not be kept', value: `${files(lost)} (too large, or refused); ask them to send ${lost === 1 ? 'it' : 'them'} again` });
    return {
      subject: `Re: ${p.reference}: ${p.kindLabel} from ${p.name || who}`,
      replyTo: p.email || '',
      gateway: true,
      capture: true,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html: letter({
        title: `${who} wrote about ${p.reference}`,
        siteUrl: p.siteUrl || '',
        kicker: `About ${p.reference}`,
        headline: `${who} wrote back.`,
        greeting: null,
        lead: `${who} sent this to People for Animals about their ${String(p.kindLabel || 'submission').toLowerCase()}. Reply to this email to answer them${p.email ? ` at ${p.email}` : ''}.`,
        bodyHtml: paragraphs,
        rows,
        button: p.adminUrl ? { label: 'Open the conversation', url: p.adminUrl } : null,
        signoff: 'Sent by the People for Animals website',
        fine: ['The whole exchange is kept with the submission in the admin panel.']
      }),
      text: textFrom([
        `${who} wrote about ${p.reference} (${p.kindLabel}):`,
        '',
        String(p.text || ''),
        '',
        `Reply to this email to answer them${p.email ? ` at ${p.email}` : ''}.`,
        ...rows.filter((r) => r.value).map((r) => `${r.label}: ${r.value}`)
      ])
    };
  },

  /* PFA's own answer, carried to the person who wrote in.

     The other half of the gateway (lib/caregiver-mail.js gatewayAddress). PFA
     replies to the forwarded submission in their own mailbox, as they always
     have; that reply is addressed to this site, so it arrives here, is filed
     against the submission, and goes out to the person from info@ as this.

     What PFA wrote is sent as written and nothing is added to it: a note
     explaining the machinery would be a note the person did not need and PFA
     did not write. Reply-To is the gateway again, so their answer comes back
     and the conversation cannot leave. */
  submission_answer(payload) {
    const p = payload || {};
    const paragraphs = String(p.text || '').trim().split(/\n{2,}/).map((para) => escapeHtml(para).replace(/\n/g, '<br>'));
    const thread = threadHeaders(p, `answer.${Number(p.n) || 1}`, 'confirm');
    const rows = [{ label: 'Reference', value: p.reference }];
    if (p.kindLabel) rows.push({ label: 'About', value: p.kindLabel });
    return {
      subject: p.subject || `Re: ${p.reference}: your ${String(p.kindLabel || 'submission').toLowerCase()}`,
      gateway: true,
      capture: true,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html: letter({
        title: `People for Animals wrote about ${p.reference}`,
        siteUrl: p.siteUrl || '',
        kicker: `About ${p.reference}`,
        headline: 'People for Animals wrote back.',
        greeting: firstName(p.name) ? `Dear ${firstName(p.name)},` : null,
        lead: null,
        bodyHtml: paragraphs,
        rows,
        signoff: 'People for Animals',
        fine: ['Reply to this email to continue the conversation. Please quote ' + String(p.reference || 'your reference') + ' if you write to us separately.']
      }),
      text: textFrom([
        firstName(p.name) ? `Dear ${firstName(p.name)},` : '',
        '',
        String(p.text || ''),
        '',
        'People for Animals',
        '',
        `Reference: ${p.reference}`,
        'Reply to this email to continue the conversation.'
      ])
    };
  },

  /* To someone on the old website's members list, written by a member of
     staff in the panel (owner, 28 Oct 2026: "there should be a section to add
     notes if someone from admin side reaches out to the person and email
     should go out..optional"). What staff wrote, as written, from info@.
     Reply-To is the site's mailbox, as for the forms: their answer is filed
     under them in Old site members and sent on to whoever wrote
     (lib/routes/admin/old-members.js fileReply). */
  old_member_message(payload) {
    const p = payload || {};
    const paragraphs = String(p.text || '').trim().split(/\n{2,}/).map((para) => escapeHtml(para).replace(/\n/g, '<br>'));
    const n = Number(p.n) || 1;
    const thread = threadHeaders(p, `msg.${n}`, n > 1 ? `msg.${n - 1}` : '');
    const subject = String(p.subject || '').trim() || 'A message from People for Animals';
    const hello = firstName(p.name) ? `Dear ${firstName(p.name)},` : 'Hello,';
    return {
      subject,
      gateway: true,
      capture: true,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html: letter({
        title: subject,
        preheader: String(p.text || '').trim().slice(0, 120),
        siteUrl: p.siteUrl || '',
        kicker: 'People for Animals',
        headline: '',
        greeting: hello,
        lead: null,
        bodyHtml: paragraphs,
        signoff: p.signoff || 'People for Animals',
        fine: ['You can reply to this email and it will reach People for Animals.']
      }),
      text: textFrom([hello, '', String(p.text || ''), '', p.signoff || 'People for Animals', '', 'You can reply to this email and it will reach People for Animals.'])
    };
  },

  /* Their answer, carried to the member of staff who wrote to them. Reply
     here and it goes on to them, from info@, and is kept under them. */
  old_member_relay(payload) {
    const p = payload || {};
    const who = p.name || p.from || 'They';
    const paragraphs = String(p.text || '').trim().split(/\n{2,}/).map((para) => escapeHtml(para).replace(/\n/g, '<br>'));
    const thread = threadHeaders(p, `relay.${Number(p.n) || 1}`, p.answers || '');
    return {
      subject: `Re: ${String(p.subject || 'A message from People for Animals').replace(/^re:\s*/i, '')} (from ${who}, old site member)`,
      gateway: true,
      capture: true,
      messageId: thread.messageId,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
      html: letter({
        title: `${who} wrote back`,
        preheader: String(p.text || '').trim().slice(0, 120),
        siteUrl: p.siteUrl || '',
        kicker: 'Old site members',
        headline: `${who} wrote back.`,
        greeting: null,
        lead: 'Their answer to your email, as they wrote it. Reply to this email and your reply goes to them from info@, and is kept under them in Old site members.',
        bodyHtml: paragraphs,
        rows: [
          { label: 'From', value: p.from || '' },
          { label: 'Received', value: formatDateTime(p.receivedAt) }
        ],
        button: p.panelUrl ? { label: 'Open Old site members', url: p.panelUrl } : null,
        signoff: false
      }),
      text: textFrom([
        `${who} wrote back (${p.from || ''}):`, '', String(p.text || ''), '',
        'Reply to this email and your reply goes to them from info@, and is kept under them in Old site members.',
        p.panelUrl ? `Panel: ${p.panelUrl}` : ''
      ])
    };
  },

  /* A test, sent from the admin panel (lib/routes/admin/mail-check.js), so
     the inbox's owner can see that copies of submissions reach it. */
  inbox_test(payload) {
    const p = payload || {};
    const when = p.at ? new Date(p.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const rows = [
      { label: 'Sent', value: when },
      { label: 'Sent as', value: p.from || '' },
      { label: 'Asked for by', value: p.by || '' }
    ];
    /* What this inbox receives (lib/submission-forward.js): the forms, or
       the records of money, or both. */
    const covers = p.covers === 'payments'
      ? 'every record of money (donations, gifts, shop orders, and the fee paid with a membership or a caregiver application)'
      : p.covers === 'both'
        ? 'every form, and every record of money,'
        : 'every form, every application included (caregiver, membership, volunteer and job) without any payment in it,';
    const intro = `This is a test from the People for Animals website. The site sends a copy of ${covers} to this address, with Reply set to the person who sent it. If this arrived, those copies arrive too.`;
    return {
      subject: 'Test from the PFA website: copies of submissions reach this inbox',
      html: shell({
        heading: 'Submissions reach this inbox.',
        intro,
        rows,
        footnote: 'Nothing needs doing. If this landed in Spam or Junk, mark it Not spam so the copies of submissions land in the inbox.',
        signoff: false
      }),
      text: textFrom([
        'Test from the PFA website: copies of submissions reach this inbox',
        intro,
        '',
        ...rows.filter((r) => r.value).map((r) => `${r.label}: ${r.value}`),
        '',
        'Nothing needs doing. If this landed in Spam or Junk, mark it Not spam so the copies of submissions land in the inbox.'
      ])
    };
  },

  /* The welcome letter, which the other confirmations are now drawn from.
     A member has joined something, and the letter says so before it says
     anything a receipt would. The plain-text twin carries the same facts in
     the same order. */
  /* ---- the membership card (owner, 26 Oct 2026) -------------------------

     A member is asked for a photograph by a private link, sends it, PFA
     approves it, and the card is printed and posted. Four letters: the ask
     (again, with what to change, when a photograph will not do), the
     receipt, the approval, and the office's notice that one is waiting.
     None of them carries money, a card number to show, or a card image:
     the printed card is the only copy. Every one names a way to reach PFA. */
  member_photo_request(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    /* the state member number shown */
    const ref = p.memberNo || p.memberId || p.reference || '';
    const retake = Array.isArray(p.reasons) ? p.reasons.filter(Boolean) : [];
    const expires = formatDate(p.expiresAt);
    const steps = [
      'Stand in front of a plain, light wall in daylight.',
      'Face the camera straight on, shoulders up, nothing covering your face.',
      'Open the link below on your phone, take or choose the photograph, and send it.'
    ];
    const lead = retake.length
      ? 'thank you for your photograph. It cannot be printed on your membership card as it is, so we need one more.'
      : 'your PFA membership card is ready to be made. It carries your photograph, so we need one from you.';
    const html = letter({
      title: 'A photograph for your PFA membership card',
      preheader: `Send your photograph for your PFA membership card. The link works until ${expires}.`,
      siteUrl: site,
      kicker: 'Membership card',
      headline: retake.length ? 'One more photograph, please.' : 'Your photograph, please.',
      greeting: first ? `${first},` : 'Hello,',
      lead,
      rows: [
        { label: 'Member number', value: ref, big: true },
        { label: 'Link works until', value: expires }
      ],
      sections: [
        retake.length ? { title: 'What to change', items: retake } : null,
        { title: 'How to take it', items: steps }
      ],
      button: p.uploadUrl ? { label: 'Send your photograph', url: p.uploadUrl } : null,
      afterHtml: `This link is only for you and works once. If it has expired, or you have any question, ${site ? `<a href="${escapeHtml(site)}/ask.html" style="color:#111111;text-decoration:underline">write to PFA</a>` : 'reply to this email'} quoting your member number.`,
      fine: ['Your photograph is used only to print your membership card and is kept with your membership record.']
    });
    return {
      subject: `${retake.length ? 'One more photograph' : 'Your photograph'} for your PFA membership card - ${ref}`,
      html,
      text: textFrom([
        `${first ? first + ', ' : ''}${lead}`,
        `Member number: ${ref}`,
        ...(retake.length ? ['What to change:', ...retake] : []),
        'How to take it:', ...steps,
        p.uploadUrl ? `Send your photograph: ${p.uploadUrl}` : '',
        `The link works until ${expires}, once.`,
        site ? `Questions: ${site}/ask.html, quoting your member number.` : 'Questions: reply to this email, quoting your member number.'
      ])
    };
  },

  member_photo_received(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    /* the state member number shown; the reference the track page knows */
    const ref = p.memberNo || p.memberId || p.reference || '';
    const trackRef = p.memberId || p.reference || '';
    const track = site && ref ? `${site}/track.html#ref=${encodeURIComponent(trackRef)}` : '';
    const html = letter({
      title: 'Photograph received',
      preheader: `PFA has your photograph for membership card ${ref}.`,
      siteUrl: site,
      kicker: 'Membership card',
      headline: 'Photograph received.',
      greeting: first ? `${first},` : 'Hello,',
      lead: 'thank you. Your photograph is with PFA for approval. Once it is approved your membership card is printed and sent to you by courier. If anything needs changing, we will email you.',
      rows: [
        { label: 'Member number', value: ref, big: true },
        { label: 'Received on', value: formatDate(p.receivedAt) }
      ],
      button: track ? { label: 'Follow your card', url: track } : null,
      afterHtml: site ? `Questions? <a href="${escapeHtml(site)}/ask.html" style="color:#111111;text-decoration:underline">Write to PFA</a> quoting your member number.` : ''
    });
    return {
      subject: `Photograph received - PFA membership card ${ref}`,
      html,
      text: textFrom([
        `${first ? first + ', t' : 'T'}hank you. Your photograph is with PFA for approval. Once it is approved your membership card is printed and sent to you by courier.`,
        `Member number: ${ref}`,
        track ? `Follow your card: ${track}` : '',
        site ? `Questions: ${site}/ask.html` : ''
      ])
    };
  },

  member_card_approved(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    /* the state member number shown; the reference the track page knows */
    const ref = p.memberNo || p.memberId || p.reference || '';
    const trackRef = p.memberId || p.reference || '';
    const track = site && ref ? `${site}/track.html#ref=${encodeURIComponent(trackRef)}` : '';
    const html = letter({
      title: 'Your membership card is approved',
      preheader: `Your PFA membership card ${ref} is approved and being printed.`,
      siteUrl: site,
      kicker: 'Membership card',
      headline: 'Your card is approved.',
      greeting: first ? `${first},` : 'Hello,',
      lead: 'your photograph is approved and your PFA membership card is being printed. The printed card is the only copy: it comes to the address you gave by courier, and it is never sent by email or shown online. You will be emailed the courier and tracking number when it leaves.',
      rows: [
        { label: 'Member number', value: ref, big: true },
        { label: 'Membership', value: p.tierLabel || '' },
        { label: 'Valid until', value: p.lifetime ? 'Lifetime' : formatDate(p.validUntil) }
      ],
      button: track ? { label: 'Follow your card', url: track } : null,
      afterHtml: site ? `If your address has changed, <a href="${escapeHtml(site)}/ask.html" style="color:#111111;text-decoration:underline">write to PFA</a> now, quoting your member number.` : ''
    });
    return {
      subject: `Your PFA membership card is approved - ${ref}`,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our photograph is approved and your PFA membership card is being printed. The printed card is the only copy: it comes to the address you gave by courier, and it is never sent by email or shown online.`,
        `Member number: ${ref}`,
        p.tierLabel ? `Membership: ${p.tierLabel}` : '',
        `Valid until: ${p.lifetime ? 'Lifetime' : formatDate(p.validUntil)}`,
        track ? `Follow your card: ${track}` : '',
        site ? `Address changed? ${site}/ask.html` : ''
      ])
    };
  },

  /* The printed card handed to the courier: the courier and the number to
     follow it by. No card, no image of it, no link to one (a standing rule,
     owner, 26 Oct 2026: only the physical card is issued, by courier). */
  member_card_dispatched(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    /* the state member number shown */
    const ref = p.memberNo || p.memberId || p.reference || '';
    const html = letter({
      title: 'Your membership card is on its way',
      preheader: `Your PFA membership card is with ${p.courier || 'the courier'}, tracking number ${p.trackingNumber || ''}.`,
      siteUrl: site,
      kicker: 'Membership card',
      headline: 'Your card is on its way.',
      greeting: first ? `${first},` : 'Hello,',
      lead: 'your printed PFA membership card has been handed to the courier. It comes to the address you gave; follow it with the courier using the tracking number below.',
      rows: [
        { label: 'Tracking number', value: p.trackingNumber || '', big: true },
        { label: 'Courier', value: p.courier || '' },
        { label: 'Dispatched on', value: formatDate(p.dispatchedAt) },
        { label: 'Member number', value: ref }
      ],
      afterHtml: site ? `If it has not reached you in ten days, <a href="${escapeHtml(site)}/ask.html" style="color:#111111;text-decoration:underline">write to PFA</a> quoting your member number.` : ''
    });
    return {
      subject: `Your PFA membership card is on its way - ${p.courier || 'courier'} ${p.trackingNumber || ''}`.trim(),
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our printed PFA membership card has been handed to the courier. It comes to the address you gave.`,
        `Courier: ${p.courier || ''}`,
        `Tracking number: ${p.trackingNumber || ''}`,
        `Dispatched on: ${formatDate(p.dispatchedAt)}`,
        `Member number: ${ref}`,
        site ? `Not arrived in ten days? ${site}/ask.html` : ''
      ])
    };
  },

  /* The internship certificate, sent from the panel (lib/routes/admin/
     certificates.js; owner, 2 Nov 2026: "issue the cert digitally which can
     be sent to the person completing it over email and there should be a
     publicy verifiable link that it is a genuine certificate"). The PDF is
     attached as the panel drew it; the button opens the public check,
     which anyone the person shows it to can open too. */
  internship_certificate(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    const long = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${Number(m[3])} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1]} ${m[1]}` : String(iso || ''); };
    const verify = /^https:\/\/[^\s"'<>]+$/.test(String(p.verifyUrl || '')) ? String(p.verifyUrl) : '';
    const html = letter({
      title: 'Your PFA internship certificate',
      preheader: `Your PFA internship certificate, ${p.number || ''}, is attached.`,
      siteUrl: site,
      kicker: 'Internship certificate',
      headline: 'Your certificate.',
      greeting: first ? `${first},` : 'Hello,',
      lead: `you have completed the People for Animals remote internship, from ${long(p.startDate)} to ${long(p.endDate)}. Thank you for the work you did for the animals of your town. Your certificate is attached as a PDF. Anyone can check that it is genuine, with its number, at the link below: share it with your college or an employer.`,
      rows: [
        { label: 'Certificate number', value: p.number || '', big: true },
        { label: 'Name', value: p.name || '' },
        { label: 'Internship', value: `${long(p.startDate)} to ${long(p.endDate)}` },
        { label: 'Issued on', value: long(p.issuedOn) }
      ],
      button: verify ? { label: 'Check it is genuine', url: verify } : null,
      afterHtml: verify ? `The check: <a href="${escapeHtml(verify)}" style="color:#111111;text-decoration:underline">${escapeHtml(verify)}</a>` : ''
    });
    const text = textFrom([
      `${first ? `${first}, y` : 'Y'}ou have completed the People for Animals remote internship, from ${long(p.startDate)} to ${long(p.endDate)}. Your certificate is attached as a PDF.`,
      `Certificate number: ${p.number || ''}`,
      `Name: ${p.name || ''}`,
      `Issued on: ${long(p.issuedOn)}`,
      verify ? `Anyone can check it is genuine: ${verify}` : ''
    ].filter(Boolean));
    return { subject: `Your PFA internship certificate - ${p.number || ''}`.trim(), html, text };
  },

  /* The standard shipping letter, from the registers in the panel (owner,
     2 Nov 2026: "Admins must be able to update the courier name, tracking
     number, and application status (e.g., Shipped), then send applicants an
     email using a standard template"). One letter for a colony caregiver
     card and a membership card, said from where the card is: being
     prepared, shipped (with the courier and the tracking number), delivered,
     or returned to PFA (asking for the address again). Sent only after the
     administrator has seen it (lib/routes/admin/registers.js). Not
     shipment_update, which is the paid printed card's own letter. */
  card_shipping(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    const what = p.kind === 'membership' ? 'membership card' : 'colony caregiver card';
    const ref = p.reference || '';
    const lines = Array.isArray(p.addressLines) ? p.addressLines.filter(Boolean) : [];
    const say = {
      processing: { headline: 'Your card is being prepared.', subject: `Your PFA ${what} is being prepared`, lead: `your PFA ${what} is being prepared. We will write again with the courier and the tracking number when it is sent to the address below.` },
      shipped: { headline: 'Your card is on its way.', subject: `Your PFA ${what} is on its way${p.courier ? ` - ${p.courier}` : ''}${p.trackingNumber ? ` ${p.trackingNumber}` : ''}`, lead: `your PFA ${what} has been handed to ${p.courier || 'the courier'}. It is coming to the address below; follow it with the courier using the tracking number.` },
      delivered: { headline: 'Your card has been delivered.', subject: `Your PFA ${what} has been delivered`, lead: `the courier says your PFA ${what} has been delivered to the address below. If it has not reached you, reply to this email and we will look into it.` },
      returned: { headline: 'Your card came back to us.', subject: `Your PFA ${what} could not be delivered`, lead: `the courier could not deliver your PFA ${what} and it has come back to PFA. Reply to this email with your full address (house or flat number, floor, street, area, PIN code) and a phone number the courier can call, and we will send it again.` }
    }[p.status] || null;
    const W = say || { headline: 'An update on your card.', subject: `An update on your PFA ${what}`, lead: `here is where your PFA ${what} stands.` };
    const rows = [
      p.trackingNumber && p.status !== 'processing' ? { label: 'Tracking number', value: p.trackingNumber, big: true } : null,
      p.courier && p.status !== 'processing' ? { label: 'Courier', value: p.courier } : null,
      { label: 'Status', value: p.statusLabel || '' },
      lines.length ? { label: p.status === 'returned' ? 'Address we have' : 'Address', value: lines.join(', ') } : null,
      ref ? { label: p.kind === 'membership' ? 'Member number' : 'Application number', value: ref } : null,
      p.cardId ? { label: 'Card number', value: p.cardId } : null
    ].filter((r) => r && r.value);
    const html = letter({
      title: W.subject,
      preheader: `${W.headline}${p.trackingNumber && p.status === 'shipped' ? ` ${p.courier || 'Courier'} tracking number ${p.trackingNumber}.` : ''}`,
      siteUrl: site,
      kicker: p.kind === 'membership' ? 'Membership card' : 'Colony caregiver card',
      headline: W.headline,
      greeting: first ? `${first},` : 'Hello,',
      lead: W.lead,
      rows,
      afterHtml: p.status === 'shipped' && site ? `If it has not reached you in ten days, reply to this email or <a href="${escapeHtml(site)}/ask.html" style="color:#111111;text-decoration:underline">write to PFA</a>, quoting the number above.` : ''
    });
    const text = textFrom([
      `${first ? `${first}, ${W.lead}` : W.lead.charAt(0).toUpperCase() + W.lead.slice(1)}`,
      ...rows.map((r) => `${r.label}: ${r.value}`),
      p.status === 'shipped' ? 'Not arrived in ten days? Reply to this email, quoting the number above.' : ''
    ].filter(Boolean));
    return { subject: W.subject, html, text };
  },

  /* To the forms inbox: a member's photograph is waiting for approval. A
     notice, with no money and no photograph in it; the decision is made in
     the panel, where the photograph is. */
  member_photo_staff(payload) {
    const p = payload || {};
    /* the state member number shown */
    const ref = p.memberNo || p.memberId || p.reference || '';
    const html = letter({
      title: 'Membership photograph to approve',
      preheader: `${p.name || 'A member'} sent the photograph for membership card ${ref}.`,
      siteUrl: siteOf(p),
      kicker: 'For the office',
      headline: 'A membership photograph is waiting.',
      greeting: null,
      lead: `${p.name || 'A member'} has sent the photograph for their membership card. Approve it, or ask for another, in the panel under Membership cards.`,
      rows: [
        { label: 'Member number', value: ref, big: true },
        { label: 'Membership', value: p.tierLabel || '' },
        { label: 'Received on', value: formatDateTime(p.receivedAt) }
      ],
      button: p.panelUrl ? { label: 'Open Membership cards', url: p.panelUrl } : null,
      signoff: false
    });
    return {
      subject: `Membership photograph to approve - ${ref}${p.name ? ` - ${p.name}` : ''}`,
      html,
      text: textFrom([
        `${p.name || 'A member'} has sent the photograph for their membership card. Approve it, or ask for another, in the panel under Membership cards.`,
        `Member number: ${ref}`,
        p.tierLabel ? `Membership: ${p.tierLabel}` : '',
        p.panelUrl ? `Panel: ${p.panelUrl}` : ''
      ])
    };
  },

  /* To the administrators: replies sent to PFA's emails are not being picked
     up (owner, 27 Oct 2026: "If the info@ check fails or hasn't run for 30
     minutes, you get an email ... Replies can never silently pile up").
     lib/reply-watch.js sends it once when it starts, again every six hours
     while it lasts, and replies_working when it is over. */
  replies_stuck(payload) {
    const p = payload || {};
    const stale = p.kind === 'stale';
    const lead = stale
      ? `The website has not checked ${p.mailbox || 'the info@ mailbox'} for replies since ${formatDateTime(p.lastRunAt) || 'it was deployed'}. It should check every two minutes.`
      : `The website cannot read ${p.mailbox || 'the info@ mailbox'}, so replies to PFA's emails are not being picked up. It has failed ${p.failStreak || 'several'} times in a row since ${formatDateTime(p.since)}.`;
    const html = letter({
      title: 'Replies are not being picked up',
      preheader: lead,
      siteUrl: siteOf(p),
      kicker: 'Website alert',
      headline: 'Replies are not being picked up.',
      greeting: null,
      lead,
      rows: [
        { label: 'Problem', value: stale ? 'The reply check has stopped running' : (p.error || 'The mailbox could not be read'), big: true },
        { label: 'Mailbox', value: p.mailbox || '' },
        { label: 'Last checked', value: formatDateTime(p.lastRunAt) || 'Never' },
        { label: 'What this means', value: 'Replies wait safely in the mailbox; nothing is lost. They are filed and sent on as soon as the check works again.' },
        { label: 'What to do', value: stale ? 'Open the panel and press Check for replies now on Overview. If it still says not checked, run the deploy again.' : 'If the info@ password was changed, set the new one for the website and deploy again. Then press Check for replies now on Overview.' }
      ],
      button: p.panelUrl ? { label: 'Open the panel', url: p.panelUrl } : null,
      signoff: false
    });
    return {
      subject: `Website alert: replies are not being picked up${p.mailbox ? ` (${p.mailbox})` : ''}`,
      html,
      text: textFrom([
        lead,
        stale ? '' : `Problem: ${p.error || 'The mailbox could not be read'}`,
        'Replies wait safely in the mailbox; nothing is lost. They are filed and sent on as soon as the check works again.',
        p.panelUrl ? `Panel: ${p.panelUrl}` : ''
      ])
    };
  },

  replies_working(payload) {
    const p = payload || {};
    const lead = `The website is reading ${p.mailbox || 'the info@ mailbox'} again. Replies that waited are being filed on their cases and sent on now.`;
    const html = letter({
      title: 'Replies are being picked up again',
      preheader: lead,
      siteUrl: siteOf(p),
      kicker: 'Website alert, over',
      headline: 'Replies are being picked up again.',
      greeting: null,
      lead,
      rows: [
        { label: 'Working again since', value: formatDateTime(p.at), big: true },
        { label: 'Stopped since', value: formatDateTime(p.since) || '' }
      ],
      button: p.panelUrl ? { label: 'Open the panel', url: p.panelUrl } : null,
      signoff: false
    });
    return {
      subject: `Website: replies are being picked up again${p.mailbox ? ` (${p.mailbox})` : ''}`,
      html,
      text: textFrom([lead, p.panelUrl ? `Panel: ${p.panelUrl}` : ''])
    };
  },

  membership_welcome(payload) {
    const K = CONFIRM.forKind('PFA-MEM');
    const amount = '\u20b9' + Number(payload.amount || 0).toLocaleString('en-IN');
    const first = firstName(payload.name);
    const site = siteOf(payload);
    const tier = String(payload.tierLabel || 'membership').toLowerCase();
    /* the state member number (lib/member-numbers.js), and the membership
       reference the track page knows it by */
    const number = payload.memberNo || payload.memberId || payload.orderId;
    const ref = payload.memberNo && payload.memberId ? payload.memberId : '';
    const kit = Array.isArray(payload.kit) ? payload.kit.filter(Boolean) : [];
    const track = site ? `${site}/track.html#ref=${encodeURIComponent(payload.memberId || '')}` : '';
    /* the card carries the member's photograph, asked for by a private
       link (26 Oct 2026, lib/membership-card.js) */
    const arrives = 'PFA will email you a private link to send your photograph for the membership card. '
      + (kit.length ? 'Your printed card then comes to you by courier, with your kit, in 20 to 25 days.' : 'Your printed card then comes to you by courier in 20 to 25 days.');
    const html = letter({
      title: 'Welcome to People for Animals',
      preheader: `Your ${tier} of People for Animals is active from today. ${K.number} ${number}.`,
      siteUrl: site,
      headline: K.headline,
      greeting: first ? `${first},` : 'Welcome,',
      lead: `your ${tier} of People for Animals is active from today. ${K.lead}`,
      rows: [
        { label: K.number, value: number, big: true },
        ...(ref ? [{ label: 'Membership reference', value: ref }] : []),
        { label: 'Paid', value: `${amount} on ${formatDate(payload.paidAt)} \u00b7 PFA transaction ${payload.orderId}${payload.bankReference ? ` \u00b7 bank reference ${payload.bankReference}` : ''}` }
      ],
      sections: [kit.length ? { title: 'On its way to you', items: kit, note: arrives } : { note: arrives }],
      button: site ? { label: 'Find your nearest unit', url: `${site}/units.html` } : null,
      afterHtml: site ? `Follow your card${kit.length ? ' and kit' : ''} at <a href="${escapeHtml(track)}" style="color:#111111;text-decoration:underline">${escapeHtml(site.replace(/^https?:\/\//, ''))}/track.html</a> with your ${ref ? `membership reference, ${escapeHtml(ref)},` : 'member number'} and this email address.` : '',
      fine: [
        'People for Animals is a registered trust; membership payments are eligible for exemption under Section 80G of the Income Tax Act, 1961, and this letter is your acknowledgement.',
        'Quote the member number in any message about your membership.',
        'PFA never sees your card, bank or UPI details; the payment was taken by CCAvenue.'
      ]
    });
    return {
      /* the subject names the conversation, which later emails keep: the
         membership reference, as the record's thread subject has it */
      subject: `You're one of us now - PFA member ${payload.memberId || number}`,
      messageId: threadHeaders(payload, 'confirm').messageId,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our ${tier} of People for Animals is active from today.`,
        `Member number: ${number}`,
        ...(ref ? [`Membership reference: ${ref}`] : []),
        `Paid: ${amount} on ${formatDate(payload.paidAt)} - PFA transaction ${payload.orderId}`,
        ...(payload.bankReference ? [`Bank reference: ${payload.bankReference}`] : []),
        ...(kit.length ? ['On its way to you: ' + kit.join('; ')] : []),
        arrives,
        K.lead,
        ...(site ? [`Find your nearest unit: ${site}/units.html`, `Follow your card${kit.length ? ' and kit' : ''}: ${track}`] : []),
        'Membership payments are eligible for exemption under Section 80G; this letter is your acknowledgement.'
      ])
    };
  },

  /* The monthly payments report (lib/finance-report.js; owner, 1 Nov 2026:
     "email a consolidated financial report for the previous calendar month
     to gandhim, CC'ing the accounts team"). A summary table of the five
     heads with their subtotals and the month's grand total, then each
     head's payments: who paid, when, for what, how much, the status and the
     references. The full list is the attached CSV. */
  finance_monthly(payload) {
    return paymentsReport(payload, null);
  },

  /* A payments report for any period, sent from Payments & donations by
     hand (lib/finance-report.js, sendPeriod; owner, 3 Nov 2026: "send report
     from here to selected people with segregation ... for the selected
     duration"). The monthly report's layout and CSV; its own words. */
  finance_period(payload) {
    return paymentsReport(payload, payload || {});
  },

  /* A section's report for a period, sent from the panel
     (lib/section-report.js; owner, 4 Nov 2026: "these also should have date
     and range filters and option to send the report to those email"): how
     many, then the lines with their first columns. The CSV has every column. */
  section_report(payload) {
    const p = payload || {};
    const cols = Array.isArray(p.columns) ? p.columns : [];
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const count = Number(p.count) || 0;
    const what = `${count} ${count === 1 ? 'line' : 'lines'}`;
    const cell = (v) => `<td style="padding:8px 8px 8px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;line-height:1.45;color:${INK};vertical-align:top">${escapeHtml(v == null ? '' : v)}</td>`;
    const th = (v) => `<th align="left" style="padding:8px 8px 8px 0;border-bottom:2px solid ${INK};font-family:${SANS};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${SOFT};font-weight:700">${escapeHtml(v)}</th>`;
    const table = rows.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 0"><tr>${cols.map(th).join('')}</tr>${rows.map((r) => `<tr>${(r || []).map(cell).join('')}</tr>`).join('')}</table>`
        + (p.more > 0 ? `<div style="margin:8px 0 0;font-family:${SANS};font-size:12px;color:${SOFT}">and ${escapeHtml(String(p.more))} more in the attached CSV</div>` : '')
      : `<div style="font-family:${SANS};font-size:14px;color:${SOFT}">Nothing in this period.</div>`;
    const html = letter({
      title: `PFA ${p.label || 'report'}: ${p.period || ''}`,
      preheader: `${p.label || ''}, ${p.period || ''}: ${what}${p.total ? `, ${p.total}` : ''}.`,
      siteUrl: siteOf(p),
      kicker: `${p.label || 'Report'}`,
      headline: p.period || '',
      greeting: null,
      lead: `${p.label || 'The section'} on PFA's website, ${p.period || ''}, India time: ${what}${p.total ? `, ${p.total} in all` : ''}. Every column is in the attached CSV (${p.csvName || 'CSV'}).`,
      bodyHtml: [table],
      button: { label: PANEL_BUTTON, url: panelLink(SECTION_TABS[p.kind] || '') },
      signoff: 'Sent from the PFA website\u2019s admin panel.',
      fine: ['Spam and removed entries, and the site\u2019s own testing, are left out.']
    });
    const text = textFrom([
      `PFA ${p.label || 'report'}: ${p.period || ''}`,
      `${what}${p.total ? `, ${p.total}` : ''}.`,
      ...rows.slice(0, 50).map((r) => (r || []).filter(Boolean).join(' | ')),
      `Every column is in the attached CSV (${p.csvName || 'CSV'}).`,
      `Admin panel: ${panelLink(SECTION_TABS[p.kind] || '')}`
    ]);
    return { subject: `PFA ${p.label || 'report'}: ${p.period || ''} (${what})`, html, text };
  },

  /* The internship portal (lib/intern-store.js). The welcome carries the
     one link that shows the access key, once; the key itself is never in an
     email. A new link (after PFA verified the intern) says the old key has
     stopped working. */
  intern_welcome(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const html = letter({
      title: p.again ? 'Your new PFA internship access' : 'Your PFA internship access',
      preheader: 'Open the link to get your Intern ID and access key. It works once.',
      siteUrl: siteOf(p),
      kicker: 'Remote internship',
      headline: p.again ? 'A new access key' : 'Welcome to the internship',
      greeting: first ? `${first},` : 'Hello,',
      lead: p.again
        ? 'PFA has made you a new access key. Your old key has stopped working. Open the link below to see your Intern ID and the new key.'
        : `you are in${p.batchName ? ` ${p.batchName}` : ''}. Open the link below to see your Intern ID and access key. Write the key down: it is shown once, and you sign in with it for the whole internship.`,
      rows: [
        { label: 'Starts', value: p.startDate ? formatDate(p.startDate) : '' },
        { label: 'Link works until', value: p.expiresAt ? formatDateTime(p.expiresAt) : '' }
      ],
      button: p.link ? { label: 'Get my access key', url: p.link } : null,
      afterHtml: siteOf(p) ? `New to this? <a href="${escapeHtml(siteOf(p))}/intern-guide" style="color:${INK};text-decoration:underline">Read the two-page guide</a>: how to get in, what to do each week, and how to send your work.` : '',
      fine: [
        'The link works once. If someone else opens it first, write to PFA and ask for a new one.',
        'PFA will never ask you for your access key, and it is never your mobile number.'
      ]
    });
    return {
      subject: p.again ? 'Your new PFA internship access key' : 'Your PFA internship access',
      html,
      text: textFrom([
        `${first ? first + ', ' : ''}${p.again ? 'PFA has made you a new access key. Your old key has stopped working.' : 'you are in the PFA remote internship.'}`,
        'Open this link to see your Intern ID and access key. It works once; write the key down.',
        p.link || '',
        p.expiresAt ? `The link works until ${formatDateTime(p.expiresAt)}.` : '',
        siteOf(p) ? `New to this? The two-page guide: ${siteOf(p)}/intern-guide` : ''
      ])
    };
  },

  /* Approved (owner, 5 Nov 2026: "only on clicking approve, the start
     internship email will go from admin to the applicant and then the
     person can login"): no link to keep, nothing shown once. They sign in
     with what they applied with. */
  intern_start(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    const portal = p.link || (site ? `${site}/intern.html` : '');
    const html = letter({
      title: 'Your PFA internship has started',
      preheader: 'Sign in with your email, mobile number and date of birth.',
      siteUrl: site,
      kicker: 'Remote internship',
      headline: 'Your internship has started',
      greeting: first ? `${first},` : 'Hello,',
      lead: `your application is approved and you are in${p.batchName ? ` ${p.batchName}` : ' the PFA remote internship'}. Sign in to your dashboard with the three details you applied with: this email address, your mobile number${p.mobileEnd ? ` (ending ${p.mobileEnd})` : ''} and your date of birth.`,
      rows: [
        { label: 'Starts', value: p.startDate ? formatDate(p.startDate) : '' },
        { label: 'Intern ID', value: p.internId || '' }
      ],
      button: portal ? { label: 'Open my dashboard', url: portal } : null,
      afterHtml: site ? `New to this? <a href="${escapeHtml(site)}/intern-guide" style="color:${INK};text-decoration:underline">Read the two-page guide</a>: how to sign in, what to do each week, and how to send your work.` : '',
      fine: [
        'Your date of birth is part of how you sign in, so do not share it with your email and number together.',
        'Changed your email or number? Write to PFA; they check it is you and change it.'
      ]
    });
    return {
      subject: 'Your PFA internship has started',
      html,
      text: textFrom([
        `${first ? first + ', ' : ''}your application is approved and you are in${p.batchName ? ` ${p.batchName}` : ' the PFA remote internship'}.`,
        p.startDate ? `It starts on ${formatDate(p.startDate)}.` : '',
        `Sign in with this email address, your mobile number${p.mobileEnd ? ` (ending ${p.mobileEnd})` : ''} and your date of birth:`,
        portal,
        p.internId ? `Your Intern ID: ${p.internId}` : '',
        site ? `New to this? The two-page guide: ${site}/intern-guide` : ''
      ])
    };
  },

  /* PFA asks for what sign-in needs (lib/intern-applications.js askFor):
     the form again, with the same email, lands on the same application. */
  intern_details_needed(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const site = siteOf(p);
    const form = p.formUrl || (site ? `${site}/internship.html` : '');
    const missing = (Array.isArray(p.missing) ? p.missing : []).map((x) => String(x));
    const what = missing.length < 2 ? (missing[0] || 'details') : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
    const html = letter({
      title: 'One more step for your PFA internship application',
      preheader: `PFA needs your ${what} to approve your application.`,
      siteUrl: site,
      kicker: 'Remote internship',
      headline: 'One more step',
      greeting: first ? `${first},` : 'Hello,',
      lead: `thank you for applying to the PFA remote internship. To approve your application, PFA needs your ${what}: once approved, you sign in with your email address, mobile number and date of birth. Fill in the internship form again with this same email address. It is added to your application${p.reference ? ` ${p.reference}` : ''}, not filed as a new one.`,
      rows: [{ label: 'Application', value: p.reference || '' }],
      button: form ? { label: 'Open the internship form', url: form } : null,
      fine: ['Use the same email address you applied with, so it reaches the same application.']
    });
    return {
      subject: 'One more step for your PFA internship application',
      html,
      text: textFrom([
        `${first ? first + ', ' : ''}thank you for applying to the PFA remote internship.`,
        `To approve your application, PFA needs your ${what}: once approved, you sign in with your email address, mobile number and date of birth.`,
        `Fill in the internship form again with this same email address. It is added to your application${p.reference ? ` ${p.reference}` : ''}, not filed as a new one:`,
        form
      ])
    };
  },

  intern_reminder(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const items = Array.isArray(p.items) ? p.items : [];
    const html = letter({
      title: `Week ${p.week}: what is still open`,
      preheader: `${items.length} still open. Week ${p.week} closes ${p.due || 'tonight'}.`,
      siteUrl: siteOf(p),
      kicker: `Week ${p.week} of ${p.weeks || 8}`,
      headline: p.weekTitle || `Week ${p.week}`,
      greeting: first ? `${first},` : 'Hello,',
      lead: `week ${p.week} closes ${p.due || 'tonight'}. This is what is still open on your dashboard.`,
      rows: items.map((x) => ({ label: x.state, value: x.line })),
      button: p.link ? { label: 'Open my dashboard', url: p.link } : null,
      afterHtml: p.next ? escapeHtml(`Next: ${p.next}.`) : '',
      fine: ['You get this once a week, only when something is still open.']
    });
    return {
      subject: `PFA internship, week ${p.week}: ${items.length} still open`,
      html,
      text: textFrom([
        `${first ? first + ', w' : 'W'}eek ${p.week} closes ${p.due || 'tonight'}. Still open:`,
        ...items.map((x) => `${x.line} (${x.state})`),
        p.next ? `Next: ${p.next}.` : '',
        p.link ? `Your dashboard: ${p.link}` : ''
      ])
    };
  },

  /* PFA asks an intern to do their shelter work somewhere else
     (lib/intern-shelters.js askToChange). */
  intern_shelter_change(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const html = letter({
      title: 'Your shelter work: please choose another place',
      preheader: 'PFA has asked you to do your shelter work at another place.',
      siteUrl: siteOf(p),
      kicker: 'Remote internship',
      headline: 'Another place, please',
      greeting: first ? `${first},` : 'Hello,',
      lead: 'PFA has looked at the place you named for your shelter work and asked you to choose another. Name the new place in your dashboard, with its address, a phone number and two or three photographs; then your hours can be sent.',
      rows: [{ label: 'From PFA', value: p.reason || '' }],
      button: p.link ? { label: 'Open my dashboard', url: p.link } : null
    });
    return {
      subject: 'Your shelter work: please choose another place',
      html,
      text: textFrom([
        `${first ? first + ', P' : 'P'}FA has looked at the place you named for your shelter work and asked you to choose another.`,
        p.reason ? `From PFA: ${p.reason}` : '',
        'Name the new place in your dashboard, with its address, a phone number and two or three photographs; then your hours can be sent.',
        p.link ? `Your dashboard: ${p.link}` : ''
      ])
    };
  },

  intern_feedback(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const accepted = p.state === 'accepted';
    const html = letter({
      title: accepted ? `Accepted: ${p.task}` : `Revise: ${p.task}`,
      preheader: accepted ? `Your proof for ${p.task} is accepted.` : `PFA has asked for a revision of ${p.task}.`,
      siteUrl: siteOf(p),
      kicker: 'Remote internship',
      headline: accepted ? 'Accepted' : 'One more go',
      greeting: first ? `${first},` : 'Hello,',
      lead: accepted ? `your proof for ${p.task} has been accepted.` : `PFA has looked at your proof for ${p.task} and asked for a revision. Send it again from your dashboard.`,
      rows: [
        { label: 'Task', value: p.task },
        { label: 'Score', value: accepted && p.score != null ? `${p.score} out of 10` : '' },
        { label: 'From PFA', value: p.feedback || '' }
      ],
      button: p.link ? { label: 'Open my dashboard', url: p.link } : null
    });
    return {
      subject: accepted ? `Accepted: ${p.task}` : `Please revise: ${p.task}`,
      html,
      text: textFrom([
        accepted ? `${first ? first + ', y' : 'Y'}our proof for ${p.task} has been accepted.` : `${first ? first + ', ' : ''}PFA has asked for a revision of ${p.task}.`,
        accepted && p.score != null ? `Score: ${p.score} out of 10` : '',
        p.feedback ? `From PFA: ${p.feedback}` : '',
        p.link ? `Your dashboard: ${p.link}` : ''
      ])
    };
  },

  /* An intern's quiz marks, after each attempt (lib/intern-quiz.js). */
  intern_quiz_result(payload) {
    const p = payload || {};
    const first = firstName(p.name);
    const pass = Boolean(p.pass);
    const next = pass
      ? 'Week 1\'s task, Learn the law, is marked done. Every question, with the right answer and why, is open in your dashboard.'
      : p.lastAttempt
        ? `That was your last attempt. Your best was ${p.best}%; PFA will look at it and write to you.`
        : `You have ${p.left} more ${Number(p.left) === 1 ? 'attempt' : 'attempts'}; the next opens ${p.next}. Your dashboard shows your marks by topic, to help you prepare.`;
    const headline = pass ? 'You passed.' : 'Your quiz marks.';
    const html = letter({
      title: `Your PFA internship quiz: ${p.percent}%`,
      preheader: `Attempt ${p.n} of ${p.of}: ${p.percent}%. ${pass ? 'A pass.' : `The pass mark is ${p.passMark}%.`}`,
      siteUrl: siteOf(p),
      kicker: 'Remote internship',
      headline,
      greeting: first ? `${first},` : 'Hello,',
      lead: `here are your marks for attempt ${p.n} of ${p.of} of the internship quiz. ${next}`,
      rows: [
        { label: 'Score', value: `${p.percent}% (${p.points} of ${p.max} marks)` },
        { label: 'Result', value: pass ? 'Pass' : `Below the pass mark of ${p.passMark}%` },
        { label: 'Easy', value: p.easy },
        { label: 'Medium', value: p.medium },
        { label: 'Hard', value: p.hard },
        { label: 'Answered', value: `${p.answered} of ${p.count}${p.timedOut ? ', when the time ran out' : ''}` },
        { label: 'Time taken', value: `${p.minutes} minutes` }
      ],
      button: p.link ? { label: 'Open my dashboard', url: p.link } : null
    });
    return {
      subject: pass ? `You passed the PFA internship quiz: ${p.percent}%` : `Your PFA internship quiz: ${p.percent}%, attempt ${p.n} of ${p.of}`,
      html,
      text: textFrom([
        `${first ? first + ', h' : 'H'}ere are your marks for attempt ${p.n} of ${p.of} of the internship quiz.`,
        `Score: ${p.percent}% (${p.points} of ${p.max} marks). ${pass ? 'Pass.' : `The pass mark is ${p.passMark}%.`}`,
        `Easy ${p.easy}, medium ${p.medium}, hard ${p.hard}. ${p.answered} of ${p.count} answered${p.timedOut ? ', when the time ran out' : ''}, in ${p.minutes} minutes.`,
        next,
        p.link ? `Your dashboard: ${p.link}` : ''
      ])
    };
  },

  /* The Monday digest (lib/weekly-digest.js; owner, 1 Nov 2026: "on each
     Monday, a list of people who have ordered shop items become members,
     applied for caregiver card, applied for volunteer, jobs etc should go to
     gandhim cc anushkapfacampus@gmail.com . and hyperlink to that
     application within the admin portal"). One table per kind of thing
     done; each reference opens that record in the panel, where its status
     is moved along. No amounts. */
  weekly_digest(payload) {
    const p = payload || {};
    const groups = (Array.isArray(p.groups) ? p.groups : []).filter((g) => g && g.count > 0);
    const cell = (v, extra) => `<td style="padding:8px 8px 8px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;line-height:1.45;color:${INK};vertical-align:top${extra || ''}">${v}</td>`;
    const th = (v) => `<th align="left" style="padding:8px 8px 8px 0;border-bottom:2px solid ${INK};font-family:${SANS};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${SOFT};font-weight:700">${escapeHtml(v)}</th>`;
    const safeLink = (u) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : '');
    const ref = (r) => {
      const u = safeLink(r.link);
      return u ? `<a href="${escapeHtml(u)}" style="color:${INK};font-weight:700;text-decoration:underline">${escapeHtml(r.reference)}</a>` : escapeHtml(r.reference);
    };
    const summary = groups.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 0">`
        + `<tr>${th('This week')}${th('In')}${th('Still new')}</tr>`
        + groups.map((g) => `<tr>${cell(escapeHtml(g.label))}${cell(escapeHtml(String(g.count)))}${cell(escapeHtml(String(g.waiting || 0)))}</tr>`).join('')
        + `</table>`
      : `<div style="margin:8px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK}">Nothing came in this week.</div>`;
    const sections = groups.map((g) => `<div style="margin:30px 0 4px;font-family:${SERIF};font-size:20px;color:${INK}">${escapeHtml(g.label)}</div>`
      + `<div style="font-family:${SANS};font-size:13px;color:${SOFT}">${escapeHtml(String(g.count))} this week${g.waiting ? ` &middot; ${escapeHtml(String(g.waiting))} still new` : ''}</div>`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 0">`
      + `<tr>${th('Name')}${th('Reference')}${th('In on (IST)')}${th('Status now')}</tr>`
      + (g.rows || []).map((r) => `<tr>${cell(escapeHtml(r.name) + (r.place ? `<div style="font-size:12px;color:${SOFT}">${escapeHtml(r.place)}</div>` : ''))}${cell(ref(r))}${cell(escapeHtml(r.date), ';white-space:nowrap')}${cell(escapeHtml(r.status))}</tr>`).join('')
      + `</table>`
      + (g.more > 0 ? `<div style="margin:8px 0 0;font-family:${SANS};font-size:12px;color:${SOFT}">and ${escapeHtml(String(g.more))} more in the panel</div>` : '')).join('');
    const panel = safeLink(p.panelUrl);
    const html = letter({
      title: `PFA this week: ${p.label || ''}`,
      preheader: `${p.count || 0} new this week, ${p.waiting || 0} still new.`,
      siteUrl: siteOf(p),
      kicker: 'Monday digest',
      headline: p.label || '',
      greeting: null,
      lead: `Everyone who ordered from the shop, became a member, or applied for a caregiver card, to volunteer, for a job or the internship in the week of ${p.label || ''}, India time: ${p.count || 0} in all. Each reference opens that record in the admin panel, where its status can be moved along.`,
      bodyHtml: [summary, sections].filter(Boolean),
      button: { label: PANEL_BUTTON, url: panel || panelLink('submissions') },
      signoff: 'Sent automatically by the PFA website every Monday.',
      fine: ['Donations and amounts are not listed here; payments go to the payments inboxes and the monthly report.']
    });
    const text = textFrom([
      `PFA this week: ${p.label}`,
      `${p.count || 0} new this week, ${p.waiting || 0} still new.`,
      ...groups.map((g) => [`${g.label}: ${g.count}`].concat((g.rows || []).map((r) => `  ${r.name}, ${r.reference}, ${r.date}, ${r.status}: ${r.link}`)).join('\n')),
      `Admin panel: ${panel || panelLink('submissions')}`
    ].filter(Boolean));
    return { subject: `PFA this week: ${p.label} (${p.count || 0} new)`, html, text };
  },

  /* The monthly cruelty report (lib/cruelty-report.js; owner, 2 Nov 2026:
     "at 2nd of each month- previous months cruelty reports as 1 pdf has to
     be sent to gandhim. who reported what and when and from where", with "a
     state wise list ... so that PFA team can co-ordinate with govt of that
     state"). The email is the month at a glance, a line per state; the PDF
     attached has every report, each state on its own pages. */
  cruelty_monthly(payload) {
    const p = payload || {};
    const states = Array.isArray(p.states) ? p.states : [];
    const lo = p.leftOut || {};
    const real = states.filter((s) => s.state !== 'State not given').length;
    const now = states.reduce((n, s) => n + (Number(s.now) || 0), 0);
    const cell = (v, extra) => `<td style="padding:8px 8px 8px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;line-height:1.45;color:${INK};vertical-align:top${extra || ''}">${escapeHtml(v)}</td>`;
    const th = (v, extra) => `<th align="left" style="padding:8px 8px 8px 0;border-bottom:2px solid ${INK};font-family:${SANS};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${SOFT};font-weight:700${extra || ''}">${escapeHtml(v)}</th>`;
    const table = states.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 0">`
        + `<tr>${th('State')}${th('Reports', ';text-align:right')}${th('Happening now', ';text-align:right')}${th('Districts')}</tr>`
        + states.map((s) => `<tr>${cell(s.state, ';font-weight:700')}${cell(String(s.count), ';text-align:right')}${cell(String(s.now || 0), ';text-align:right')}${cell(s.districts || '', ';font-size:12px;color:' + SOFT)}</tr>`).join('')
        + `<tr><td style="padding:12px 8px 0 0;font-family:${SANS};font-size:15px;font-weight:800;color:${INK}">All states</td><td align="right" style="padding:12px 8px 0 0;font-family:${SANS};font-size:15px;font-weight:800;color:${INK}">${escapeHtml(String(p.count || 0))}</td><td align="right" style="padding:12px 8px 0 0;font-family:${SANS};font-size:15px;font-weight:800;color:${INK}">${escapeHtml(String(now))}</td><td></td></tr>`
        + `</table>`
      : `<div style="margin:8px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK}">No cruelty reports were filed on the website this month.</div>`;
    const leftOut = [lo.spam ? `${lo.spam} marked as spam` : '', lo.removed ? `${lo.removed} removed` : ''].filter(Boolean).join(' and ');
    const html = letter({
      title: `PFA cruelty reports: ${p.label || ''}`,
      preheader: `${p.label}: ${p.count || 0} cruelty report${Number(p.count) === 1 ? '' : 's'} from ${real} state${real === 1 ? '' : 's'}.`,
      siteUrl: siteOf(p),
      kicker: 'Monthly cruelty report',
      headline: p.label || '',
      greeting: null,
      lead: `Every cruelty report filed on PFA's website in ${p.label}, India time: ${p.count || 0} report${Number(p.count) === 1 ? '' : 's'} from ${real} state${real === 1 ? '' : 's'}. The attached PDF (${p.pdfName || 'PDF'}) has each one: who reported it, when, from where, and what they saw. Each state starts on its own page, so its pages can be taken up with that state's government as they are.`,
      bodyHtml: [table],
      button: { label: PANEL_BUTTON, url: panelLink('submissions') },
      signoff: 'Sent automatically by the PFA website on the 2nd of the month.',
      fine: [
        '"Happening now" counts the reports whose sender said the cruelty was still going on when they reported it.',
        'Photographs sent with a report are kept in the PFA admin panel, under its reference number.'
      ].concat(leftOut ? [`Left out of this report: ${leftOut} in the admin panel.`] : [])
    });
    const text = textFrom([
      `PFA cruelty reports: ${p.label}`,
      `${p.count || 0} report${Number(p.count) === 1 ? '' : 's'} from ${real} state${real === 1 ? '' : 's'}.`,
      ...states.map((s) => `${s.state}: ${s.count}${s.now ? ` (${s.now} happening now)` : ''}${s.districts ? `. ${s.districts}` : ''}`),
      `Admin panel: ${panelLink('submissions')}`,
      `Every report, state by state, is in the attached PDF (${p.pdfName || 'PDF'}).`
    ]);
    return { subject: `PFA cruelty reports: ${p.label} (${p.count || 0} report${Number(p.count) === 1 ? '' : 's'})`, html, text };
  },

  /* The internship quiz, each Monday, to gandhim (lib/quiz-report.js). */
  quiz_weekly(payload) {
    const p = payload || {};
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const hardest = Array.isArray(p.hardest) ? p.hardest : [];
    const n = Number(p.count) || 0;
    const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const cell = (v, extra) => `<td style="padding:8px 8px 8px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:13px;line-height:1.45;color:${INK};vertical-align:top${extra || ''}">${escapeHtml(v)}</td>`;
    const th = (v, extra) => `<th align="left" style="padding:8px 8px 8px 0;border-bottom:2px solid ${INK};font-family:${SANS};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${SOFT};font-weight:700${extra || ''}">${escapeHtml(v)}</th>`;
    const para = (v) => `<div style="margin:18px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK}">${v}</div>`;
    const table = rows.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 0">`
        + `<tr>${th('Intern')}${th('Score', ';text-align:right')}${th('Easy')}${th('Medium')}${th('Hard')}${th('Time')}</tr>`
        + rows.map((r) => `<tr>${cell(`${r.name} (${r.internId}), attempt ${r.attempt}, ${r.finished}`, ';font-weight:700')}`
          + `${cell(`${r.percent}% ${r.pass ? 'Pass' : 'Not passed'}`, ';text-align:right;white-space:nowrap')}${cell(r.easy)}${cell(r.medium)}${cell(r.hard)}`
          + `${cell(`${r.time}${r.timedOut ? ', ran out of time' : ''}`, ';font-size:12px;color:' + SOFT)}</tr>`).join('')
        + `</table>`
        + (Number(p.more) > 0 ? para(escapeHtml(`And ${p.more} more, in the attached CSV.`)) : '')
      : para('No intern finished the quiz this week.');
    const hard = hardest.length
      ? `<div style="margin:28px 0 0;font-family:${SANS};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${SOFT};font-weight:700">Most often got wrong</div>`
        + hardest.map((h) => para(`<b>${escapeHtml(`${h.rate}% right`)}</b> ${escapeHtml(`(${h.level}, ${h.seen} ${h.seen === 1 ? 'attempt' : 'attempts'}): ${h.text}`)}`)).join('')
      : '';
    const glance = n ? `${plural(n, 'attempt', 'attempts')} by ${plural(Number(p.interns) || 0, 'intern', 'interns')}; ${Number(p.passed) || 0} passed; average ${p.average}%.` : 'No attempts this week.';
    const html = letter({
      title: `PFA internship quiz: ${p.label || ''}`,
      preheader: `${p.label}: ${glance}`,
      siteUrl: siteOf(p),
      kicker: 'Internship quiz, weekly',
      headline: p.label || '',
      greeting: null,
      lead: `Every internship quiz attempt finished in the week of ${p.label}, India time. ${glance} The pass mark is ${p.passMark || 60}%. Easy, medium and hard show the questions right at each level.${n ? ` The attached CSV (${p.csvName || 'CSV'}) has the same lines for a spreadsheet.` : ''}`,
      bodyHtml: [table, hard],
      button: { label: PANEL_BUTTON, url: panelLink('internship') },
      signoff: 'Sent automatically by the PFA website every Monday.',
      fine: ['Thirty questions on ten common incidents, in 60 minutes. Marks: easy 1, medium 2, hard 3, out of 60; the Marks and Out of columns give each attempt\'s own total. Three attempts are allowed, a day apart; a pass marks the intern\'s law task as done.']
    });
    const text = textFrom([
      `PFA internship quiz: ${p.label}`,
      glance,
      ...rows.map((r) => `${r.name} (${r.internId}), attempt ${r.attempt}, ${r.finished}: ${r.percent}% ${r.pass ? 'Pass' : 'Not passed'}. Easy ${r.easy}, medium ${r.medium}, hard ${r.hard}. ${r.time}${r.timedOut ? ', ran out of time' : ''}.`),
      ...(hardest.length ? ['Most often got wrong:'].concat(hardest.map((h) => `${h.rate}% right (${h.level}): ${h.text}`)) : []),
      `Admin panel: ${panelLink('internship')}`
    ]);
    return { subject: `PFA internship quiz: ${p.label} (${n ? `${plural(n, 'attempt', 'attempts')}, ${Number(p.passed) || 0} passed` : 'no attempts'})`, html, text };
  },

  /* The one email a donor gets. The form asked for an email "for the
     receipt", and this is the acknowledgement, with the PFA transaction id
     they need to quote; the formal 80G certificate is issued by PFA's office
     against that id. The Give/Send order arm of this receipt retired with the
     food flow in v1.300; a donation is the one payment it is for. */
  payment_received(payload) {
    const usd = String(payload.currency || 'INR').toUpperCase() === 'USD';
    const amount = usd
      ? '$' + Number(payload.amount || 0).toFixed(2)
      : '\u20b9' + Number(payload.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const first = firstName(payload.name);
    /* only a donation given in someone's name is a gift (21 Oct 2026) */
    const gift = Boolean(payload.giftTo);
    const W = gift ? CONFIRM.GIFT : CONFIRM.DONATION;
    const what = gift ? 'gift' : 'donation';
    const html = letter({
      title: W.subject,
      preheader: `Your ${what} of ${amount} has reached People for Animals. ${CONFIRM.TRANSACTION} ${payload.orderId}.`,
      siteUrl: siteOf(payload),
      headline: W.headline,
      greeting: first ? `${first},` : 'Thank you,',
      lead: `your ${what} of ${amount} has reached People for Animals. ${W.lead}${gift ? ` PFA posts ${payload.giftTo} a Certificate of Appreciation signed by Smt. Maneka Sanjay Gandhi; the 80G receipt stays in your name.` : ''} Quote the transaction ID below in any message about this ${what}${payload.pan ? ', including for your 80G certificate' : ''}.`,
      rows: [
        { label: CONFIRM.TRANSACTION, value: payload.orderId, big: true },
        { label: 'Amount', value: amount },
        { label: 'Paid on', value: formatDate(payload.paidAt) },
        ...(payload.giftTo ? [
          { label: 'A gift for', value: payload.giftTo },
          { label: 'Certificate posted to', value: payload.giftAddress }
        ] : []),
        { label: 'Where it goes', value: payload.cause },
        { label: 'Bank reference', value: payload.bankReference }
      ],
      /* the receipt as a PDF, in PFA's own type (31 Oct 2026) */
      button: /^https:\/\//i.test(String(payload.receiptUrl || '')) ? { url: payload.receiptUrl, label: 'Download your receipt (PDF)' } : null,
      fine: [
        usd ? '' : 'Donations to People for Animals are eligible for tax deduction under Section 80G.',
        'People for Animals does not receive or store card, bank or UPI details; the payment was taken by CCAvenue.'
      ]
    });
    return {
      subject: `Donation received by PFA - ${payload.orderId}`,
      messageId: threadHeaders(payload, 'confirm').messageId,
      html,
      text: textFrom([
        first ? `${first},` : 'Thank you,',
        `Your ${what} of ${amount} has reached People for Animals. ${W.lead}`,
        `PFA transaction ID: ${payload.orderId}`,
        `Amount: ${amount}`,
        `Paid on: ${formatDate(payload.paidAt)}`,
        ...(payload.giftTo ? [
          `A gift for: ${payload.giftTo}. PFA posts them a Certificate of Appreciation signed by Smt. Maneka Sanjay Gandhi.`,
          `Certificate posted to: ${payload.giftAddress}`
        ] : []),
        ...(payload.cause ? [`Where it goes: ${payload.cause}`] : []),
        ...(payload.bankReference ? [`Bank reference: ${payload.bankReference}`] : []),
        ...(/^https:\/\//i.test(String(payload.receiptUrl || '')) ? [`Your receipt (PDF): ${payload.receiptUrl}`] : []),
        `Quote the transaction ID in any message about this ${what}${payload.pan ? ', including for your 80G certificate' : ''}.`,
        usd ? '' : 'Donations to People for Animals are eligible for tax deduction under Section 80G.'
      ])
    };
  },

  /* Every form that sends to /api/pfa-submissions: a report, a question, an
     application, a request, a film, a field note. Worded for what was sent,
     with its number called what it is (lib/confirmations.js). */
  submission_received(payload) {
    const K = payload.kind
      ? CONFIRM.forKind(payload.kind)
      : Object.assign({}, CONFIRM.forKind(''), { thing: CONFIRM.inSentence(payload.kindLabel || 'submission') });
    const first = firstName(payload.name);
    const reference = String(payload.reference || '');
    const html = letter({
      title: K.subject,
      preheader: `${K.number} ${reference}. ${K.lead}`,
      siteUrl: siteOf(payload),
      headline: K.headline,
      greeting: first ? `${first},` : 'Hello,',
      lead: `your ${K.thing} has reached People for Animals. ${K.lead}`,
      urgent: K.urgent,
      rows: [
        { label: K.number, value: reference, big: true },
        { label: 'Received', value: formatDateTime(payload.receivedAt) },
        { label: 'Type', value: payload.kindLabel || CONFIRM.inSentence(K.thing) },
        { label: 'Filed by', value: String(payload.name || '').trim().slice(0, 120) },
        { label: 'Photographs', value: Number(payload.attachments) > 0 ? `${Number(payload.attachments)} attached` : '' }
      ],
      button: payload.followUrl ? { label: `Track your ${K.short || 'submission'}`, url: payload.followUrl } : null,
      afterHtml: payload.followUrl ? escapeHtml(FOLLOW_NOTE) : '',
      fine: [
        `Quote the ${CONFIRM.inSentence(K.number)} in any message about this.`,
        'Did not send this? Reply to this email and PFA will look into it.'
      ]
    });
    return {
      subject: `${K.subject} - ${reference}`,
      messageId: threadHeaders(payload, 'confirm').messageId,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our ${K.thing} has reached People for Animals.`,
        K.lead,
        K.urgent || '',
        `${K.number}: ${reference}`,
        `Received: ${formatDateTime(payload.receivedAt)}`,
        payload.followUrl ? `Track your ${K.short || 'submission'}: ${payload.followUrl}` : '',
        'You will be asked for this number and the email or mobile you gave.'
      ])
    };
  },

  /* A paid colony caregiver application. It had no email at all: the fee
     cleared, a number was minted, and the applicant was left with whatever
     the result page said. The letter carries the number, what was paid, and
     what the fee is and is not, in the words of the form. */
  caregiver_application_received(payload) {
    const K = CONFIRM.forKind('PFA-CG');
    const first = firstName(payload.name);
    const site = siteOf(payload);
    const reference = String(payload.applicationRef || '');
    const number = reference || payload.orderId;
    const numberLabel = reference ? K.number : CONFIRM.TRANSACTION;
    const amount = '\u20b9' + Number(payload.amount || 0).toLocaleString('en-IN');
    const follow = site && reference ? `${site}/track.html#ref=${encodeURIComponent(reference)}` : '';
    const fee = 'The card is free. The fee is for postage only, to send the printed card to you; it is not payment for a card, and it gives the application this number.';
    const html = letter({
      title: K.subject,
      preheader: `${numberLabel} ${number}. ${K.lead}`,
      siteUrl: site,
      headline: K.headline,
      greeting: first ? `${first},` : 'Hello,',
      lead: `your application for a colony caregiver card has reached People for Animals. ${K.lead}`,
      rows: [
        { label: numberLabel, value: number, big: true },
        { label: 'Paid', value: `${amount} on ${formatDate(payload.paidAt)} \u00b7 PFA transaction ${payload.orderId}${payload.bankReference ? ` \u00b7 bank reference ${payload.bankReference}` : ''}` },
        { label: 'Where you feed', value: payload.colony }
      ],
      sections: [{ title: 'About the fee', note: fee }],
      button: follow ? { label: `Track your ${K.short}`, url: follow } : null,
      afterHtml: follow ? escapeHtml(FOLLOW_NOTE) : '',
      fine: [
        'Quote the application number in any message about this application.',
        'PFA never sees your card, bank or UPI details; the payment was taken by CCAvenue.',
        'Did not apply? Reply to this email and PFA will look into it.'
      ]
    });
    return {
      subject: `${K.subject} - ${number}`,
      messageId: threadHeaders(payload, 'confirm').messageId,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our application for a colony caregiver card has reached People for Animals.`,
        K.lead,
        `${numberLabel}: ${number}`,
        `Paid: ${amount} on ${formatDate(payload.paidAt)} - PFA transaction ${payload.orderId}`,
        payload.bankReference ? `Bank reference: ${payload.bankReference}` : '',
        payload.colony ? `Where you feed: ${payload.colony}` : '',
        fee,
        follow ? `Follow it: ${follow}` : ''
      ])
    };
  },

  shipping_paid(payload) {
    return {
      subject: `Printed card confirmed - ${payload.trackingId}`,
      html: shell({
        heading: 'Your printed card is being made.',
        intro: 'People for Animals has your payment for printing and delivery, and your card has gone into production. You can follow it from your card page; you will be emailed when it is dispatched.',
        rows: [
          { label: 'Card number', value: payload.cardId },
          { label: 'Tracking ID', value: payload.trackingId },
          { label: 'Amount paid', value: '₹' + Number(payload.amount || 0).toLocaleString('en-IN') },
          { label: 'Payment reference', value: payload.paymentReference }
        ],
        cta: { label: 'Track your card', url: payload.cardUrl },
        footnote: 'Printing and dispatch usually take a few working days.'
      }),
      text: textFrom([
        'People for Animals has your payment for printing and delivery, and your printed card is in production. You will be emailed when it is dispatched.',
        `Card number: ${payload.cardId}`,
        `Tracking ID: ${payload.trackingId}`,
        `Amount paid: ₹${Number(payload.amount || 0).toLocaleString('en-IN')}`,
        `Payment reference: ${payload.paymentReference}`,
        `Track your card: ${payload.cardUrl}`
      ])
    };
  },

  /* The same payment, for the payments inboxes (owner, 24 Oct 2026: every
     record of money goes to pfadcmho@gmail.com and ozairhusain@gmail.com,
     never gandhim). The fee for posting a printed card, first or
     replacement, used to reach only the card holder. */
  shipping_paid_staff(payload) {
    const p = payload || {};
    const rupees = '₹' + Number(p.amount || 0).toLocaleString('en-IN');
    const what = p.replacement ? 'a replacement printed card' : 'a printed card';
    return {
      subject: `Printed card fee paid ${p.orderId}: ${rupees}`,
      html: shell({
        heading: 'A printed card is paid for.',
        intro: `${p.name || 'A card holder'} has paid ${rupees} for ${what} to be printed and posted. It is on record in the admin panel under Colony cards.`,
        rows: [
          { label: 'Card number', value: p.cardId },
          { label: 'Paid', value: rupees },
          { label: 'For', value: p.replacement ? `A replacement${p.reason ? ` (${p.reason})` : ''}` : 'The first printed card' },
          { label: 'Deliver to', value: p.deliverTo },
          { label: 'Mobile', value: p.mobile },
          { label: 'Email', value: p.email },
          { label: 'Order ID', value: p.orderId },
          { label: 'CCAvenue tracking ID', value: p.trackingId },
          { label: 'Bank reference', value: p.bankReference },
          { label: 'Delivery tracking ID', value: p.shipmentId }
        ],
        footnote: 'Sent by the PFA website. Reply to the card holder from the address above, not to this email.',
        signoff: false
      }),
      text: textFrom([
        `Printed card fee ${p.orderId} paid: ${rupees}, for ${what}`,
        `Card number: ${p.cardId || ''}`,
        `Card holder: ${p.name || ''}`,
        `Deliver to: ${p.deliverTo || ''}`,
        `Mobile: ${p.mobile || ''}`,
        `Email: ${p.email || ''}`,
        `CCAvenue tracking ID: ${p.trackingId || ''}`,
        `Bank reference: ${p.bankReference || ''}`,
        `Delivery tracking ID: ${p.shipmentId || ''}`
      ])
    };
  },

  shipment_update(payload) {
    const dispatched = payload.status === 'dispatched';
    const delivered = payload.status === 'delivered';
    const heading = delivered ? 'Your card has been delivered.'
      : dispatched ? 'Your card has been dispatched.'
      : `Delivery update: ${payload.statusLabel}`;
    const intro = delivered
      ? 'Your printed Colony Caregiver Card has been delivered. Carry it when you feed.'
      : dispatched
        ? 'Your printed card has left us and is with the courier.'
        : `The status of your printed card has changed to ${payload.statusLabel}.`;

    return {
      subject: `${payload.statusLabel} - ${payload.trackingId}`,
      html: shell({
        heading,
        intro,
        rows: [
          { label: 'Status', value: payload.statusLabel },
          { label: 'Tracking ID', value: payload.trackingId },
          { label: 'Courier', value: payload.carrier },
          { label: 'Courier tracking', value: payload.carrierTrackingNumber },
          { label: 'Card number', value: payload.cardId }
        ],
        cta: { label: 'View delivery status', url: payload.cardUrl },
        footnote: payload.note || ''
      }),
      text: textFrom([
        heading,
        intro,
        `Status: ${payload.statusLabel}`,
        `Card number: ${payload.cardId}`,
        `Tracking ID: ${payload.trackingId}`,
        payload.carrier ? `Courier: ${payload.carrier}` : '',
        payload.carrierTrackingNumber ? `Courier tracking: ${payload.carrierTrackingNumber}` : '',
        `View status: ${payload.cardUrl}`
      ])
    };
  }
};

function render(template, payload) {
  const build = TEMPLATES[template];
  if (!build) throw new Error(`Unknown email template: ${template}`);
  const rendered = build(payload || {});
  if (!rendered.subject || !rendered.html) throw new Error(`Template ${template} produced nothing to send.`);
  return rendered;
}

const CONFIRMATION_TEMPLATES = new Set(['submission_forward', 'submission_followup', 'submission_answer', 'submission_received', 'payment_received', 'membership_welcome', 'caregiver_application_received', 'shop_order_confirmed', 'shop_order_staff', 'shipping_paid_staff']);

/* A confirmation the queue retries must not arrive twice when the first
   attempt only looked like a failure: it timed out here but reached the
   provider. The key is the same on every attempt at the same letter, so a
   provider that honours Idempotency-Key, as Resend does, sends it once.
   Emails that staff may deliberately send again carry no key. */
function idempotencyKey(template, to, payload) {
  if (!CONFIRMATION_TEMPLATES.has(template)) return '';
  const p = payload || {};
  const id = p.reference || p.applicationRef || p.memberId || p.orderId;
  if (!id) return '';
  /* a relayed message is one of several about the same submission */
  const part = template === 'submission_followup' ? `:${p.inboundId || p.n || ''}` : p.followUp ? `:${p.followUp}` : '';
  /* A reference can be issued twice (the counters were emptied on 8 Oct
     2026); the thread tells the two submissions apart, as in the queue's
     own keys (CONTRACT section 4). Records with no thread keep the old key. */
  const thread = MT.isThreadId(p.threadId) ? `:${p.threadId}` : '';
  return crypto.createHash('sha256').update(`${template}:${String(to || '').toLowerCase()}:${id}${thread}${part}`, 'utf8').digest('hex').slice(0, 48);
}

/* Every email the site writes by itself says so (RFC 3834), so that
   out-of-office replies and autoresponders do not answer it, and so that
   the reading of replies can tell such answers from people (8 Oct 2026,
   review C item 7). A reply a member of staff typed in the panel is a
   person writing, and carries nothing. */
const TYPED_BY_STAFF = new Set(['submission_reply']);
function autoSubmitted(template) {
  return TYPED_BY_STAFF.has(template) ? '' : 'auto-generated';
}

/* ---- what a failure means --------------------------------------------------

   8 Oct 2026, review C items 2 and 5. nodemailer reports a socket that goes
   quiet, or is reset, at ANY point of the conversation as command 'CONN'
   ('Timeout', ESOCKET, 'Connection closed unexpectedly'), including after
   the whole message has been handed over and only the server's "250 OK" is
   missing. Sending that message again through the second server then
   delivered it twice. So the phase is read from what is certain:

     connect   no SMTP conversation took place: the name did not resolve,
               the connection was refused or unreachable, the connection or
               greeting timed out, or TLS could not be set up. Nothing was
               handed over, so the next server may be tried at once.
     answered  the server replied with a code: it is the server's answer.
     before    the error names a command before DATA (EHLO, AUTH, MAIL FROM,
               RCPT TO, or nodemailer's own checks): nothing was handed over.
     unknown   the line went quiet or broke with no answer: the message may
               or may not have gone. Recorded as such; never retried through
               the other server in the same attempt. */
const CONNECT_CODES = /^(EDNS|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETLS)$/;
const QUIET_CODES = /^(ETIMEDOUT|ESOCKET|ECONNECTION|ECONNRESET|EPIPE|ECONNABORTED|ESTREAM)$/;
function smtpPhase(error) {
  const e = error || {};
  const code = String(e.code || '');
  const message = String(e.message || '');
  const command = String(e.command || '');
  if (CONNECT_CODES.test(code)) return 'connect';
  if (e.syscall === 'connect' || e.syscall === 'getaddrinfo' || /\b(connect|getaddrinfo|query[A-Z]*) E[A-Z]+/.test(message)) return 'connect';
  if (code === 'ETIMEDOUT' && /^(Connection timeout|Greeting never received)\b/i.test(message)) return 'connect';
  if (/before secure TLS connection was established/i.test(message)) return 'connect';
  if (e.responseCode || e.response) return 'answered';
  if (command && command !== 'CONN' && command !== 'DATA') return 'before';
  if (QUIET_CODES.test(code)) return 'unknown';
  return command === 'DATA' ? 'unknown' : 'before';
}

/* The kind the queue counts it as (lib/caregiver-store.js failureKind):
   config     the site's own setup: a refused login, missing credentials,
              our server's name not found, our sender refused. Not the
              email's fault, so not counted, and retried.
   recipient  the receiving side refused this address for good: a 5xx to
              RCPT TO (550 no such mailbox, 551, 553, 554), except 552
              (mailbox full), which may clear. Parked at once.
   unknown    see smtpPhase.
   transient  anything else: tried again later, parked after six. */
function smtpKind(error, phase) {
  const e = error || {};
  const code = String(e.code || '');
  const command = String(e.command || '');
  const rc = Number(e.responseCode) || 0;
  const message = String(e.message || '');
  if (code === 'MAIL_NOT_CONFIGURED' || code === 'EAUTH' || code === 'ENOAUTH' || /^AUTH\b/.test(command)
    || [530, 534, 535, 538].includes(rc) || /Missing credentials/i.test(message)) return 'config';
  if (phase === 'connect' && (code === 'ENOTFOUND' || /ENOTFOUND/.test(message))) return 'config';
  if (command === 'MAIL FROM' && rc >= 500) return 'config';
  if (code === 'INVALID_RECIPIENT') return 'recipient';
  if (rc >= 500 && rc < 600 && rc !== 552 && (command === 'RCPT TO' || (!command && [550, 551, 553].includes(rc)))) return 'recipient';
  if (code === 'EENVELOPE' && /Invalid recipient/i.test(message)) return 'recipient';
  if (phase === 'unknown') return 'unknown';
  return 'transient';
}

function marked(error, kind) {
  error.kind = kind;
  error.permanent = kind === 'recipient';
  error.uncertain = kind === 'unknown';
  error.config = kind === 'config';
  return error;
}

/* Two ways to send, the first that is set up wins:

   1. PFA's own mailbox, by SMTP (owner, 7 Oct 2026: "info@peopleforanimalsindia.org
      is ready on godaddy ... all submissions to go to gandhim email id. through
      info"). PFA_SMTP_USER is the mailbox (info@peopleforanimalsindia.org) and
      PFA_SMTP_PASS its password, both in Vercel only. Every email then comes
      from that address, which is what GoDaddy's servers allow and what a strict
      government inbox trusts most. GoDaddy's Professional Email is Titan; its
      help names two servers, so both are tried, GoDaddy's first, unless
      PFA_SMTP_HOST names one.
   2. Resend, by its API (PFA_MAIL_API_KEY), as before. */
function smtpConfigured() {
  return Boolean(String(process.env.PFA_SMTP_USER || '').trim() && String(process.env.PFA_SMTP_PASS || ''));
}

function isConfigured() {
  return smtpConfigured() || Boolean(process.env.PFA_MAIL_API_KEY);
}

/* Who the email is from, and through what: one answer for the mailer, the
   page's "search your mail for" line and the admin panel's check. */
function sender() {
  if (smtpConfigured()) {
    const address = String(process.env.PFA_SMTP_USER).trim().toLowerCase();
    return { via: 'smtp', from: `People for Animals <${address}>`, address, domain: address.split('@').pop() };
  }
  const from = String(FROM).trim();
  const bracketed = /<([^>]+)>/.exec(from);
  const address = (bracketed ? bracketed[1] : from).trim().toLowerCase();
  return { via: 'resend', from, address, domain: address.includes('@') ? address.split('@').pop() : '' };
}

/* The mailbox the site reads replies from (lib/inbound-mail.js). When one is
   set up, the copy of a submission sent to PFA's inbox names it as a second
   Reply-To after the person's own address: a Reply from that inbox is then
   addressed to the person, as before, and to this mailbox, where the site
   picks it up and files it on the submission. Nothing is added when no
   mailbox reads it; PFA_CAPTURE_REPLIES=off switches it off anyway. */
function captureAddress() {
  if (/^off$/i.test(String(process.env.PFA_CAPTURE_REPLIES || '').trim())) return '';
  const named = String(process.env.PFA_IMAP_USER || process.env.PFA_SMTP_USER || '').trim().toLowerCase();
  return CAREGIVER.validEmail(named) ? named : '';
}

/* Where a reply to a forwarded submission is addressed.
 *
 * Until 13 Oct 2026 it was the person who wrote in, with info@ added after
 * them: Reply went to the applicant and carried info@ as a passenger. From the
 * first reply the conversation belonged to two mailboxes the site does not
 * read, and info@ stayed in it only while every person on every message kept a
 * recipient they had not added. Owner, that evening: "if I reply to gandhim
 * without reply all.. things will go missing." They do.
 *
 * Now a reply is addressed to the site and to nothing else. The site files it
 * against the submission and sends it on to the applicant as info@
 * (lib/inbound-mail.js), so the applicant's next Reply comes back here too.
 * Every message in the conversation passes through this mailbox because there
 * is no other path; Reply All stops mattering and nobody has to remember
 * anything. It also answers the other half of the ask, which was that an
 * answer reach the applicant from info@ rather than from a personal mailbox.
 *
 * A per-application address is used when the domain has a catch-all, set as
 * PFA_REPLY_ADDRESS_PATTERN, for example
 * "app-{reference}@peopleforanimalsindia.org". It is not required: a reply is
 * matched to its submission by its In-Reply-To and References headers, with
 * the reference in the subject as a fallback, and both survive a plain Reply
 * (lib/inbound-mail.js matchThread). The pattern only adds a third way for a
 * client that strips headers and edits subjects.
 *
 * Returns '' when no mailbox is read at all, and the caller then keeps the old
 * behaviour: with nothing collecting replies, addressing them here would send
 * them nowhere. */
function gatewayAddress(reference) {
  const mailbox = captureAddress();
  if (!mailbox) return '';
  const pattern = String(process.env.PFA_REPLY_ADDRESS_PATTERN || '').trim().toLowerCase();
  const ref = String(reference == null ? '' : reference).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (pattern.includes('{reference}') && ref) {
    const made = pattern.replace('{reference}', ref);
    if (CAREGIVER.validEmail(made) && !/[\r\n,;<>]/.test(made)) return made;
  }
  return mailbox;
}

function smtpHosts() {
  const named = String(process.env.PFA_SMTP_HOST || '').trim();
  return named ? [named] : ['smtpout.secureserver.net', 'smtp.titan.email'];
}

let makeTransport = (options) => require('nodemailer').createTransport(options);

async function sendSmtp(body) {
  const port = Number(process.env.PFA_SMTP_PORT) || 465;
  /* The Message-ID and date are fixed here, not left to nodemailer, so the
     copy saved into the mailbox's Sent folder (lib/sent-copy.js) is the same
     message gandhim and the sender received. */
  const domain = (String(process.env.PFA_SMTP_USER || '').split('@')[1] || 'peopleforanimalsindia.org').trim().toLowerCase();
  const message = {
    date: new Date(),
    from: body.from,
    to: body.to.join(', '),
    cc: body.cc && body.cc.length ? body.cc.join(', ') : undefined,
    subject: body.subject,
    html: body.html,
    text: body.text,
    replyTo: body.reply_to || undefined,
    messageId: body.message_id || `<${crypto.randomUUID()}@${domain}>`,
    inReplyTo: body.in_reply_to || undefined,
    references: body.references || undefined,
    attachments: (body.attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64'), contentType: a.content_type }))
  };
  if (body.headers && Object.keys(body.headers).length) message.headers = Object.assign({}, body.headers);
  let last = null;
  let phase = '';
  for (const host of smtpHosts()) {
    const transport = makeTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: String(process.env.PFA_SMTP_USER).trim(), pass: String(process.env.PFA_SMTP_PASS).replace(/[\r\n]+$/, '') },   // no trailing line break (see lib/imap-open.js)
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    try {
      const info = await transport.sendMail(message);
      /* Sent: keep the copy for the Sent folder. Waits only for the database
         write; the mailbox is reached in the background and never holds up
         or fails this email. */
      await SENT.keep(message).catch(() => {});   // never fails the send: a throw here would try the next server and send twice
      return { providerId: (info && info.messageId) || null, messageId: message.messageId || (info && info.messageId) || null };
    } catch (error) {
      last = error;
      phase = smtpPhase(error);
      /* A wrong password or a refused message is the same on every server,
         and a message that may already have gone must not go again: only a
         server that was never reached is worth trying the next (8 Oct 2026). */
      if (phase !== 'connect') break;
    } finally {
      if (transport && typeof transport.close === 'function') transport.close();
    }
  }
  const kind = smtpKind(last, phase);
  const said = (last && last.message) || 'no answer';
  const error = new Error((kind === 'unknown'
    ? `Mailbox server stopped answering after the email was handed over (outcome not known): ${said}`
    : `Mailbox server refused: ${said}`).slice(0, 300));
  error.code = (last && last.code) || 'SMTP_FAILED';
  error.responseCode = last && last.responseCode;
  error.command = last && last.command;
  throw marked(error, kind);
}

/* The photographs and documents sent with a submission, read from beside its
   record, for the copy that goes to PFA's inbox (owner, 7 Oct 2026). That
   inbox is a government mailbox with no way into the admin panel, so an
   email that only said "1 photograph, in the admin panel" left the person
   reading it without the photograph. They are read at the moment of sending,
   not carried in the payload, because the payload sits on the outbound queue
   in Firestore and a queued email holding three photographs would be a
   document past Firestore's size limit.

   Never throws: an email without its attachments still carries everything
   written, and says the files are in the panel.

   8 Oct 2026: read with the strict reader (lib/file-store.js readStrict), so
   "Storage could not answer just now" is told apart from "there is no file".
   A passing failure is tried once more after a short pause; if it still fails
   the email goes without that file rather than waiting a day for the next
   worker run (a cruelty report's copy to the inbox must not be late), and the
   row says the files are in the panel. A relayed reply (submission_followup)
   names the files it carries by their ids (payload.attachmentIds). */
const ATTACH_MAX_BYTES = 15 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf' };

async function readFile(data) {
  const FILES = require('./file-store');
  const strict = FILES.readStrict || FILES.read;
  try {
    return await strict(data);   // the bucket, or the document for older records
  } catch (error) {
    if (error && error.code === 'FILE_MISSING') return null;
    await new Promise((resolve) => setTimeout(resolve, 400));
    try { return await strict(data); } catch (again) {
      console.warn('an attachment could not be read; sending the email without it', { message: String(again && again.message).slice(0, 160) });
      return null;
    }
  }
}

async function firestoreAttachments(reference, count, ids) {
  const { getDb } = require('./firebase');
  const db = getDb();
  const out = [];
  const names = Array.isArray(ids) && ids.length
    ? ids.slice(0, 10).map(String)
    : Array.from({ length: Math.min(Number(count) || 0, 6) }, (_, i) => String(i + 1));
  for (let i = 0; i < names.length; i += 1) {
    const snap = await db.collection('submissions').doc(reference).collection('attachments').doc(names[i]).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const bytes = await readFile(data);
    if (!bytes || !bytes.length) continue;
    out.push({ n: i + 1, label: data.label || data.filename || '', contentType: String(data.contentType || 'image/jpeg'), bytes });
  }
  return out;
}

let loadAttachments = firestoreAttachments;

async function attachmentsFor(template, payload) {
  const p = payload || {};
  /* the monthly payments report carries its month's CSV, as it was made */
  if (template === 'finance_monthly') {
    try {
      const FIN = require('./finance-report');
      const csv = /^\d{4}-\d{2}$/.test(String(p.reportMonth || '')) ? await FIN.readCsv(require('./firebase').getDb(), p.reportMonth) : null;
      return csv ? [{ filename: FIN.fileName(p.reportMonth), content: csv.toString('base64'), content_type: 'text/csv' }] : [];
    } catch (error) {
      console.warn('payments report CSV not read; sending the email without it', { month: p.reportMonth, message: error && error.message });
      return [];
    }
  }
  /* a period's report carries its CSV, as it was made when sent */
  if (template === 'finance_period') {
    try {
      const got = await require('./finance-report').readSentCsv(require('./firebase').getDb(), p.sendId);
      return got ? [{ filename: p.csvName || got.name, content: got.bytes.toString('base64'), content_type: 'text/csv' }] : [];
    } catch (error) {
      console.warn('payments report CSV not read; sending the email without it', { sendId: p.sendId, message: error && error.message });
      return [];
    }
  }
  /* a section's report carries its CSV, as it was made when sent */
  if (template === 'section_report') {
    try {
      const got = await require('./section-report').readSentCsv(require('./firebase').getDb(), p.sendId, p.kind);
      return got ? [{ filename: p.csvName || got.name, content: got.bytes.toString('base64'), content_type: 'text/csv' }] : [];
    } catch (error) {
      console.warn('section report CSV not read; sending the email without it', { sendId: p.sendId, message: error && error.message });
      return [];
    }
  }
  /* the internship certificate carries its PDF, as the panel drew it */
  if (template === 'internship_certificate') {
    try {
      const number = String(p.number || '');
      if (!/^PFA-INT-[A-HJ-NP-Z2-9]{8}$/.test(number)) return [];
      const snap = await require('./firebase').getDb().collection('certificates').doc(number).get();
      const c = snap.exists ? snap.data() || {} : {};
      const bytes = c.pdf ? await require('./file-store').read(c.pdf) : null;
      return bytes ? [{ filename: p.pdfName || `PFA-internship-certificate-${number}.pdf`, content: Buffer.from(bytes).toString('base64'), content_type: 'application/pdf' }] : [];
    } catch (error) {
      console.warn('certificate PDF not read; sending the email without it', { number: p.number, message: error && error.message });
      return [];
    }
  }
  /* the weekly quiz email carries every attempt of its week as a CSV */
  if (template === 'quiz_weekly') {
    try {
      if (!(Number(p.count) > 0)) return [];
      const QR = require('./quiz-report');
      let rows = Array.isArray(p.rows) ? p.rows : [];
      if (Number(p.more) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(p.week || ''))) rows = (await QR.build(require('./firebase').getDb(), p.week)).rows;
      return [{ filename: p.csvName || QR.fileName(p.week), content: QR.csvOf(rows).toString('base64'), content_type: 'text/csv' }];
    } catch (error) {
      console.warn('quiz CSV not made; sending the email without it', { week: p.week, message: error && error.message });
      return [];
    }
  }
  /* the monthly cruelty report carries its month's PDF, as it was made */
  if (template === 'cruelty_monthly') {
    try {
      const CR = require('./cruelty-report');
      const month = /^\d{4}-\d{2}$/.test(String(p.reportMonth || '')) ? p.reportMonth : '';
      const db = month ? require('./firebase').getDb() : null;
      /* kept when it was made; made again if it could not be kept (a month
         too large for its record with no Storage bucket) */
      const pdf = month ? (await CR.readPdf(db, month)) || (await CR.build(db, month)).pdf : null;
      return pdf ? [{ filename: CR.fileName(p.reportMonth), content: pdf.toString('base64'), content_type: 'application/pdf' }] : [];
    } catch (error) {
      console.warn('cruelty report PDF not read; sending the email without it', { month: p.reportMonth, message: error && error.message });
      return [];
    }
  }
  const relay = template === 'submission_followup' && Array.isArray(p.attachmentIds) && p.attachmentIds.length > 0;
  if (!(template === 'submission_forward' || relay) || !p.reference || !(Number(p.attachments) > 0)) return [];
  try {
    const files = await loadAttachments(p.reference, p.attachments, relay ? p.attachmentIds : null);
    const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const out = [];
    let total = 0;
    for (const f of files) {
      if (total + f.bytes.length > ATTACH_MAX_BYTES) break;
      total += f.bytes.length;
      const ext = EXT[f.contentType.toLowerCase()] || 'jpg';
      const name = `${p.reference}-${slug(f.label) || 'photo'}-${f.n}.${ext}`;
      out.push({ filename: name, content: f.bytes.toString('base64'), content_type: f.contentType });
    }
    return out;
  } catch (error) {
    console.warn('submission attachments not read; sending the email without them', { reference: p.reference, message: error && error.message });
    return [];
  }
}

/* Delivery. Any provider with a JSON API works; the shape below is Resend's,
   which several others accept unchanged. */
/* What the copies of a record carry: its kind, or a reference that starts
   with it (PFA-DON-..., PFA-CG-2026-...). The shop's packing note is always
   a record of money. */
const MONEY_TEMPLATES = new Set(['submission_forward', 'submission_followup', 'shop_order_staff', 'shipping_paid_staff']);
/* notes to PFA that are about money and nothing else */
const MONEY_NOTES = new Set(['shop_order_staff', 'shipping_paid_staff']);
/* What the payer is sent about their own payment. Their Reply goes wherever
   Reply-To says, so it is never pointed at the forms inbox. */
const MONEY_RECEIPTS = new Set(['payment_received', 'membership_welcome', 'caregiver_application_received', 'shop_order_confirmed', 'shipping_paid']);
function kindOf(payload) {
  const p = payload || {};
  return String(p.kind || (/^(PFA-[A-Z]+)-/i.exec(String(p.reference || '')) || [])[1] || '').toUpperCase();
}
function aboutMoney(template, payload) {
  if (MONEY_NOTES.has(template) || MONEY_RECEIPTS.has(template)) return true;
  /* A caregiver application is a form (owner, 23 Oct 2026: "application
     should go to gandhim"): only the copy that carries its payment is money.
     What the person writes back is about their application. */
  if (require('./submission-forward').split({ kind: kindOf(payload) })) {
    return template === 'submission_forward' && require('./submission-forward').carriesMoney(payload);
  }
  return require('./submission-forward').isPaid({ kind: kindOf(payload) });
}
/* An allow-list, not a deny-list: a copy, relay or packing note about money
   may go to the payments inboxes and nowhere else, so an address any other
   setting names (the forms inbox, an alias of it, a second person) is
   refused as well as gandhim's. */
function moneyToWrongInbox(to, template, payload) {
  if (!MONEY_TEMPLATES.has(template)) return false;
  if (!MONEY_NOTES.has(template) && !aboutMoney(template, payload)) return false;
  const address = String(to || '').trim().toLowerCase();
  return !require('./submission-forward').paymentInboxes().includes(address);
}

async function deliver({ to, template, payload }) {
  if (!isConfigured()) {
    const error = new Error('No mail is configured: neither PFA_SMTP_USER and PFA_SMTP_PASS nor PFA_MAIL_API_KEY.');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw marked(error, 'config');
  }
  if (!CAREGIVER.validEmail(to)) {
    const error = new Error('The recipient address is not valid.');
    error.code = 'INVALID_RECIPIENT';
    throw marked(error, 'recipient');
  }
  /* A record of money never reaches the forms inbox (owner, 21 Oct 2026:
     "any record of money collected on the website to only go to
     pfadcmho@gmail.com ; ozairhusain@gmail.com not gandhim"), whatever queued
     it: a copy queued before the rule and still waiting to be retried, a
     Resend pressed in the panel, a packing note. Every email passes here, so
     this is the last door. Refused as a recipient error: parked at once with
     this reason, never retried. */
  /* a payments report sent by hand goes only where money already goes:
     the payments inboxes, or the forms inbox with them in copy */
  if (template === 'finance_period' && !require('./finance-report').periodRecipients().some((x) => x.address === String(to || '').trim().toLowerCase())) {
    const error = new Error('A payments report goes only to the payments inboxes or the forms inbox.');
    error.code = 'MONEY_NOT_FOR_THIS_INBOX';
    throw marked(error, 'recipient');
  }
  /* a section's report goes only to the addresses offered for it; the
     shop's, being money, only where money goes */
  if (template === 'section_report' && !require('./section-report').allowed(String((payload || {}).kind || ''), to)) {
    const error = new Error('A section report goes only to the addresses the panel offers for it.');
    error.code = (payload || {}).kind === 'shop' ? 'MONEY_NOT_FOR_THIS_INBOX' : 'NOT_A_REPORT_INBOX';
    throw marked(error, 'recipient');
  }
  if (moneyToWrongInbox(to, template, payload)) {
    const error = new Error('A record of money is not sent to this inbox. It goes to the payments inboxes (PFA_PAYMENTS_INBOX).');
    error.code = 'MONEY_NOT_FOR_THIS_INBOX';
    throw marked(error, 'recipient');
  }

  /* A caregiver application's copy that is not the payment's carries no
     word about money, whatever was queued (the payload of an older copy, a
     Resend from the panel): stripped here, at the last door, too. */
  const FWD = require('./submission-forward');
  if (template === 'submission_forward' && FWD.split({ kind: kindOf(payload) }) && !FWD.carriesMoney(payload)) payload = FWD.withoutMoney(payload);

  const attachments = await attachmentsFor(template, payload);
  const capturedAt = captureAddress();
  const gatewayAt = gatewayAddress(payload && payload.reference);
  const shown = Object.assign({}, payload,
    attachments.length ? { attachedToEmail: attachments.length } : {},
    capturedAt ? { capturedAt } : {},
    gatewayAt ? { gatewayAt, replyFrom: sender().address || capturedAt } : {});
  const { subject, html, text, replyTo, capture, gateway, messageId, inReplyTo, references } = render(template, shown);
  const body = { from: sender().from, to: [to], subject, html, text };
  if (attachments.length) body.attachments = attachments;
  /* Copies: the monthly payments report alone is copied, and only to the
     payments inboxes (whatever its payload says), so no queued row can copy
     an email to anyone else. */
  if (template === 'finance_monthly') {
    const cc = require('./submission-forward').paymentInboxes().filter((a) => a && a !== String(to).trim().toLowerCase());
    if (cc.length) body.cc = cc;
  }
  /* a period's report to the forms inbox: the payments inboxes in copy, as the monthly one */
  if (template === 'finance_period') {
    const mine = require('./finance-report').periodRecipients().find((x) => x.address === String(to).trim().toLowerCase());
    if (mine && mine.cc.length) body.cc = mine.cc;
  }
  /* the shop's report to the forms inbox: the payments inboxes in copy */
  if (template === 'section_report') {
    const mine = require('./section-report').recipients(String((payload || {}).kind || '')).find((x) => x.address === String(to).trim().toLowerCase());
    if (mine && mine.cc.length) body.cc = mine.cc;
  }
  /* the Monday digest is copied to its fixed list (PFA_DIGEST_CC), never
     to an address a queued payload names */
  if (template === 'weekly_digest') {
    const cc = require('./weekly-digest').ccList().filter((a) => a && a !== String(to).trim().toLowerCase());
    if (cc.length) body.cc = cc;
  }
  const key = idempotencyKey(template, to, payload);
  /* A template may name its own Reply-To (a forwarded submission answers
     the person who sent it); every other email keeps the site's. A
     template that asks for its replies to be captured gets the mailbox the
     site reads as a second address, after the person's, never instead. */
  const ownReplyTo = String(replyTo || '').trim().toLowerCase();
  const replyList = [];
  /* A template that asks for the gateway is answered to the site alone, never
     to the person as well: a second address is a second path, and the path
     that skips the site is the one that loses the conversation. With no
     mailbox being read, gatewayAddress() is empty and the old behaviour
     stands, because replies have to go somewhere. */
  if (gateway && gatewayAt) {
    replyList.push(gatewayAt);
  } else {
    if (ownReplyTo && CAREGIVER.validEmail(ownReplyTo) && !/[\r\n,;<>]/.test(ownReplyTo)) replyList.push(ownReplyTo);
    /* PFA_MAIL_REPLY_TO is never where a payer's reply about money goes, if
       it names the forms inbox: with no Reply-To the reply comes to the
       site's mailbox, is filed, and is carried on to the payments inboxes */
    else if (REPLY_TO && !(aboutMoney(template, payload) && !require('./submission-forward').forPayments([REPLY_TO]).length)) replyList.push(REPLY_TO);
    if (capture && capturedAt && !replyList.includes(capturedAt)) replyList.push(capturedAt);
  }
  if (replyList.length) body.reply_to = replyList.length === 1 ? replyList[0] : replyList;
  /* The conversation's headers (lib/mail-thread.js): the id this email
     carries, and the one it answers. */
  const headers = {};
  if (messageId) { body.message_id = messageId; headers['Message-ID'] = messageId; }
  if (inReplyTo) { body.in_reply_to = inReplyTo; headers['In-Reply-To'] = inReplyTo; }
  if (references) { body.references = references; headers['References'] = references; }
  const auto = autoSubmitted(template);
  if (auto) headers['Auto-Submitted'] = auto;

  if (smtpConfigured()) {
    /* nodemailer sets the threading headers from its own fields above;
       only the others are passed as headers */
    if (auto) body.headers = { 'Auto-Submitted': auto };
    return sendSmtp(body);
  }
  /* Resend takes custom headers under `headers`; the shorthand keys above
     are not part of its API and would be refused as unknown fields. */
  delete body.message_id; delete body.in_reply_to; delete body.references;
  if (Object.keys(headers).length) body.headers = headers;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(PROVIDER_ENDPOINT, {
      method: 'POST',
      headers: Object.assign({
        Authorization: `Bearer ${process.env.PFA_MAIL_API_KEY}`,
        'Content-Type': 'application/json'
      }, key ? { 'Idempotency-Key': key } : {}),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      const error = new Error(`Mail provider returned ${response.status}: ${raw.slice(0, 200)}`);
      /* 401 and 403 are the account (a bad key, a domain not verified):
         the site's setup, not this email, so it waits uncounted until the
         account is put right. 429 is a request to slow down. Any other 4xx
         is this email refused (an address Resend will not take), and will
         never succeed on retry. 5xx is the provider's own trouble. */
      const s = response.status;
      const kind = s === 401 || s === 403 ? 'config' : s === 429 || s >= 500 ? 'transient' : s >= 400 ? 'recipient' : 'transient';
      throw marked(error, kind);
    }

    let providerId = null;
    try { providerId = JSON.parse(raw).id || null; } catch (_) { providerId = null; }
    return { providerId, messageId: messageId || null };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  TEMPLATES, deliver, firstName, formatDate, idempotencyKey, isConfigured, letter, render, shell, siteOf,
  attachmentsFor, sender, smtpConfigured, captureAddress, gatewayAddress, threadHeaders, autoSubmitted, smtpPhase, smtpKind, moneyToWrongInbox,
  _setSmtpTransport: (fn) => { makeTransport = fn || ((options) => require('nodemailer').createTransport(options)); },
  _setAttachmentLoader: (fn) => { loadAttachments = fn || firestoreAttachments; }
};
