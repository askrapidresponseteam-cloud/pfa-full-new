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
      <td valign="top" align="right" style="padding:13px 0;border-bottom:1px solid ${HAIR};font-family:${SANS};font-size:15px;line-height:1.4;font-weight:600;color:${INK}">${escapeHtml(row.value)}</td></tr>`).join('');

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

const TEMPLATES = {
  card_issued(payload) {
    return {
      subject: `Your Colony Caregiver Card is ready - ${payload.cardId}`,
      html: shell({
        heading: 'Your card is issued.',
        intro: `${firstName(payload.name) ? firstName(payload.name) + ', y' : 'Y'}our Colony Caregiver Card has been issued in your name. Keep the card number safe: it is how the card is verified.`,
        rows: [
          { label: 'Card number', value: payload.cardId },
          { label: 'Issued on', value: formatDate(payload.issuedAt) },
          { label: 'Valid until', value: formatDate(payload.validUntil) }
        ],
        cta: { label: 'Open your card', url: payload.cardUrl },
        footnote: 'This link is permanent. Save it, or download the card as a PNG from that page.'
      }),
      text: textFrom([
        `${firstName(payload.name) ? firstName(payload.name) + ', y' : 'Y'}our Colony Caregiver Card has been issued in your name.`,
        `Card number: ${payload.cardId}`,
        `Issued on: ${formatDate(payload.issuedAt)}`,
        `Valid until: ${formatDate(payload.validUntil)}`,
        `Open your card: ${payload.cardUrl}`
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
    const rows = [
      { label: 'Reference', value: p.reference },
      { label: 'Type', value: p.kindLabel },
      { label: 'Received', value: when },
      { label: 'Name', value: p.name },
      { label: 'Email', value: p.email },
      { label: 'Mobile', value: p.mobile }
    ].concat(Array.isArray(p.rows) ? p.rows : []);
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
       the records of money, or both. Volunteer applications and memberships
       reach no inbox, so they are named as staying in the admin panel. */
    const covers = p.covers === 'payments'
      ? 'every record of money (donations, gifts, shop orders and the fee paid with a caregiver application)'
      : p.covers === 'both'
        ? 'every form, and every record of money,'
        : 'every form, caregiver applications included (without their payment),';
    const intro = `This is a test from the People for Animals website. The site sends a copy of ${covers} to this address, with Reply set to the person who sent it. Volunteer applications and memberships are not emailed; they stay in the admin panel. If this arrived, those copies arrive too.`;
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
  membership_welcome(payload) {
    const K = CONFIRM.forKind('PFA-MEM');
    const amount = '\u20b9' + Number(payload.amount || 0).toLocaleString('en-IN');
    const first = firstName(payload.name);
    const site = siteOf(payload);
    const tier = String(payload.tierLabel || 'membership').toLowerCase();
    const number = payload.memberId || payload.orderId;
    const kit = Array.isArray(payload.kit) ? payload.kit.filter(Boolean) : [];
    const track = site ? `${site}/track.html#ref=${encodeURIComponent(payload.memberId || '')}` : '';
    const arrives = kit.length ? 'Your membership card and kit reach you in 20 to 25 days.' : 'Your membership card reaches you in 20 to 25 days.';
    const html = letter({
      title: 'Welcome to People for Animals',
      preheader: `Your ${tier} of People for Animals is active from today. ${K.number} ${number}.`,
      siteUrl: site,
      headline: K.headline,
      greeting: first ? `${first},` : 'Welcome,',
      lead: `your ${tier} of People for Animals is active from today. ${K.lead}`,
      rows: [
        { label: K.number, value: number, big: true },
        { label: 'Paid', value: `${amount} on ${formatDate(payload.paidAt)} \u00b7 PFA transaction ${payload.orderId}${payload.bankReference ? ` \u00b7 bank reference ${payload.bankReference}` : ''}` }
      ],
      sections: [kit.length ? { title: 'On its way to you', items: kit, note: arrives } : { note: arrives }],
      button: site ? { label: 'Find your nearest unit', url: `${site}/units.html` } : null,
      afterHtml: site ? `Follow your card${kit.length ? ' and kit' : ''} at <a href="${escapeHtml(track)}" style="color:#111111;text-decoration:underline">${escapeHtml(site.replace(/^https?:\/\//, ''))}/track.html</a> with your member number and this email address.` : '',
      fine: [
        'People for Animals is a registered trust; membership payments are eligible for exemption under Section 80G of the Income Tax Act, 1961, and this letter is your acknowledgement.',
        'Quote the member number in any message about your membership.',
        'PFA never sees your card, bank or UPI details; the payment was taken by CCAvenue.'
      ]
    });
    return {
      subject: `You're one of us now - PFA member ${number}`,
      messageId: threadHeaders(payload, 'confirm').messageId,
      html,
      text: textFrom([
        `${first ? first + ', y' : 'Y'}our ${tier} of People for Animals is active from today.`,
        `Member number: ${number}`,
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
    const fee = 'The fee confirms the application and gives it this number. It is not payment for a card: if the application is not approved, the fee is not refunded, because it pays for the reading rather than the card.';
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

const CONFIRMATION_TEMPLATES = new Set(['submission_forward', 'submission_followup', 'submission_answer', 'submission_received', 'payment_received', 'membership_welcome', 'caregiver_application_received', 'shop_order_confirmed', 'shop_order_staff']);

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
const MONEY_TEMPLATES = new Set(['submission_forward', 'submission_followup', 'shop_order_staff']);
/* What the payer is sent about their own payment. Their Reply goes wherever
   Reply-To says, so it is never pointed at the forms inbox. */
const MONEY_RECEIPTS = new Set(['payment_received', 'membership_welcome', 'caregiver_application_received', 'shop_order_confirmed', 'shipping_paid']);
function kindOf(payload) {
  const p = payload || {};
  return String(p.kind || (/^(PFA-[A-Z]+)-/i.exec(String(p.reference || '')) || [])[1] || '').toUpperCase();
}
function aboutMoney(template, payload) {
  if (template === 'shop_order_staff' || MONEY_RECEIPTS.has(template)) return true;
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
  if (template !== 'shop_order_staff' && !aboutMoney(template, payload)) return false;
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
