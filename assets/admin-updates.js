/* The panel's Updates section: "From PFA" news and notices for the public
   site (owner, 26 Nov 2026: "find a best place to display new
   news/notifications. it could have new info that pfa releases to public..
   it should have a cool video player as well").

   A list of updates, newest first, and a short form: title, a few lines,
   and at most one film (uploaded here, or a YouTube, Vimeo or Instagram
   link) and one picture. The latest update shows under the home page's
   buttons; every update shows at the top of the Newsroom. Read from and
   saved through /api/admin/updates (lib/routes/admin/updates.js).

   A film goes straight from this browser to the project's Storage bucket,
   never through the server (lib/update-media.js says why), with a bar
   showing how far it has got. admin.html calls PFAUpdates.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var URL_ = '/api/admin/updates';

  var style = document.createElement('style');
  style.textContent = [
    '.ux-top{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;margin:0 0 14px}',
    '.ux-top .press,.ux-foot .press{width:auto;display:inline-flex;align-items:center;min-height:40px;padding:0 20px}',
    '.ux-list{display:grid;gap:10px}',
    '.ux-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 16px;align-items:center;padding:14px 16px;border:1px solid var(--line)}',
    '.ux-row b{display:block;font-size:15px;line-height:1.4;overflow-wrap:anywhere}',
    '.ux-row small{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:6px;color:var(--muted);font-size:12px;line-height:1.4}',
    '.ux-acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}',
    '.ux-acts .ghost{height:34px;padding:0 12px}',
    '.flag[data-s="published"]{border-color:var(--ink);background:var(--ink);color:var(--paper)}',
    '.flag[data-s="pinned"]{border-color:var(--working);color:var(--working)}',
    '.ux-form{display:grid;gap:20px;max-width:760px}',
    '.ux-f{display:grid;gap:7px;min-width:0}',
    '.ux-f>span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.ux-f input[type=text],.ux-f input[type=url],.ux-f textarea{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:14px;color:var(--ink);border-radius:0}',
    '.ux-f textarea{min-height:130px;resize:vertical;line-height:1.55;field-sizing:content}',
    '.ux-f input:focus,.ux-f textarea:focus{outline:none;border-color:var(--ink)}',
    '.ux-hint{margin:0;font-size:12px;line-height:1.5;color:var(--muted)}',
    '.ux-radio{display:flex;flex-wrap:wrap;gap:10px 22px;font-size:14px}',
    '.ux-radio label{display:inline-flex;align-items:center;gap:9px;cursor:pointer;line-height:1.4}',
    '.ux-radio input,.ux-check input{width:18px;height:18px;margin:0;flex:none}',
    '.ux-check{display:inline-flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.45;cursor:pointer}',
    '.ux-check input{margin-top:1px}',
    '.ux-box{display:grid;gap:12px;padding:16px;border:1px solid var(--line)}',
    '.ux-box[hidden]{display:none}',
    '.ux-plus{display:inline-flex;align-items:center;gap:8px;width:max-content;padding:0;border:0;background:none;font:inherit;font-size:12px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;color:var(--ink)}',
    '.ux-plus i{font-style:normal;font-size:16px;line-height:1;display:inline-block;transition:transform .2s}',
    '.ux-plus[aria-expanded="true"] i{transform:rotate(45deg)}',
    '.ux-file{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
    '.ux-file input[type=file]{font:inherit;font-size:13px;max-width:100%}',
    '.ux-bar{height:6px;background:var(--line);overflow:hidden}',
    '.ux-bar i{display:block;height:100%;width:0;background:var(--ink);transition:width .2s}',
    '.ux-got{margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}',
    '.ux-got img{display:block;max-width:220px;max-height:140px;margin-top:8px;object-fit:cover}',
    '.ux-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;position:sticky;bottom:0;background:var(--paper);padding:12px 0;border-top:1px solid var(--line)}',
    '.ux-err{margin:0;color:#a3251f;font-size:13px;line-height:1.5}',
    '.ux-err:empty{display:none}',
    '@media (max-width:600px){.ux-row{grid-template-columns:minmax(0,1fr)}.ux-acts{justify-content:flex-start}}'
  ].join('');
  document.head.appendChild(style);

  var S = { list: [], edit: null, busy: false };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KIND = { news: 'News', notice: 'Notice', event: 'Event' };
  var FILM = { file: 'Uploaded film', youtube: 'YouTube film', vimeo: 'Vimeo film', instagram: 'Instagram', mux: 'Live show recording' };

  function node() { return $('[data-pane="updates"]'); }
  function api(body) { return A.api(URL_, body ? { method: 'POST', body: body } : undefined); }
  function day(iso) {
    var t = Date.parse(String(iso || ''));
    if (!isFinite(t)) return '';
    var d = new Date(t + 5.5 * 3600e3);   /* the day in India, as the site shows it */
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function fail(e) { var n = node(); if (n) A.fail(n, e); }

  function pane() {
    var n = node();
    if (!n) return;
    n.innerHTML = '<div class="loading">Reading the updates…</div>';
    api().then(function (d) { S.list = d.updates || []; S.edit = null; paintList(); }).catch(fail);
  }

  function paintList(note) {
    var n = node();
    if (!n) return;
    var out = ['<div class="ux-top"><p class="ux-hint" style="max-width:62ch">The newest update shows under the home page’s buttons, marked New. Every update shows at the top of the Newsroom. Films play in the site’s own player.</p>'
      + '<button class="press" type="button" data-ux="new">New update</button></div>'];
    if (note) out.push('<p class="ux-hint" role="status" style="margin:0 0 12px;color:var(--ink)">' + esc(note) + '</p>');
    if (!S.list.length) out.push('<div class="empty"><b>No updates yet</b>Press New update to write the first one.</div>');
    else {
      out.push('<div class="ux-list">');
      S.list.forEach(function (u) {
        var media = u.media ? FILM[u.media.kind] || 'Film' : (u.photo ? 'Picture' : '');
        out.push('<div class="ux-row"><div><b>' + esc(u.title) + '</b><small>'
          + '<span class="flag" data-s="' + esc(u.status) + '">' + (u.status === 'published' ? 'On the site' : 'Draft') + '</span>'
          + (u.pinned ? '<span class="flag" data-s="pinned">Kept at the top</span>' : '')
          + '<span>' + esc(KIND[u.kind] || 'News') + '</span>'
          + (u.publishedAt ? '<span>' + esc(day(u.publishedAt)) + '</span>' : '')
          + (media ? '<span>' + esc(media) + '</span>' : '')
          + '</small></div><div class="ux-acts"><button class="ghost" type="button" data-ux="edit" data-id="' + esc(u.id) + '">Edit</button>'
          + '<button class="ghost danger" type="button" data-ux="remove" data-id="' + esc(u.id) + '">Take off the site</button></div></div>');
      });
      out.push('</div>');
    }
    n.innerHTML = out.join('');
  }

  function blank() { return { id: '', title: '', body: '', kind: 'news', status: 'published', pinned: false, link: '', linkLabel: '', media: null, photo: '', photoAlt: '', film: 'none', filmLink: '' }; }
  function startEdit(u) {
    var e = blank();
    if (u) {
      Object.keys(e).forEach(function (k) { if (u[k] != null) e[k] = u[k]; });
      var m = u.media;
      if (m && m.kind === 'file') { e.film = 'file'; }
      else if (m && m.kind === 'mux') { e.film = 'mux'; }
      else if (m) { e.film = 'link'; e.filmLink = m.kind === 'youtube' ? 'https://youtu.be/' + m.id : m.kind === 'vimeo' ? 'https://vimeo.com/' + m.id : 'https://www.instagram.com/' + (m.reel ? 'reel' : 'p') + '/' + m.id + '/'; }
    }
    S.edit = e;
    paintForm();
  }

  function radio(name, value, label, on) {
    return '<label><input type="radio" name="' + name + '" value="' + value + '"' + (on ? ' checked' : '') + '>' + esc(label) + '</label>';
  }
  function paintForm(error) {
    var n = node(), e = S.edit;
    if (!n || !e) return;
    var hasPic = !!e.photo, hasLink = !!e.link;
    var out = ['<div class="ux-form">', '<div><button class="ghost" type="button" data-ux="back">Back to the updates</button></div>'];
    out.push('<label class="ux-f"><span>Title</span><input type="text" id="uxTitle" maxlength="90" value="' + esc(e.title) + '" placeholder="What happened, in a line"></label>');
    out.push('<div class="ux-f"><span>Kind</span><div class="ux-radio">' + radio('uxKind', 'news', 'News', e.kind === 'news') + radio('uxKind', 'notice', 'Notice', e.kind === 'notice') + radio('uxKind', 'event', 'Event', e.kind === 'event') + '</div></div>');
    out.push('<label class="ux-f"><span>Text</span><textarea id="uxBody" maxlength="1200" placeholder="A few lines for the public">' + esc(e.body) + '</textarea>'
      + '<p class="ux-hint">A blank line starts a new paragraph. The first paragraph shows; the rest opens under Read more.</p></label>');
    out.push('<div class="ux-f"><span>Film</span><div class="ux-radio">' + radio('uxFilm', 'none', 'No film', e.film === 'none')
      + radio('uxFilm', 'file', 'Upload a film', e.film === 'file') + radio('uxFilm', 'link', 'Paste a link', e.film === 'link')
      + (e.film === 'mux' ? radio('uxFilm', 'mux', 'Live show recording', true) : '') + '</div></div>');
    out.push('<div class="ux-box" id="uxFileBox"' + (e.film === 'file' ? '' : ' hidden') + '>'
      + (e.media && e.media.kind === 'file' ? '<p class="ux-got">A film is uploaded. Choose another file only to replace it.</p>' : '')
      + '<div class="ux-file"><input type="file" id="uxFilmFile" accept="video/mp4,video/webm,video/quicktime"></div>'
      + '<div class="ux-bar" id="uxFilmBar" hidden><i></i></div><p class="ux-hint" id="uxFilmSay">MP4, WebM or MOV, up to 1 GB. Keep this page open while it uploads.</p></div>');
    out.push('<div class="ux-box" id="uxLinkBox"' + (e.film === 'link' ? '' : ' hidden') + '><label class="ux-f"><span>YouTube, Vimeo or Instagram link</span>'
      + '<input type="url" id="uxFilmLink" value="' + esc(e.filmLink) + '" placeholder="https://youtu.be/…"></label></div>');
    out.push('<button class="ux-plus" type="button" data-ux="toggle" aria-controls="uxPicBox" aria-expanded="' + hasPic + '"><i aria-hidden="true">+</i>Picture</button>');
    out.push('<div class="ux-box" id="uxPicBox"' + (hasPic ? '' : ' hidden') + '>'
      + '<p class="ux-hint">Shown with the update when it has no film, and as the film’s cover when it has one.</p>'
      + (e.photo ? '<p class="ux-got">The picture:<img src="' + esc(e.photo) + '" alt=""></p><div><button class="ghost danger" type="button" data-ux="nopic">Remove the picture</button></div>' : '')
      + '<div class="ux-file"><input type="file" id="uxPicFile" accept="image/jpeg,image/png,image/webp"></div>'
      + '<div class="ux-bar" id="uxPicBar" hidden><i></i></div>'
      + '<label class="ux-f"><span>What the picture shows</span><input type="text" id="uxPicAlt" maxlength="160" value="' + esc(e.photoAlt) + '" placeholder="For people who cannot see it"></label></div>');
    out.push('<button class="ux-plus" type="button" data-ux="toggle" aria-controls="uxLinkMore" aria-expanded="' + hasLink + '"><i aria-hidden="true">+</i>Read more link</button>');
    out.push('<div class="ux-box" id="uxLinkMore"' + (hasLink ? '' : ' hidden') + '>'
      + '<label class="ux-f"><span>A page of the site or a web address</span><input type="text" id="uxLink" value="' + esc(e.link) + '" placeholder="donate.html, or https://…"></label>'
      + '<label class="ux-f"><span>Its words</span><input type="text" id="uxLinkLabel" maxlength="40" value="' + esc(e.linkLabel) + '" placeholder="Read the full story"></label></div>');
    out.push('<label class="ux-check"><input type="checkbox" id="uxPin"' + (e.pinned ? ' checked' : '') + '><span>Keep at the top, on the home page and the Newsroom, until another is kept there</span></label>');
    out.push('<div class="ux-foot"><button class="press" type="button" data-ux="publish">' + (e.status === 'published' && e.id ? 'Save' : 'Put on the site') + '</button>'
      + '<button class="ghost" type="button" data-ux="draft">Save as a draft</button>'
      + '<button class="ghost" type="button" data-ux="back">Cancel</button><p class="ux-err" role="alert" id="uxErr">' + esc(error || '') + '</p></div>');
    out.push('</div>');
    n.innerHTML = out.join('');
  }

  /* what the form says now, kept in S.edit so a redraw loses nothing */
  function read() {
    var e = S.edit;
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    e.title = v('uxTitle'); e.body = v('uxBody'); e.filmLink = v('uxFilmLink');
    e.photoAlt = v('uxPicAlt'); e.link = v('uxLink'); e.linkLabel = v('uxLinkLabel');
    var k = document.querySelector('input[name=uxKind]:checked'); if (k) e.kind = k.value;
    var f = document.querySelector('input[name=uxFilm]:checked'); if (f) e.film = f.value;
    var p = document.getElementById('uxPin'); if (p) e.pinned = p.checked;
    return e;
  }
  function err(t) { var el = document.getElementById('uxErr'); if (el) el.textContent = t || ''; }

  /* A picture is made at most 1600 pixels wide before it goes: a phone's
     photograph is 4 MB, the page needs a tenth of that. */
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
        c.toBlob(function (b) { resolve(b ? new File([b], 'picture.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function upload(kind, file, bar, sayEl) {
    S.busy = true;
    var b = document.getElementById(bar), say = sayEl ? document.getElementById(sayEl) : null;
    if (b) { b.hidden = false; b.firstChild.style.width = '0'; }
    var done = function (e) { S.busy = false; if (e) { if (b) b.hidden = true; throw e; } };
    return api({ action: 'upload', kind: kind, type: file.type, size: file.size, origin: location.origin }).then(function (r) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('PUT', r.upload);
        x.upload.onprogress = function (ev) {
          if (!ev.lengthComputable) return;
          var pc = Math.round(ev.loaded / ev.total * 100);
          if (b) b.firstChild.style.width = pc + '%';
          if (say) say.textContent = 'Uploading: ' + pc + '%';
        };
        x.onload = function () { x.status >= 200 && x.status < 300 ? resolve(r.path) : reject(new Error('The upload stopped. Try again.')); };
        x.onerror = function () { reject(new Error('The upload stopped. Check the connection and try again.')); };
        x.send(file);
      });
    }).then(function (path) { return api({ action: 'uploaded', path: path }); })
      .then(function (r) { done(); return r; }, function (e) { done(e); });
  }

  function save(status) {
    if (S.busy) { err('Wait for the upload to finish.'); return; }
    var e = read();
    var body = { action: 'save', id: e.id, title: e.title, body: e.body, kind: e.kind, status: status, pinned: e.pinned, link: e.link, linkLabel: e.linkLabel, photo: e.photo, photoAlt: e.photoAlt };
    if (e.film === 'file') {
      if (!e.media || e.media.kind !== 'file') { err('Choose the film to upload, or pick No film.'); return; }
      body.media = e.media;
    } else if (e.film === 'mux') body.media = e.media;
    else if (e.film === 'link') {
      if (!e.filmLink.trim()) { err('Paste the film’s link, or pick No film.'); return; }
      body.media = { link: e.filmLink.trim() };
    }
    S.busy = true;
    api(body).then(function (r) {
      S.busy = false;
      return api().then(function (d) {
        S.list = d.updates || []; S.edit = null;
        paintList(r.status === 'draft' ? 'Saved as a draft. It is not on the site.' : 'On the site. Visitors see it within two minutes.');
      });
    }).catch(function (x) { S.busy = false; err(x && x.message); });
  }

  document.addEventListener('change', function (ev) {
    if (!S.edit || !node() || !node().contains(ev.target)) return;
    var t = ev.target;
    if (t.name === 'uxFilm') {
      read();
      document.getElementById('uxFileBox').hidden = t.value !== 'file';
      document.getElementById('uxLinkBox').hidden = t.value !== 'link';
    }
    if (t.id === 'uxFilmFile' && t.files && t.files[0]) {
      var f = t.files[0];
      err('');
      upload('video', f, 'uxFilmBar', 'uxFilmSay').then(function (r) {
        S.edit.media = { kind: 'file', url: r.url, type: r.type };
        var s = document.getElementById('uxFilmSay'); if (s) s.textContent = 'Uploaded: ' + f.name;
      }).catch(function (x) { err(x && x.message); var s = document.getElementById('uxFilmSay'); if (s) s.textContent = 'MP4, WebM or MOV, up to 1 GB.'; t.value = ''; });
    }
    if (t.id === 'uxPicFile' && t.files && t.files[0]) {
      err('');
      shrink(t.files[0]).then(function (f) { return upload('photo', f, 'uxPicBar'); }).then(function (r) {
        read(); S.edit.photo = r.url; paintForm();
      }).catch(function (x) { err(x && x.message); t.value = ''; });
    }
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-ux]');
    if (!b || !node() || !node().contains(b)) return;
    var act = b.getAttribute('data-ux'), id = b.getAttribute('data-id');
    if (act === 'new') startEdit(null);
    else if (act === 'edit') startEdit(S.list.filter(function (u) { return u.id === id; })[0]);
    else if (act === 'back') { if (S.busy && !confirm('A file is still uploading. Leave anyway?')) return; S.edit = null; paintList(); }
    else if (act === 'publish') save('published');
    else if (act === 'draft') save('draft');
    else if (act === 'nopic') { read(); S.edit.photo = ''; S.edit.photoAlt = ''; paintForm(); }
    else if (act === 'toggle') {
      var box = document.getElementById(b.getAttribute('aria-controls'));
      var open = b.getAttribute('aria-expanded') !== 'true';
      if (box) box.hidden = !open;
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    } else if (act === 'remove') {
      var u = S.list.filter(function (x) { return x.id === id; })[0];
      if (!u || !confirm('Take “' + u.title + '” off the site? It is kept in the records.')) return;
      b.disabled = true;
      api({ action: 'remove', id: id }).then(function () { return api(); }).then(function (d) { S.list = d.updates || []; paintList('Taken off the site.'); })
        .catch(function (x) { b.disabled = false; A.say ? A.say(x && x.message) : alert(x && x.message); });
    }
  });

  window.PFAUpdates = { pane: pane };
})();
