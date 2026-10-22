'use strict';

/* The district and the state of a colony caregiver application.

   They are what the back of the card prints under DISTRICT and STATE (the
   face the chairperson signed off: name, ID number, district, state, issued
   on). The application form asks for both and the payment keeps them
   (lib/payment.js, parseCaregiverApplication: metadata.district and
   metadata.state), but until v1.450 the record filed after payment
   (lib/routes/payment/response.js) kept the address, city and PIN and left
   the two out. So the drawer's preview, the card issued from it and the
   sheet printed from Issue cards all read "-" (owner, 22 Oct 2026, with Dr
   Gurmeet Mangat's card: "why no address is being printed properly").

   Records filed from v1.450 carry both. For one filed before, they are read
   back, in this order: the record itself; the payment it was filed from
   (transactions/{orderId}, by payment.orderId); and, failing both, the city
   given, when it is the name of exactly one district in the site's own list
   (assets/india-districts.js), with that district's state. */

const INDIA = require('../assets/india-districts.js');

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

/* "Udupi" -> { district: 'Udupi', state: 'Karnataka' } when exactly one
   district in India carries that name; otherwise nothing, since a guess
   between two states would print a wrong card. */
function districtNamed(name) {
  const wanted = clean(name, 80).toLowerCase();
  if (!wanted) return null;
  const hits = [];
  INDIA.STATES.forEach((state) => {
    INDIA.districtsOf(state).forEach((district) => {
      if (district.toLowerCase() === wanted) hits.push({ district, state });
    });
  });
  return hits.length === 1 ? hits[0] : null;
}

async function placeOf(db, data) {
  const f = (data && data.fields) || {};
  let district = clean(f.district, 60);
  let state = clean(f.state, 40);
  if (district && state) return { district, state };

  const orderId = clean(data && data.payment && data.payment.orderId, 80);
  if (orderId && db) {
    try {
      const snap = await db.collection('transactions').doc(orderId).get();
      const t = (snap && snap.exists && snap.data()) || {};
      const meta = t.metadata || {};
      const customer = t.customer || {};
      district = district || clean(meta.district || customer.district, 60);
      state = state || clean(meta.state || customer.state, 40);
    } catch (_) { /* the record's own city is still there to try */ }
  }

  if (!district || !state) {
    const named = districtNamed(district || f.city);
    if (named && (!state || named.state === state)) {
      district = district || named.district;
      state = state || named.state;
    }
  }
  return { district, state };
}

/* The application as the drawer and the approval should see it: its fields
   with the district and state filled in where the record lacked them. The
   record itself is not written: what was filed stays as it was filed. */
async function withPlace(db, data) {
  if (!data || data.kind !== 'PFA-CG') return data;
  const f = data.fields || {};
  if (clean(f.district, 60) && clean(f.state, 40)) return data;
  const place = await placeOf(db, data);
  if (!place.district && !place.state) return data;
  return Object.assign({}, data, { fields: Object.assign({}, f, {
    district: clean(f.district, 60) || place.district,
    state: clean(f.state, 40) || place.state
  }) });
}

/* The place of the application a card was approved from, by its reference.
   Read only: nothing here writes a submission. */
async function placeOfApplication(db, reference) {
  const ref = clean(reference, 40);
  if (!ref || !db) return { district: '', state: '' };
  const snap = await db.collection('submissions').doc(ref).get();
  if (!snap || !snap.exists) return { district: '', state: '' };
  return placeOf(db, snap.data() || {});
}

module.exports = { placeOf, withPlace, placeOfApplication, districtNamed };
