/* The PFA shop (shop.html).

   The products are the <article class="item"> elements in the page, which
   stay the one source of what is for sale: name, price, the old price if
   there is one, the photographs and the page it is listed on at
   the old site. This script adds the parts that need a script: filtering
   and sorting, a closer look at a piece, the bag, and the checkout form.

   The checkout is a plain form POST to /api/shop/checkout, because the
   browser has to end up on CCAvenue's page. It carries only which pieces,
   which sizes and how many; the server prices them from lib/shop.js, so the
   totals shown here are for reading, never for charging. The bag lives in
   this browser (localStorage) and is emptied by the confirmation page once
   the order is paid; the page works the same when storage is refused. */
(function () {
  'use strict';

  var grid = document.getElementById('grid');
  if (!grid) return;

  var SHIPPING = 150;   /* shown only; lib/shop.js SHIPPING_FLAT is what is charged */
  var MAX_QTY = 10;     /* lib/shop.js MAX_QTY: more of one piece in one size is not taken */
  var KEY = 'pfa-shop-bag';
  var items = [].slice.call(grid.querySelectorAll('.item'));
  var byId = {};
  var products = items.map(function (el) {
    var p = {
      el: el,
      id: el.getAttribute('data-id'),
      kind: el.getAttribute('data-kind'),
      order: Number(el.getAttribute('data-order')),
      name: el.getAttribute('data-name'),
      designer: el.getAttribute('data-designer'),
      price: Number(el.getAttribute('data-price')),
      was: Number(el.getAttribute('data-was')) || 0,
      images: (el.getAttribute('data-images') || '').split('|').filter(Boolean),
      /* The logo tee is made in several colours, and PFA chooses which one
         when it packs the order (owner, 8 Oct 2026): there is no colour to
         pick, and the bag says so. */
      atDispatch: el.hasAttribute('data-colour-at-dispatch')
    };
    byId[p.id] = p;
    return p;
  });

  function $(id) { return document.getElementById(id); }
  var AT_DISPATCH = 'Colour chosen for you at dispatch';
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---- a photograph that does not arrive -------------------------------
     The photographs come from peopleforanimalsindia.org until
     localise-shop.sh copies them here. If one fails, a product tile shows the
     designer's name set in type rather than a broken image, and any other
     picture simply steps aside. */
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var media = img.closest && img.closest('.item__media');
    if (media && img.classList.contains('item__img')) media.classList.add('is-bare');
    else img.style.visibility = 'hidden';
  }, true);
  [].forEach.call(document.querySelectorAll('.item__img'), function (img) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) img.closest('.item__media').classList.add('is-bare');
  });

  /* ---- filter and sort ------------------------------------------------ */
  var count = $('count'), none = $('none'), sort = $('sort');
  var filter = '';
  function arrange() {
    var how = sort ? sort.value : 'featured';
    var list = products.slice().sort(function (a, b) {
      if (how === 'low') return a.price - b.price || a.order - b.order;
      if (how === 'high') return b.price - a.price || a.order - b.order;
      if (how === 'name') return a.designer.localeCompare(b.designer) || a.order - b.order;
      return a.order - b.order;
    });
    var shown = 0;
    list.forEach(function (p) {
      grid.appendChild(p.el);
      var on = !filter || p.kind === filter;
      p.el.hidden = !on;
      if (on) shown += 1;
    });
    if (count) count.textContent = shown + (shown === 1 ? ' piece' : ' pieces');
    if (none) none.hidden = shown > 0;
  }
  [].forEach.call(document.querySelectorAll('.chip[data-filter]'), function (chip, i, all) {
    chip.addEventListener('click', function () {
      filter = chip.getAttribute('data-filter');
      [].forEach.call(all, function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      arrange();
    });
  });
  if (sort) sort.addEventListener('change', arrange);

  /* ---- the bag --------------------------------------------------------- */
  var bag = [];
  try { bag = JSON.parse(window.localStorage.getItem(KEY) || '[]') || []; } catch (err) { bag = []; }
  bag = bag.filter(function (l) { return l && byId[l.id] && (l.size === 'L' || l.size === 'XL') && l.qty > 0; });
  /* A bag kept from when the logo tee was bought by colour may hold it twice
     in one size ("Red, L" and "Pink, L"): those become one line, as the
     server would make them, and no line keeps a colour. */
  (function () {
    var one = {}, kept = [];
    bag.forEach(function (l) {
      var k = l.id + ':' + l.size;
      if (one[k]) { one[k].qty = Math.min(one[k].qty + l.qty, MAX_QTY); return; }
      one[k] = { id: l.id, size: l.size, qty: Math.min(l.qty, MAX_QTY) };
      kept.push(one[k]);
    });
    bag = kept;
  }());
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(bag)); } catch (err) { /* this visit only */ }
  }
  function total() { return bag.reduce(function (s, l) { return s + byId[l.id].price * l.qty; }, 0); }
  function pieces() { return bag.reduce(function (s, l) { return s + l.qty; }, 0); }

  var bagBtn = $('bagBtn'), bagCount = $('bagCount'), bagEl = $('bag'), bagList = $('bagList');
  var scrim = $('scrim'), bagView = $('bagView'), checkout = $('checkout'), toCheckout = $('toCheckout');

  /* Pieces, delivery and total, as a definition list. */
  function summary(dl) {
    if (!dl) return;
    dl.textContent = '';
    var sub = total();
    [['Pieces (' + pieces() + ')', rupees(sub)], ['Delivery', bag.length ? rupees(SHIPPING) : rupees(0)], ['Total', rupees(bag.length ? sub + SHIPPING : 0)]].forEach(function (r) {
      var d = el('div');
      d.appendChild(el('dt', null, r[0]));
      d.appendChild(el('dd', null, r[1]));
      dl.appendChild(d);
    });
  }

  function renderBag() {
    var n = pieces();
    bagCount.textContent = n;
    bagBtn.hidden = n === 0 && !bagEl.classList.contains('is-in');
    bagBtn.setAttribute('aria-label', 'Bag, ' + n + (n === 1 ? ' piece' : ' pieces'));
    bagList.textContent = '';
    if (!bag.length) {
      bagList.appendChild(el('p', 'bag__empty', 'Your bag is empty. Choose a size on any piece and add it here.'));
    }
    bag.forEach(function (l, i) {
      var p = byId[l.id];
      var row = el('div', 'line');
      var pic = el('span', 'line__pic');
      var src = p.images[0];
      if (src) { var im = el('img'); im.src = src; im.alt = ''; pic.appendChild(im); }
      var mid = el('div');
      mid.appendChild(el('p', 'line__name', p.name));
      var meta = el('p', 'line__meta dots');
      meta.appendChild(el('span', '', 'Size ' + l.size));
      meta.appendChild(el('span', '', rupees(p.price) + ' each'));
      mid.appendChild(meta);
      if (p.atDispatch) mid.appendChild(el('p', 'line__note', AT_DISPATCH));
      var q = el('div', 'qty');
      /* drawn by shop.html's styles, so each sits in the middle of its box */
      var minus = el('button', 'qty__less', ''); minus.type = 'button'; minus.setAttribute('aria-label', 'One fewer');
      var plus = el('button', 'qty__more', ''); plus.type = 'button'; plus.setAttribute('aria-label', 'One more');
      q.appendChild(minus); q.appendChild(el('span', null, String(l.qty))); q.appendChild(plus);
      mid.appendChild(q);
      var end = el('div', 'line__end');
      end.appendChild(el('span', null, rupees(p.price * l.qty)));
      var rm = el('button', 'line__rm', 'Remove'); rm.type = 'button';
      end.appendChild(rm);
      row.appendChild(pic); row.appendChild(mid); row.appendChild(end);
      minus.addEventListener('click', function () { change(i, -1); });
      plus.addEventListener('click', function () { change(i, 1); });
      rm.addEventListener('click', function () { change(i, -l.qty); });
      bagList.appendChild(row);
    });
    summary($('bagSum'));
    summary($('coSum'));
    toCheckout.disabled = !bag.length;
    $('coPay').textContent = bag.length ? 'Pay ' + rupees(total() + SHIPPING) + ' securely' : 'Pay securely';
    if (!bag.length && !checkout.hidden) showBag();
  }
  function change(i, by) {
    bag[i].qty += by;
    if (bag[i].qty <= 0) bag.splice(i, 1);
    save();
    renderBag();
  }

  var toast = $('toast'), toastText = $('toastText'), toastTimer = 0;
  function add(id, size) {
    var p = byId[id];
    if (!p) return;
    var found = null;
    bag.forEach(function (l) { if (l.id === id && l.size === size) found = l; });
    if (found) found.qty += 1;
    else bag.push({ id: id, size: size, qty: 1 });
    save();
    renderBag();
    bagBtn.classList.add('is-bump');
    window.setTimeout(function () { bagBtn.classList.remove('is-bump'); }, 260);
    toastText.textContent = 'Added: ' + p.name + ', ' + size;
    toast.classList.add('is-in');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove('is-in'); }, 3200);
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.hasAttribute || !form.hasAttribute('data-buy')) return;
    e.preventDefault();
    var id = form.getAttribute('data-for') || (form.closest('.item') && form.closest('.item').getAttribute('data-id'));
    var picked = form.querySelector('.sizes input:checked');
    add(id, picked ? picked.value : 'L');
    var btn = form.querySelector('.item__add');
    if (btn) {
      btn.classList.add('is-done');
      btn.textContent = 'Added';
      window.setTimeout(function () { btn.classList.remove('is-done'); btn.textContent = 'Add to bag'; }, 1400);
    }
  });

  /* ---- checkout --------------------------------------------------------
     The bag's second view: who is buying and where it goes. Validated by the
     same rules the server applies (assets/field-rules.js on both sides), then
     sent as an ordinary form POST so the browser can be handed to CCAvenue. */
  function showBag() {
    checkout.hidden = true;
    bagView.hidden = false;
    $('bagTitle').textContent = 'Your bag';
  }
  function showCheckout() {
    if (!bag.length) return;
    bagView.hidden = true;
    checkout.hidden = false;
    $('bagTitle').textContent = 'Checkout';
    var first = $('coName');
    if (first) first.focus({ preventScroll: true });
  }
  toCheckout.addEventListener('click', showCheckout);
  $('backToBag').addEventListener('click', showBag);

  var stateSel = $('coState'), districtSel = $('coDistrict');
  function fillStates() {
    if (!window.PFA_INDIA || stateSel.options.length > 1) return;
    (window.PFA_INDIA.STATES || []).forEach(function (st) { var o = el('option', null, st); o.value = st; stateSel.appendChild(o); });
  }
  stateSel.addEventListener('change', function () {
    var list = stateSel.value && window.PFA_INDIA ? window.PFA_INDIA.districtsOf(stateSel.value) : [];
    districtSel.textContent = '';
    var none = el('option', null, list.length ? 'Select' : 'Select the state first'); none.value = '';
    districtSel.appendChild(none);
    list.forEach(function (d) { var o = el('option', null, d); o.value = d; districtSel.appendChild(o); });
    districtSel.disabled = !list.length;
  });
  if (window.PFA_INDIA) fillStates(); else window.addEventListener('load', fillStates);

  var RULES = window.PFA_RULES || null;
  function fieldBad(input) {
    var v = String(input.value || '').trim();
    if (!v) return true;
    if (RULES && typeof RULES.checkField === 'function') return Boolean(RULES.checkField(input.name, v, { required: true }));
    if (input.name === 'mobile') return !/^[6-9]\d{9}$/.test(v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''));
    if (input.name === 'email') return !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    if (input.name === 'pincode') return !/^[1-9]\d{5}$/.test(v.replace(/\s/g, ''));
    return false;
  }
  checkout.addEventListener('input', function (e) {
    var f = e.target.closest && e.target.closest('.field');
    if (f) f.classList.remove('is-bad');
  });
  checkout.addEventListener('submit', function (e) {
    var bad = [].filter.call(checkout.querySelectorAll('input[required], select[required]'), fieldBad);
    bad.forEach(function (input) { var f = input.closest('.field'); if (f) f.classList.add('is-bad'); });
    if (bad.length || !bag.length) {
      e.preventDefault();
      if (bad.length) bad[0].focus();
      return;
    }
    $('coItems').value = JSON.stringify(bag.map(function (l) {
      return { id: l.id, size: l.size, qty: l.qty };
    }));
    var pay = $('coPay');
    pay.disabled = true;
    pay.textContent = 'Opening secure payment';
    /* Coming back with the Back button finds the button usable again. */
    window.addEventListener('pageshow', function again() {
      pay.disabled = false;
      renderBag();
      window.removeEventListener('pageshow', again);
    });
  });

  /* ---- the layers ----------------------------------------------------- */
  var look = $('look'), open = null, lastFocus = null;
  function show(layer) {
    if (open) hide(true);
    lastFocus = document.activeElement;
    open = layer;
    scrim.hidden = false;
    layer.hidden = false;
    document.body.classList.add('is-held');
    window.requestAnimationFrame(function () {
      scrim.classList.add('is-in');
      layer.classList.add('is-in');
    });
    var x = layer.querySelector('[data-close]');
    if (x) x.focus({ preventScroll: true });
    if (layer === bagEl) { bagBtn.setAttribute('aria-expanded', 'true'); toast.classList.remove('is-in'); }
  }
  function hide(swap) {
    if (!open) return;
    var layer = open;
    open = null;
    layer.classList.remove('is-in');
    if (layer === bagEl) bagBtn.setAttribute('aria-expanded', 'false');
    if (!swap) scrim.classList.remove('is-in');
    window.setTimeout(function () {
      if (open !== layer) layer.hidden = true;
      if (!open) { scrim.hidden = true; document.body.classList.remove('is-held'); renderBag(); }
    }, 320);
    if (!swap && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  scrim.addEventListener('click', function () { hide(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) hide();
    if (e.key === 'Tab' && open) {
      var f = [].filter.call(open.querySelectorAll('a[href],button:not([disabled]),input,select'), function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      var here = f.filter(function (n) { return n.checked || n.type !== 'radio'; });
      if (here.length) { first = here[0]; last = here[here.length - 1]; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  [].forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', function () { hide(); }); });
  bagBtn.addEventListener('click', function () { show(bagEl); });
  $('toastBag').addEventListener('click', function () { show(bagEl); });

  /* A closer look at one piece: every photograph, the details, and the
     same size and bag control as the tile. */
  var lookImg = $('lookImg'), lookThumbs = $('lookThumbs');
  function lookAt(p, startAt) {
    $('lookKicker').textContent = p.kind === 'designer' ? 'Designer edit · limited edition' : 'Everyday';
    $('lookTitle').textContent = p.name;
    var price = $('lookPrice');
    price.textContent = '';
    price.appendChild(el('b', null, rupees(p.price)));
    if (p.was) {
      price.appendChild(el('s', null, rupees(p.was)));
      price.appendChild(el('span', 'item__off', Math.round(100 - p.price * 100 / p.was) + '% off'));
    }
    $('lookCopy').textContent = p.kind === 'designer'
      ? 'A limited-edition T-shirt by ' + p.designer + ', made with People for Animals. It carries the designer’s own artistry on a contemporary silhouette, in premium organic cotton, and every purchase supports PFA’s work to protect and care for vulnerable animals across the country.'
      : 'The People for Animals logo T-shirt, made in a limited palette of red, yellow, white and pink. Each piece is hand-picked from the edition at dispatch, its colour chosen for you according to availability.';
    var spec = $('lookSpec');
    spec.textContent = '';
    var rows = p.kind === 'designer'
      ? [['Designer', p.designer], ['Fit', 'Unisex drop shoulder'], ['Fabric', '100% cotton'], ['Sizes', 'L, XL']]
      : [['Sizes', 'L, XL']];
    if (p.atDispatch) rows.push(['Colour', 'Chosen for you at dispatch']);
    if (/charcoal/i.test(p.name)) rows.splice(3, 0, ['Colour', 'Charcoal']);
    rows.forEach(function (r) {
      var d = el('div');
      d.appendChild(el('dt', null, r[0]));
      d.appendChild(el('dd', null, r[1]));
      spec.appendChild(d);
    });
    $('lookBuy').setAttribute('data-for', p.id);
    var first = $('lookBuy').querySelector('.sizes input[value="L"]');
    if (first) first.checked = true;
    gallery(p, p.images, Math.max(0, p.images.indexOf(startAt || '')));
    show(look);
  }
  function gallery(p, images, start) {
    var name = p.name;
    lookThumbs.textContent = '';
    function pick(i) {
      lookImg.style.visibility = '';
      lookImg.src = images[i];
      lookImg.alt = name + (i ? ', photograph ' + (i + 1) : '');
      [].forEach.call(lookThumbs.children, function (t, k) { t.setAttribute('aria-current', String(k === i)); });
    }
    if (images.length > 1) {
      images.forEach(function (src, i) {
        var t = el('button');
        t.type = 'button';
        t.setAttribute('aria-label', 'Photograph ' + (i + 1));
        var im = el('img'); im.src = src; im.alt = ''; im.loading = 'lazy';
        t.appendChild(im);
        t.addEventListener('click', function () { pick(i); });
        lookThumbs.appendChild(t);
      });
    }
    lookThumbs.hidden = images.length < 2;
    pick(start || 0);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-open], [data-open-id]');
    if (!t) return;
    var id = t.getAttribute('data-open-id') || (t.closest('.item') && t.closest('.item').getAttribute('data-id'));
    if (!byId[id]) return;
    e.preventDefault();
    lookAt(byId[id], t.getAttribute('data-start'));
  });

  bagBtn.hidden = false;
  arrange();
  renderBag();
  if (!pieces()) bagBtn.hidden = true;
  /* Sent back from a payment that did not complete, or from a checkout
     error: the bag opens where the shopper left it. */
  if (location.hash === '#bag' && pieces()) show(bagEl);
})();
