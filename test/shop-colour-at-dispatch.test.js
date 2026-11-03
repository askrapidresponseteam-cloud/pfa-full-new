'use strict';

/* The logo tee is no longer bought by colour (owner, 8 Oct 2026: "remove the
   colour selection option completely"). PFA chooses the colour when it packs
   the order, and the page says so in the closer look, the feature panel, the
   tile and the bag.

   This boots shop.html with its real script, as a browser would, and checks
   what a shopper meets: a bag kept from before (the tee in two colours in one
   size) becomes one line, adding the tee asks for a size only, nothing sent
   to checkout carries a colour, and the four photographs in the feature panel
   open the closer look at that colour without choosing anything. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'shop.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'assets/shop.js'), 'utf8');

function boot(savedBag) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://pfa.test/shop.html', virtualConsole });
  const w = dom.window;
  if (savedBag) w.localStorage.setItem('pfa-shop-bag', JSON.stringify(savedBag));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval(JS);
  return { w, d: w.document, errors };
}

const lines = (d) => [...d.querySelectorAll('#bagList .line')].map((row) => ({
  name: row.querySelector('.line__name').textContent,
  /* the items of the dotted run, as a reader sees them (.dots draws the dot) */
  meta: [...row.querySelectorAll('.line__meta > span')].map((x) => x.textContent).join(' · '),
  note: row.querySelector('.line__note') ? row.querySelector('.line__note').textContent : '',
  qty: Number(row.querySelector('.qty span').textContent)
}));

test('a bag kept from when the tee was bought by colour becomes one line a size, with no colour, capped at ten', () => {
  const { d, errors } = boot([
    { id: '21', colour: 'Red', size: 'L', qty: 2 },
    { id: '21', colour: 'Pink', size: 'L', qty: 9 },
    { id: '21', colour: 'White', size: 'XL', qty: 1 },
    { id: '23', size: 'XL', qty: 1 }
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(lines(d), [
    { name: 'PFA logo T-shirt', meta: 'Size L · ₹350 each', note: 'Colour chosen for you at dispatch', qty: 10 },
    { name: 'PFA logo T-shirt', meta: 'Size XL · ₹350 each', note: 'Colour chosen for you at dispatch', qty: 1 },
    { name: 'Sabyasachi x PFA', meta: 'Size XL · ₹2,500 each', note: '', qty: 1 }
  ]);
});

test('adding the tee asks for a size only, and what is kept and sent carries no colour', () => {
  const { w, d, errors } = boot(null);
  const tile = d.getElementById('pfa-logo-tee');
  assert.equal(tile.querySelector('.colours, input[name^="colour"]'), null, 'no colour on the tile');
  tile.querySelector('.sizes input[value="XL"]').checked = true;
  tile.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(d.getElementById('toastText').textContent, 'Added: PFA logo T-shirt, XL');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('pfa-shop-bag')), [{ id: '21', size: 'XL', qty: 1 }]);
  /* the feature panel adds the same line */
  d.querySelector('#featureBuy .sizes input[value="XL"]').checked = true;
  d.getElementById('featureBuy').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(JSON.parse(w.localStorage.getItem('pfa-shop-bag')), [{ id: '21', size: 'XL', qty: 2 }]);
  /* and checkout sends only piece, size and quantity */
  const co = d.getElementById('checkout');
  const fill = { name: 'Meera Shah', email: 'meera@example.com', mobile: '9876543210', address: 'Flat 4, Shanti Niwas, FC Road', city: 'Pune', pincode: '411004' };
  co.querySelectorAll('input[required]').forEach((i) => { i.value = fill[i.name] || 'x'; });
  co.querySelectorAll('select[required]').forEach((s) => { const o = d.createElement('option'); o.value = o.textContent = 'Pune'; s.appendChild(o); s.disabled = false; s.value = 'Pune'; });
  co.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(JSON.parse(d.getElementById('coItems').value), [{ id: '21', size: 'XL', qty: 2 }]);
  assert.deepEqual(errors, []);
});

test('the feature photographs open the closer look at that colour, which says how the colour is chosen', () => {
  const { w, d, errors } = boot(null);
  const pics = [...d.querySelectorAll('.feature__pics button')];
  assert.equal(pics.length, 4);
  for (const b of pics) assert.equal(b.hasAttribute('aria-pressed'), false, 'a photograph is not a choice');
  pics[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(d.getElementById('look').hidden, false);
  assert.match(d.getElementById('lookImg').src, /t-shirt-yellow-front\.webp$/);
  assert.equal(d.getElementById('lookColours'), null);
  assert.equal(d.querySelectorAll('#lookThumbs button').length, 4, 'every colour, from the front (the old back views are gone, 3 Nov 2026)');
  assert.match(d.getElementById('lookCopy').textContent, /limited palette of red, yellow, white and pink\. Each piece is hand-picked from the edition at dispatch, its colour chosen for you according to availability\./);
  const spec = [...d.querySelectorAll('#lookSpec div')].map((r) => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]);
  assert.deepEqual(spec, [['Sizes', 'L, XL'], ['Colour', 'Chosen for you at dispatch']]);
  /* a designer piece shows no such line */
  d.querySelector('#sabyasachi [data-open], [data-id="23"] [data-open]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.doesNotMatch(d.getElementById('lookSpec').textContent, /dispatch/);
  assert.deepEqual(errors, []);
});
