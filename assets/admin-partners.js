/* The panel's Partners in giving (owner, 27 Nov 2026: "what is the best way
   to share the donors givings. it has to look amazing and stand out";
   "The amount can be shown or hidden using a toggle in the admin panel").

   One partnership is a donor's gift to one place: the donor (name, a line
   about them, the people who lead them, their logo and website), the gift
   (a headline, what it is, where it works, the day it arrived, its story,
   the thanks), the amount with its Show on the site switch, the
   photographs (the first opens the page), and the timeline that keeps
   growing week by week, each line with the animals it helped. Every
   timeline line and the partnership itself can be turned into a picture
   for Instagram here, in the page's own look.

   Read from and saved through /api/admin/partners (lib/routes/admin/
   partners.js). Photographs go straight from this browser to Storage, as
   the Updates section's do (lib/update-media.js). It uses that section's
   form styles (assets/admin-updates.js). admin.html calls PFAPartners.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var URL_ = '/api/admin/partners';
  var SITE_PAGE = 'partners.html';
  var PFA_LOGO = 'img/logo.png';

  var style = document.createElement('style');
  style.textContent = [
    '.pp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px 18px}',
    '.pp-sec{display:grid;gap:16px;padding:18px;border:1px solid var(--line)}',
    '.pp-sec>h3{margin:0;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink)}',
    '.pp-switch{display:flex;align-items:flex-start;gap:12px;cursor:pointer;font-size:14px;line-height:1.45}',
    '.pp-switch input{position:absolute;opacity:0;width:1px;height:1px}',
    '.pp-switch i{flex:none;position:relative;width:46px;height:26px;border-radius:13px;background:#c9c9c9;transition:background .2s;margin-top:-2px}',
    '.pp-switch i::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}',
    '.pp-switch input:checked+i{background:var(--ink)}',
    '.pp-switch input:checked+i::after{transform:translateX(20px)}',
    '.pp-switch input:focus-visible+i{outline:2px solid var(--ink);outline-offset:2px}',
    '.pp-photos{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:12px}',
    '.pp-photos li{display:grid;gap:8px;padding:10px;border:1px solid var(--line);min-width:0}',
    '.pp-photos img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#eee}',
    '.pp-photos .ux-acts{justify-content:flex-start}',
    '.pp-first{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.pp-entries{display:grid;gap:12px}',
    '.pp-entry{display:grid;gap:12px;padding:14px;border:1px solid var(--line)}',
    '.pp-entry .pp-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}',
    '.pp-entry img{display:block;max-width:220px;max-height:150px;object-fit:cover}',
    '.ux-f input[type=date],.ux-f input[type=number],.ux-f select{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:14px;color:var(--ink);border-radius:0}',
    '.pp-logo img{display:block;max-width:200px;max-height:110px;object-fit:contain}'
  ].join('');
  document.head.appendChild(style);

  var S = { list: [], edit: null, busy: false, currencies: ['INR', 'USD'] };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function node() { return $('[data-pane="partners"]'); }
  function api(body) { return A.api(URL_, body ? { method: 'POST', body: body } : undefined); }
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function today() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  function fail(e) { var n = node(); if (n) A.fail(n, e); }
  function err(t) { var el = document.getElementById('ppErr'); if (el) el.textContent = t || ''; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function whose(name) { return /s$/i.test(String(name)) ? name + '\u2019' : name + '\u2019s'; }

  function pane() {
    var n = node();
    if (!n) return;
    n.innerHTML = '<div class="loading">Reading the partnerships…</div>';
    api().then(function (d) { S.list = d.partners || []; S.currencies = d.currencies || S.currencies; S.edit = null; paintList(); }).catch(fail);
  }

  function paintList(note) {
    var n = node();
    if (!n) return;
    var out = ['<div class="ux-top"><p class="ux-hint" style="max-width:64ch">Each partnership is a donor’s gift on its own page, <a href="' + SITE_PAGE + '" target="_blank" rel="noopener">Partners in giving</a>: their photograph and logo, the gift, the thanks, and a timeline you add to every week with what the gift has done.</p>'
      + '<button class="press" type="button" data-pp="new">New partnership</button></div>'];
    if (note) out.push('<p class="ux-hint" role="status" style="margin:0 0 12px;color:var(--ink)">' + esc(note) + '</p>');
    if (!S.list.length) out.push('<div class="empty"><b>No partnerships yet</b>Press New partnership to add the first donor.</div>');
    else {
      out.push('<div class="ux-list">');
      S.list.forEach(function (p) {
        var helped = (p.timeline || []).reduce(function (k, e) { return k + (Number(e.count) || 0); }, 0);
        out.push('<div class="ux-row"><div><b>' + esc(p.donor) + ': ' + esc(p.headline) + '</b><small>'
          + '<span class="flag" data-s="' + esc(p.status) + '">' + (p.status === 'published' ? 'On the site' : 'Draft') + '</span>'
          + '<span>' + esc(p.place || p.unit || '') + '</span>'
          + '<span>' + (p.showAmount && p.amount ? 'Amount shown' : 'Amount not shown') + '</span>'
          + '<span>' + (p.timeline || []).length + ' on the timeline</span>'
          + (helped ? '<span>' + helped + ' ' + esc(p.countLabel || 'animals helped') + '</span>' : '')
          + '</small></div><div class="ux-acts">'
          + '<button class="ghost" type="button" data-pp="edit" data-id="' + esc(p.id) + '">Edit</button>'
          + '<a class="ghost" style="display:inline-flex;align-items:center;height:34px;padding:0 12px" href="' + SITE_PAGE + '#' + esc(p.id) + '" target="_blank" rel="noopener">See it</a>'
          + '<button class="ghost danger" type="button" data-pp="remove" data-id="' + esc(p.id) + '">Take off the site</button></div></div>');
      });
      out.push('</div>');
    }
    n.innerHTML = out.join('');
  }

  function blank() {
    return { id: '', status: 'published', order: S.list.length + 1, donor: '', donorLine: '', link: '', logo: '', people: [], unit: '', place: '', headline: '', gift: '', giftName: '', story: '', thanks: '', amount: '', currency: 'INR', showAmount: false, givenOn: today(), countLabel: 'animals helped', photos: [], timeline: [] };
  }
  function startEdit(p) { S.edit = p ? copy(Object.assign(blank(), p)) : blank(); paintForm(); }

  function input(id, label, value, opts) {
    var o = opts || {};
    return '<label class="ux-f"><span>' + esc(label) + '</span><input type="' + (o.type || 'text') + '" id="' + id + '" value="' + esc(value) + '"'
      + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.min != null ? ' min="' + o.min + '"' : '') + '>'
      + (o.hint ? '<span class="ux-hint" style="text-transform:none;letter-spacing:0">' + esc(o.hint) + '</span>' : '') + '</label>';
  }
  function area(id, label, value, ph) {
    return '<label class="ux-f"><span>' + esc(label) + '</span><textarea id="' + id + '" maxlength="1200" placeholder="' + esc(ph || '') + '">' + esc(value) + '</textarea></label>';
  }

  function paintForm(error) {
    var n = node(), e = S.edit;
    if (!n || !e) return;
    var out = ['<div class="ux-form" style="max-width:900px">', '<div><button class="ghost" type="button" data-pp="back">Back to the partnerships</button></div>'];
    out.push('<section class="pp-sec"><h3>The donor</h3><div class="pp-grid">'
      + input('ppDonor', 'Name', e.donor, { max: 80, ph: 'Rosie’s Heroes' })
      + input('ppLink', 'Their website', e.link, { type: 'url', ph: 'https://' }) + '</div>'
      + input('ppDonorLine', 'A line about them', e.donorLine, { max: 160, ph: 'A volunteer-run charity in California…' })
      + '<label class="ux-f"><span>The people to thank, one a line: name, then role</span><textarea id="ppPeople" placeholder="Priyanka Rao, President">' + esc((e.people || []).join('\n')) + '</textarea></label>'
      + '<div class="ux-f pp-logo"><span>Their logo</span>' + (e.logo ? '<img src="' + esc(e.logo) + '" alt="">' : '<p class="ux-hint">No logo yet: their name is written in its place.</p>')
      + '<div class="ux-file"><input type="file" id="ppLogoFile" accept="image/png,image/webp,image/jpeg">' + (e.logo ? '<button class="ghost danger" type="button" data-pp="nologo">Remove the logo</button>' : '') + '</div>'
      + '<div class="ux-bar" id="ppLogoBar" hidden><i></i></div><p class="ux-hint">A logo on a clear background looks best (PNG or WebP).</p></div></section>');
    out.push('<section class="pp-sec"><h3>The gift</h3>'
      + input('ppHeadline', 'Headline across the photograph', e.headline, { max: 100, ph: 'Hope on wheels for the animals of Khamgaon' })
      + '<div class="pp-grid">' + input('ppGift', 'What was given', e.gift, { max: 160, ph: 'An electric animal rescue ambulance' })
      + input('ppGiftName', 'Its name, if it has one', e.giftName, { max: 80, ph: 'Twix’s Hope on Wheels' })
      + input('ppPlace', 'Where it works', e.place, { max: 80, ph: 'Khamgaon, Maharashtra' })
      + input('ppUnit', 'The PFA unit', e.unit, { max: 80, ph: 'PFA Khamgaon' })
      + input('ppGivenOn', 'The day it arrived', e.givenOn, { type: 'date' })
      + input('ppCountLabel', 'What the timeline counts', e.countLabel, { max: 60, ph: 'animals carried to care' }) + '</div>'
      + area('ppStory', 'Its story', e.story, 'What was given, by whom, and what it does')
      + area('ppThanks', 'The thanks, shown large', e.thanks, 'Thank you, …') + '</section>');
    var cur = (S.currencies || ['INR', 'USD']).map(function (c) { return '<option value="' + esc(c) + '"' + (c === e.currency ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    out.push('<section class="pp-sec"><h3>The amount</h3><div class="pp-grid">'
      + input('ppAmount', 'Amount given', e.amount, { mode: 'decimal', max: 14, ph: '2664.92' })
      + '<label class="ux-f"><span>Currency</span><select id="ppCurrency">' + cur + '</select></label></div>'
      + '<label class="pp-switch"><input type="checkbox" id="ppShowAmount"' + (e.showAmount ? ' checked' : '') + '><i aria-hidden="true"></i><span><b>Show the amount on the site</b><br><span class="ux-hint">When this is off, the page shows the gift without any amount, and nothing on it says an amount is left out.</span></span></label></section>');
    out.push('<section class="pp-sec"><h3>Photographs</h3><p class="ux-hint">The first opens the page, behind the headline. The rest show under the story.</p>'
      + (e.photos.length ? '<ul class="pp-photos">' + e.photos.map(function (ph, i) {
        return '<li><img src="' + esc(ph.src) + '" alt="">' + (i === 0 ? '<span class="pp-first">Opens the page</span>' : '')
          + '<label class="ux-f"><span>What it shows</span><textarea class="ux-grow" rows="2" data-alt="' + i + '" maxlength="160" style="min-height:64px">' + esc(ph.alt) + '</textarea></label>'
          + '<div class="ux-acts">' + (i ? '<button class="ghost" type="button" data-pp="first" data-i="' + i + '">Open the page with it</button>' : '')
          + '<button class="ghost" type="button" data-pp="card" data-i="' + i + '">Instagram picture</button>'
          + '<button class="ghost danger" type="button" data-pp="nophoto" data-i="' + i + '">Remove</button></div></li>';
      }).join('') + '</ul>' : '<p class="ux-hint">No photograph yet.</p>')
      + '<div class="ux-file"><input type="file" id="ppPhotoFile" accept="image/jpeg,image/png,image/webp" multiple></div><div class="ux-bar" id="ppPhotoBar" hidden><i></i></div></section>');
    var helped = e.timeline.reduce(function (k, x) { return k + (Number(x.count) || 0); }, 0);
    out.push('<section class="pp-sec"><h3>The timeline</h3><p class="ux-hint">Add a line every week with what the gift has done. The animals you count here add up to the number at the top of the page' + (helped ? ' (now ' + helped + ')' : ', shown once there is one') + '. A day still to come shows as Coming up.</p>'
      + '<div class="pp-entries">' + e.timeline.map(function (x, i) {
        return '<div class="pp-entry"><div class="pp-grid">'
          + '<label class="ux-f"><span>Day</span><input type="date" data-t="date" data-i="' + i + '" value="' + esc(x.date) + '"></label>'
          + '<label class="ux-f"><span>Animals it helped</span><input type="number" min="0" data-t="count" data-i="' + i + '" value="' + esc(x.count || 0) + '"></label></div>'
          + '<label class="ux-f"><span>What happened</span><input type="text" maxlength="80" data-t="title" data-i="' + i + '" value="' + esc(x.title) + '"></label>'
          + '<label class="ux-f"><span>A few lines</span><textarea data-t="text" data-i="' + i + '" maxlength="600">' + esc(x.text) + '</textarea></label>'
          + (x.photo ? '<img src="' + esc(x.photo) + '" alt="">' : '')
          + '<div class="ux-acts" style="justify-content:flex-start">'
          + '<label class="ghost" style="display:inline-flex;align-items:center;height:34px;padding:0 12px;cursor:pointer">' + (x.photo ? 'Change the photograph' : 'Add a photograph') + '<input type="file" accept="image/jpeg,image/png,image/webp" data-tphoto="' + i + '" hidden></label>'
          + (x.photo ? '<button class="ghost" type="button" data-pp="tnophoto" data-i="' + i + '">Remove the photograph</button>' : '')
          + '<button class="ghost" type="button" data-pp="tcard" data-i="' + i + '">Instagram picture</button>'
          + '<button class="ghost danger" type="button" data-pp="tremove" data-i="' + i + '">Remove this line</button></div>'
          + '<div class="ux-bar" id="ppTBar' + i + '" hidden><i></i></div></div>';
      }).join('') + '</div><div><button class="ghost" type="button" data-pp="tadd">Add to the timeline</button></div></section>');
    out.push('<div class="ux-foot"><button class="press" type="button" data-pp="save">' + (e.id && e.status === 'published' ? 'Save' : 'Put on the site') + '</button>'
      + '<button class="ghost" type="button" data-pp="draft">Save as a draft</button>'
      + '<button class="ghost" type="button" data-pp="back">Cancel</button><p class="ux-err" role="alert" id="ppErr">' + esc(error || '') + '</p></div>');
    out.push('</div>');
    n.innerHTML = out.join('');
  }

  /* what the form says now, kept in S.edit so a redraw loses nothing */
  function read() {
    var e = S.edit;
    if (!e) return e;
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    e.donor = v('ppDonor'); e.link = v('ppLink').trim(); e.donorLine = v('ppDonorLine');
    e.people = v('ppPeople').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    e.headline = v('ppHeadline'); e.gift = v('ppGift'); e.giftName = v('ppGiftName'); e.place = v('ppPlace'); e.unit = v('ppUnit');
    e.givenOn = v('ppGivenOn'); e.countLabel = v('ppCountLabel'); e.story = v('ppStory'); e.thanks = v('ppThanks');
    e.amount = v('ppAmount').replace(/[,\s]/g, ''); e.currency = v('ppCurrency') || e.currency;
    var sw = document.getElementById('ppShowAmount'); if (sw) e.showAmount = sw.checked;
    [].forEach.call(node().querySelectorAll('[data-alt]'), function (el) { var p = e.photos[+el.getAttribute('data-alt')]; if (p) p.alt = el.value; });
    [].forEach.call(node().querySelectorAll('[data-t]'), function (el) {
      var x = e.timeline[+el.getAttribute('data-i')]; if (!x) return;
      var k = el.getAttribute('data-t'); x[k] = k === 'count' ? Math.max(0, Math.floor(Number(el.value) || 0)) : el.value;
    });
    return e;
  }

  /* a picture is made at most 1600 pixels wide before it goes */
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, 1600 / Math.max(w, 1));
        if (s >= 1 && file.size < 900 * 1024) { URL.revokeObjectURL(url); return resolve(file); }
        var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var keep = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        c.toBlob(function (b) { resolve(b ? new File([b], keep === 'image/png' ? 'picture.png' : 'picture.jpg', { type: keep }) : file); }, keep, 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  function upload(file, bar) {
    S.busy = true;
    var b = document.getElementById(bar);
    if (b) { b.hidden = false; b.firstChild.style.width = '0'; }
    var done = function (e) { S.busy = false; if (b) b.hidden = true; if (e) throw e; };
    return shrink(file).then(function (f) {
      return api({ action: 'upload', kind: 'photo', type: f.type, size: f.size, origin: location.origin }).then(function (r) {
        return new Promise(function (resolve, reject) {
          var x = new XMLHttpRequest();
          x.open('PUT', r.upload);
          x.upload.onprogress = function (ev) { if (ev.lengthComputable && b) b.firstChild.style.width = Math.round(ev.loaded / ev.total * 100) + '%'; };
          x.onload = function () { x.status >= 200 && x.status < 300 ? resolve(r.path) : reject(new Error('The upload stopped. Try again.')); };
          x.onerror = function () { reject(new Error('The upload stopped. Check the connection and try again.')); };
          x.send(f);
        });
      });
    }).then(function (path) { return api({ action: 'uploaded', path: path }); })
      .then(function (r) { done(); return r.url; }, function (e) { done(e); });
  }

  function save(status) {
    if (S.busy) { err('Wait for the upload to finish.'); return; }
    var e = read();
    if (!e.photos.length) { err('Add at least one photograph: it opens the page.'); return; }
    var body = copy(e); body.action = 'save'; body.status = status;
    S.busy = true;
    api(body).then(function (r) {
      S.busy = false;
      return api().then(function (d) {
        S.list = d.partners || []; S.edit = null;
        paintList(r.status === 'draft' ? 'Saved as a draft. It is not on the site.' : 'On the site. Visitors see it within two minutes.');
      });
    }).catch(function (x) { S.busy = false; err(x && x.message); });
  }

  /* ---- a picture for Instagram, in the page's own look ----
     1080 by 1350: the photograph above, and under it the two names, the
     line and the day, ready to post from the PFA account. */
  var fontReady = null;
  function font() {
    if (fontReady) return fontReady;
    fontReady = (window.FontFace ? new FontFace('Marcellus', 'url(fonts/marcellus-latin.woff2)').load().then(function (f) { document.fonts.add(f); }) : Promise.resolve()).catch(function () { /* Georgia then */ });
    return fontReady;
  }
  function imageOf(src) {
    var load = function (url) {
      return new Promise(function (resolve, reject) { var im = new Image(); im.onload = function () { resolve(im); }; im.onerror = function () { reject(new Error('A picture could not be read.')); }; im.src = url; });
    };
    if (!src) return Promise.resolve(null);
    if (/^https:\/\/firebasestorage\.googleapis\.com\//.test(src)) return api({ action: 'picture', url: src }).then(function (r) { return load(r.data); });
    return load(src);
  }
  function wrap(ctx, words, max) {
    var lines = [], line = '';
    String(words).split(/\s+/).forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }
  function card(e, photo, title, line, when) {
    err('');
    return Promise.all([font(), imageOf(photo), imageOf(PFA_LOGO), imageOf(e.logo)]).then(function (got) {
      var pic = got[1], pfa = got[2], donor = got[3];
      var W = 1080, H = 1350, PH = 820, pad = 70;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
      if (pic) {
        var s = Math.max(W / pic.naturalWidth, PH / pic.naturalHeight);
        var dw = pic.naturalWidth * s, dh = pic.naturalHeight * s;
        x.drawImage(pic, (W - dw) / 2, (PH - dh) / 2, dw, dh);
      }
      var g = x.createLinearGradient(0, PH - 260, 0, PH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
      x.fillStyle = g; x.fillRect(0, PH - 260, W, 260);
      x.fillStyle = '#ffffff'; x.font = '700 24px system-ui, -apple-system, Segoe UI, sans-serif';
      x.fillText('PARTNERS IN GIVING', pad, PH - 40);
      x.fillStyle = '#d9a441'; x.fillRect(0, PH, W, 10);
      var y = PH + 90;
      x.fillStyle = '#111111'; x.font = '58px Marcellus, Georgia, serif';
      wrap(x, title.toUpperCase(), W - pad * 2).slice(0, 3).forEach(function (l) { x.fillText(l, pad, y); y += 66; });
      x.fillStyle = '#3a3a3a'; x.font = '30px system-ui, -apple-system, Segoe UI, sans-serif';
      y += 6;
      wrap(x, line, W - pad * 2).slice(0, 3).forEach(function (l) { x.fillText(l, pad, y); y += 40; });
      var by = H - 130;
      if (pfa) { var ph = 70, pw = pfa.naturalWidth * ph / pfa.naturalHeight; x.drawImage(pfa, pad, by + 15, pw, ph); var lx = pad + pw + 26;
        x.fillStyle = '#8a8a8a'; x.font = '44px Marcellus, Georgia, serif'; x.fillText('&', lx, by + 68); lx += 50;
        if (donor) { var dh2 = 100, dw2 = donor.naturalWidth * dh2 / donor.naturalHeight; x.drawImage(donor, lx, by, dw2, dh2); }
        else { x.fillStyle = '#111'; x.font = '40px Marcellus, Georgia, serif'; x.fillText(e.donor, lx, by + 66); } }
      if (when) { x.fillStyle = '#6a6a6a'; x.font = '700 24px system-ui, -apple-system, Segoe UI, sans-serif'; x.textAlign = 'right'; x.fillText(when.toUpperCase(), W - pad, by + 64); x.textAlign = 'left'; }
      var a = document.createElement('a');
      a.download = (e.id || 'partner') + '-' + (when || 'card').replace(/\s+/g, '-').toLowerCase() + '.png';
      a.href = c.toDataURL('image/png');
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(function (x) { err((x && x.message) || 'The picture could not be made.'); });
  }

  document.addEventListener('change', function (ev) {
    if (!S.edit || !node() || !node().contains(ev.target)) return;
    var t = ev.target;
    if (t.id === 'ppLogoFile' && t.files && t.files[0]) {
      read();
      upload(t.files[0], 'ppLogoBar').then(function (url) { S.edit.logo = url; paintForm(); }).catch(function (x) { paintForm(x && x.message); });
    } else if (t.id === 'ppPhotoFile' && t.files && t.files.length) {
      read();
      var files = [].slice.call(t.files, 0, 12);
      files.reduce(function (p, f) { return p.then(function () { return upload(f, 'ppPhotoBar').then(function (url) { S.edit.photos.push({ src: url, alt: '' }); }); }); }, Promise.resolve())
        .then(function () { paintForm(); }).catch(function (x) { paintForm(x && x.message); });
    } else if (t.hasAttribute('data-tphoto') && t.files && t.files[0]) {
      read();
      var i = +t.getAttribute('data-tphoto');
      upload(t.files[0], 'ppTBar' + i).then(function (url) { S.edit.timeline[i].photo = url; paintForm(); }).catch(function (x) { paintForm(x && x.message); });
    }
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-pp]');
    if (!b || !node() || !node().contains(b)) return;
    var act = b.getAttribute('data-pp'), i = +b.getAttribute('data-i'), e = S.edit;
    if (act === 'new') return startEdit(null);
    if (act === 'edit') return startEdit(S.list.filter(function (p) { return p.id === b.getAttribute('data-id'); })[0]);
    if (act === 'remove') {
      var p = S.list.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
      if (!p || !window.confirm('Take ' + p.donor + '’s partnership off the site? It is kept, and can be put back.')) return;
      return api({ action: 'remove', id: p.id }).then(pane).catch(fail);
    }
    if (!e) return;
    if (act === 'back') { S.edit = null; return paintList(); }
    read();
    if (act === 'save') return save('published');
    if (act === 'draft') return save('draft');
    if (act === 'nologo') { e.logo = ''; return paintForm(); }
    if (act === 'first') { var ph = e.photos.splice(i, 1)[0]; e.photos.unshift(ph); return paintForm(); }
    if (act === 'nophoto') { e.photos.splice(i, 1); return paintForm(); }
    if (act === 'tadd') { e.timeline.push({ id: '', date: today(), title: '', text: '', photo: '', photoAlt: '', count: 0 }); return paintForm(); }
    if (act === 'tremove') { if (window.confirm('Remove this line from the timeline?')) { e.timeline.splice(i, 1); paintForm(); } return; }
    if (act === 'tnophoto') { e.timeline[i].photo = ''; return paintForm(); }
    if (act === 'card') return card(e, (e.photos[i] || {}).src, e.headline || e.gift, 'Given by ' + e.donor + (e.unit ? ' to ' + e.unit : '') + (e.place ? ', ' + e.place : ''), day(e.givenOn));
    if (act === 'tcard') {
      var x = e.timeline[i];
      return card(e, x.photo || (e.photos[0] || {}).src, x.title || e.headline, (x.count ? x.count + ' ' + e.countLabel + '. ' : '') + (x.text || ('With ' + whose(e.donor) + ' gift.')), day(x.date));
    }
  });

  window.PFAPartners = { pane: pane };
})();
