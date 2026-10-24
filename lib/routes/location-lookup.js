'use strict';

// GET /api/location-lookup?lat=&lng=
// Reverse-geocodes a browser position into {pincode, city, district, state, street}
// for the store checkout. Server-side so the free geocoders see one polite,
// identified caller instead of every shopper's browser. India only.
//
// GET /api/location-lookup?pin=700036
// The state, district and town of a PIN code, from India Post, for the
// address on every form (assets/address.js, 24 Oct 2026): a PIN typed in
// full fills what the person has not chosen yet.

const TIMEOUT_MS = 6000;
const UA = 'PFA-Website/1.0 (peopleforanimalsindia.org)';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function coord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function clean(v, max = 80) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function pin(v) { const m = String(v || '').match(/\b[1-9]\d{5}\b/); return m ? m[0] : ''; }

function fromBigDataCloud(d) {
  if (!d || String(d.countryCode || '').toUpperCase() !== 'IN') return null;
  const admin = Array.isArray(d.localityInfo && d.localityInfo.administrative) ? d.localityInfo.administrative : [];
  const district = admin.find((a) => a.adminLevel === 5 || /district/i.test(a.description || ''));
  return {
    pincode: pin(d.postcode),
    state: clean(d.principalSubdivision),
    district: clean(district ? district.name : d.city),
    city: clean(d.city || d.locality),
    street: ''
  };
}

function fromNominatim(d) {
  const a = d && d.address;
  if (!a || String(a.country_code || '').toUpperCase() !== 'IN') return null;
  return {
    pincode: pin(a.postcode),
    state: clean(a.state),
    district: clean(a.state_district || a.county || a.city_district).replace(/\s+district$/i, ''),
    city: clean(a.city || a.town || a.village || a.suburb || a.county),
    street: clean([a.house_number, a.road].filter(Boolean).join(' '), 120)
  };
}

async function fromPin(code) {
  const d = await fetchJson(`https://api.postalpincode.in/pincode/${encodeURIComponent(code)}`);
  const office = Array.isArray(d) && d[0] && Array.isArray(d[0].PostOffice) ? d[0].PostOffice[0] : null;
  if (!office) return null;
  /* India Post writes "NA" where a post office has no block */
  const block = /^n\.?a\.?$/i.test(clean(office.Block)) ? '' : clean(office.Block);
  return { pincode: code, state: clean(office.State), district: clean(office.District), city: block || clean(office.District), street: '' };
}

function merge(a, b) {
  const out = {};
  for (const k of ['pincode', 'state', 'district', 'city', 'street']) out[k] = (a && a[k]) || (b && b[k]) || '';
  out.district = out.district.replace(/\s+district$/i, '');
  return out;
}

async function lookup(lat, lng) {
  let result = null;
  try {
    result = fromBigDataCloud(await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`));
  } catch (_) {}
  if (!result || !result.pincode || !result.state || !result.district) {
    try {
      result = merge(result, fromNominatim(await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}&accept-language=en`)));
    } catch (_) {}
  }
  if (result && result.pincode && (!result.state || !result.district)) {
    try { result = merge(result, await fromPin(result.pincode)); } catch (_) {}
  }
  return result;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const q = request.query || {};
  if (q.pin != null) {
    const code = pin(q.pin);
    if (!code || code !== String(q.pin).trim()) return sendJson(response, 400, { code: 'BAD_PIN', message: 'A PIN code is 6 digits and does not start with 0.' });
    let place = null;
    /* India Post down or slow is not the person's mistake: the form goes on
       without the check. India Post answering that it has no such code is. */
    try { place = await fromPin(code); } catch (_) {
      return sendJson(response, 503, { code: 'UNAVAILABLE', message: 'India Post could not be asked just now.' });
    }
    if (!place || !place.state) return sendJson(response, 404, { code: 'UNKNOWN_PIN', message: 'India Post has no such PIN code. Check the six digits.' });
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    return response.end(JSON.stringify(place));
  }
  const lat = coord(q.lat, 6, 38), lng = coord(q.lng, 68, 98); // India bounding box
  if (lat == null || lng == null) {
    return sendJson(response, 400, { code: 'OUT_OF_RANGE', message: 'Location lookup works for addresses in India only.' });
  }
  let result;
  try { result = await lookup(lat, lng); } catch (_) { result = null; }
  if (result) result = merge(result, null);
  if (!result || !result.pincode || !result.state) {
    return sendJson(response, 404, { code: 'NOT_RESOLVED', message: 'We could not read a PIN code for this location. Type it in and we fill the rest.' });
  }
  return sendJson(response, 200, result);
};

module.exports._private = { fromBigDataCloud, fromNominatim, fromPin, merge, pin };
