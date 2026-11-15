/* GET /api/verify-card?id=PFA-MBR-XXXXXXXX  or  PFA-CCT-XXXXXXXX

   Answers one question for anyone holding a card - a police officer, a vet, a
   unit - is this card real, and is it still valid today.

   What it deliberately does not do is hand over the record. A card number is
   visible to anyone who is shown the card, so this route treats it as public
   and returns only what a person checking a card needs: the holder's name, what
   the card is, and whether it is in date. No address, no mobile, no email.

   Both card families are answered here so there is one number to check against,
   but they are read from their own collections and never merged. */

const { getDb } = require('../firebase');
const DC = require('../digital-cards');

const CAREGIVER_ID = /^PFA-CCT-[A-Z0-9]{8}$/;

function sendJson(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json(body);
}

function stateFor(validUntil) {
  if (!validUntil) return { status: 'unknown', valid: false };
  const until = new Date(validUntil);
  if (isNaN(until.getTime())) return { status: 'unknown', valid: false };
  const valid = until.getTime() >= Date.now();
  return { status: valid ? 'valid' : 'expired', valid, validUntil: until.toISOString() };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  const id = String((request.query && request.query.id) || '').trim().toUpperCase();

  /* a membership card online (15 Nov 2026: "All cards and certificates must
     be verifiable online"): its own address, PFA-MBR-, from digitalCards */
  if (DC.MEMBER_ID.test(id)) {
    try {
      const d = await DC.read(getDb(), id);
      if (!d) return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'No membership card carries that number.' });
      const v = DC.publicView(id, d, Date.now());
      return sendJson(response, 200, { found: true, kind: 'member', cardType: 'Membership', cardId: id, number: v.number, name: v.name, tier: v.tier,
        issuedOn: v.issuedOn, status: v.standing, valid: v.valid, validUntil: v.validUntil, lifetime: v.lifetime, url: v.url });
    } catch (error) {
      console.error('verify-card failed', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be checked. Try again.' });
    }
  }

  /* a printed membership card, by the member number on it ("KA 2399"):
     the name, the membership and whether it is in date, as for a caregiver
     card, and nothing else */
  const printed = id.replace(/\s+/g, ' ').match(/^([A-Z]{2,4}) ?(\d{1,6})$/);
  if (printed) {
    try {
      const label = `${printed[1]} ${printed[2]}`;
      const snap = await getDb().collection('memberCards').where('cardId', '==', label).limit(2).get();
      const doc = snap.docs && snap.docs[0];
      if (!doc) return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'No membership card carries that number.' });
      const c = doc.data() || {};
      const state = c.lifetime ? { status: 'valid', valid: true } : stateFor(c.validUntil);
      if (c.status && c.status !== 'active') Object.assign(state, { status: 'revoked', valid: false });
      return sendJson(response, 200, { found: true, kind: 'member', cardType: 'Membership', cardId: label, number: label, name: c.printName || c.name || '', tier: c.tierLabel || '',
        issuedOn: c.approvedAt || '', lifetime: Boolean(c.lifetime), ...state });
    } catch (error) {
      console.error('verify-card failed', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be checked. Try again.' });
    }
  }

  if (!CAREGIVER_ID.test(id)) {
    return sendJson(response, 400, {
      code: 'INVALID_ID',
      message: 'That is not a PFA card number. They look like PFA-CCT-XXXXXXXX or PFA-MBR-XXXXXXXX.'
    });
  }

  try {
    // Colony caregiver cards keep a public projection of their own, precisely so a
    // check like this never has to read the applicant record.
    const snapshot = await getDb().collection('caretakerPublic').doc(id).get();
    if (!snapshot.exists) {
      return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'No live card carries that number.' });
    }
    const card = snapshot.data() || {};
    const state = stateFor(card.validUntil);
    /* the card online, when PFA has issued it there */
    let url = '';
    try { const dig = await DC.read(getDb(), id); if (dig && dig.status === 'active') url = DC.cardUrl(id); } catch (_) { /* the check stands without it */ }
    return sendJson(response, 200, {
      found: true,
      kind: 'caregiver',
      cardType: 'Colony caregiver',
      cardId: id,
      name: card.name || '',
      issuedOn: card.issuedAt || '',
      ...(url ? { url } : {}),
      ...state
    });
  } catch (error) {
    console.error('verify-card failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be checked. Try again.' });
  }
};
