/* Shared photograph control for the PFA application journeys.

   One control, used identically by the Colony Caregiver Card and the Patron card:
   drag to position, pinch or slide to zoom, and a plain warning when the file
   is too small to print without going soft. It emits a normalised JPEG at the
   card's own aspect ratio, so the journeys never deal in raw uploads. */
(function () {
  'use strict';

  /* Print maths, not a guess. A 54 mm wide card at 300 dpi needs 638 px across
     the printed area; below that the photograph visibly softens, and below
     roughly half that it pixelates outright. The zoom multiplies the demand,
     because zooming in uses fewer of the original pixels. */
  var PRINT_DPI = 300;
  var CARD_WIDTH_MM = 54;
  var IDEAL_PX = Math.round((CARD_WIDTH_MM / 25.4) * PRINT_DPI);   // 638
  var POOR_PX = Math.round(IDEAL_PX * 0.55);                       // 351

  function create(options) {
    var mount = options.mount;
    if (!mount) return null;

    var aspect = options.aspect || (85.6 / 54);   // portrait ID-1, height / width
    var output = options.outputWidth || 1400;
    var onChange = options.onChange || function () {};
    /* A smaller photo window needs fewer pixels: the membership card's is
       about 25 mm wide (member-photo.html passes its own). */
    var idealPx = options.idealPx || IDEAL_PX;
    var poorPx = options.poorPx || POOR_PX;

    var state = { image: null, zoom: 1, x: 0.5, y: 0.5, dragging: false, natural: 0 };

    mount.innerHTML = ''
      + '<div class="pe" data-pe>'
      + '  <div class="pe-stage" data-pe-stage>'
      + '    <canvas data-pe-canvas></canvas>'
      + '    <p class="pe-empty" data-pe-empty><strong>Tap to add a photograph</strong><span>Portrait, shoulders up. JPG or PNG.</span></p>'
      + '    <button class="pe-change" type="button" data-pe-change hidden>Change photograph</button>'
      + '  </div>'
      + '  <div class="pe-controls" data-pe-controls hidden>'
      + '    <label class="pe-zoom">'
      + '      <span>Zoom</span>'
      + '      <input type="range" min="100" max="300" value="100" step="1" data-pe-zoom aria-label="Zoom the photograph">'
      + '    </label>'
      + '    <p class="help pe-hint">Drag the photograph to position it.</p>'
      + '    <div class="pe-remote" data-pe-remote-row hidden>'
      + '      <button type="button" class="pe-remote-go" data-pe-remote>Remove it anyway</button>'
      + '      <span class="help">This sends the photograph to our background-removal service. It is not kept.</span>'
      + '    </div>'
      + '    <label class="pe-cutout" data-pe-cutout-row hidden>'
      + '      <input type="checkbox" data-pe-cutout checked>'
      + '      <span>Remove the background</span>'
      + '    </label>'
      + '  </div>'
      + '  <p class="pe-warn" data-pe-warn hidden></p>'
      + '</div>';

    var stage = mount.querySelector('[data-pe-stage]');
    var canvas = mount.querySelector('[data-pe-canvas]');
    var empty = mount.querySelector('[data-pe-empty]');
    var controls = mount.querySelector('[data-pe-controls]');
    var zoomInput = mount.querySelector('[data-pe-zoom]');
    var warn = mount.querySelector('[data-pe-warn]');
    var change = mount.querySelector('[data-pe-change]');
    var cutoutRow = mount.querySelector('[data-pe-cutout-row]');
    var remoteRow = mount.querySelector('[data-pe-remote-row]');
    var remoteButton = mount.querySelector('[data-pe-remote]');
    var cutoutBox = mount.querySelector('[data-pe-cutout]');
    var cutoutNote = null;

    function layout() {
      var width = stage.clientWidth || 220;
      var density = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(width * aspect * density);
      canvas.style.width = width + 'px';
      canvas.style.height = (width * aspect) + 'px';
      draw();
    }

    /* The visible frame and the exported file use one routine, so what is
       positioned here is exactly what prints. */
    /* Zoomed all the way out, the whole photograph shows, on white, and
       nothing of it is cut (owner, 29 Oct 2026: "ensure no part of the photo
       is clipped"). The person may zoom in to frame their face, and then
       drags; they are never made to lose part of the picture to fit. */
    function paint(target, targetWidth, targetHeight) {
      var context = target.getContext('2d');
      context.clearRect(0, 0, targetWidth, targetHeight);
      if (!state.image) return;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, targetWidth, targetHeight);

      var image = (state.cutout && cutoutBox && cutoutBox.checked) ? state.cutout : state.image;
      var whole = Math.min(targetWidth / image.width, targetHeight / image.height);
      var scale = whole * state.zoom;
      var drawWidth = image.width * scale;
      var drawHeight = image.height * scale;
      var x = drawWidth > targetWidth ? -(drawWidth - targetWidth) * state.x : (targetWidth - drawWidth) / 2;
      var y = drawHeight > targetHeight ? -(drawHeight - targetHeight) * state.y : (targetHeight - drawHeight) / 2;

      context.drawImage(image, x, y, drawWidth, drawHeight);
    }
    /* how far in one may zoom: until the photograph fills the frame, and
       three times that */
    function maxZoom(image) {
      var whole = Math.min(1 / image.width, aspect / image.height);
      var fill = Math.max(1 / image.width, aspect / image.height);
      return Math.max(1, (fill / whole) * 3);
    }

    function draw() {
      paint(canvas, canvas.width, canvas.height);
      empty.hidden = Boolean(state.image);
      if (change) change.hidden = !state.image;
    }

    /* Effective resolution is what survives the crop and the zoom, not what the
       file claims. */
    function assess() {
      if (!state.image) return { level: 'none', effective: 0 };
      var image = state.image;
      /* the photograph's pixels across the frame's width, at this zoom */
      var effective = Math.round(Math.max(image.width, image.height / aspect) / state.zoom);
      var level = effective >= idealPx ? 'good' : effective >= poorPx ? 'soft' : 'poor';
      return { level: level, effective: effective };
    }

    function report() {
      var verdict = assess();
      if (verdict.level === 'none' || verdict.level === 'good') {
        warn.hidden = true;
        warn.className = 'pe-warn';
      } else if (verdict.level === 'soft') {
        warn.hidden = false;
        warn.className = 'pe-warn soft';
        warn.textContent = 'This photograph is a little small for printing and may look soft on the printed card. '
          + 'Zooming out, or using a larger image, will sharpen it.';
      } else {
        warn.hidden = false;
        warn.className = 'pe-warn poor';
        warn.textContent = 'This photograph is too small and will look pixelated when printed. '
          + 'Use a larger image, or zoom out, before ordering the printed card.';
      }
      onChange(verdict);
      return verdict;
    }

    /* Pointer events cover mouse, touch and pen with one path. */
    var last = null;
    /* The empty frame is the upload control. One thing to tap, not two. */
    stage.addEventListener('click', function () {
      if (!state.image && options.input) options.input.click();
    });
    stage.setAttribute('role', 'button');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('aria-label', 'Add a photograph');
    stage.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && !state.image && options.input) { event.preventDefault(); options.input.click(); }
    });
    if (change) change.addEventListener('click', function () { if (options.input) options.input.click(); });
    stage.addEventListener('pointerdown', function (event) {
      if (!state.image) return;
      state.dragging = true;
      last = { x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
    });

    stage.addEventListener('pointermove', function (event) {
      if (!state.dragging || !last) return;
      var rect = stage.getBoundingClientRect();
      state.x = Math.min(1, Math.max(0, state.x - (event.clientX - last.x) / rect.width));
      state.y = Math.min(1, Math.max(0, state.y - (event.clientY - last.y) / rect.height));
      last = { x: event.clientX, y: event.clientY };
      draw();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) {
      stage.addEventListener(name, function () {
        state.dragging = false;
        last = null;
        stage.classList.remove('is-dragging');
      });
    });

    zoomInput.addEventListener('input', function () {
      state.zoom = Number(zoomInput.value) / 100;
      draw();
      report();
    });

    window.addEventListener('resize', layout);

    function load(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('That image could not be read.')); };
        reader.onload = function () {
          var image = new Image();
          image.onerror = function () { reject(new Error('That image could not be read.')); };
          image.onload = function () {
            state.image = image;
            state.natural = Math.min(image.width, image.height);
            state.zoom = 1;
            state.x = 0.5;
            /* Centring is the wrong default for a portrait. Whenever the frame
               is going to crop vertically, the part worth keeping is the face,
               which sits in the upper third - so the crop starts high and the
               person can still drag it wherever they want. */
            var frameIsShorter = (image.height / image.width) > aspect;
            state.y = frameIsShorter ? 0.12 : 0.5;
            zoomInput.max = String(Math.round(maxZoom(image) * 100));
            zoomInput.value = '100';
            controls.hidden = false;
            state.cutout = null;
            layout();
            attemptCutout(image);
            resolve(report());
          };
          image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });
    }

    /* Lift the subject off a plain background, if it is plain.

       Runs once per upload, on the full-size image, on the device. It works on
       a copy: state.image is never replaced, so the toggle can put the original
       back instantly and nothing is lost if the person disagrees with the
       result. When it declines it says why, in a sentence the person can act
       on, and leaves the photograph alone. */
    function attemptCutout(image) {
      var Cut = window.PFAPhotoCutout;
      if (!Cut || !cutoutRow) return;
      cutoutRow.hidden = true;
      if (remoteRow) remoteRow.hidden = true;
      note('');

      /* A long edge of 900 is plenty to find the boundary and keeps a big
         upload from stalling the page; the mask is applied at that size and
         the result is drawn back at the card's own resolution. */
      var long = Math.max(image.width, image.height);
      var scale = long > 900 ? 900 / long : 1;
      var w = Math.max(1, Math.round(image.width * scale));
      var h = Math.max(1, Math.round(image.height * scale));

      var work = document.createElement('canvas');
      work.width = w; work.height = h;
      var wctx = work.getContext('2d', { willReadFrequently: true });
      wctx.drawImage(image, 0, 0, w, h);

      var source;
      try { source = wctx.getImageData(0, 0, w, h); } catch (error) { return; }

      var result;
      try { result = Cut.cut(source, { ground: options.ground || [255, 255, 255] }); }
      catch (error) { return; }

      if (!result.ok) {
        if (result.reason !== 'NOTHING_TO_REMOVE') {
          note(Cut.message(result.reason));
          offerRemote(image);
        }
        return;
      }

      wctx.putImageData(new ImageData(result.data, w, h), 0, 0);
      var lifted = new Image();
      lifted.onload = function () {
        state.cutout = lifted;
        cutoutRow.hidden = false;
        draw();
        onChange(report());
      };
      lifted.src = work.toDataURL('image/png');
    }

    /* The hard cases: a busy background, or a shirt the colour of the wall.
       Those need a segmentation model, which means a hosted one, which means
       this photograph leaving the device.

       That is the only point in the whole membership flow where a photograph
       of a person is sent anywhere, so it is never done quietly. The member is
       told what will happen, in those words, and has to press the button. No
       press, no send - and the photograph still works, uncut, which is what
       every card looked like until now. */
    function offerRemote(image) {
      /* Two ways to rescue a refused photograph, and the order is deliberate.
         The in-browser model costs nothing per image and sends nothing
         anywhere, so it is tried first when it is switched on; the hosted
         service is the fallback to the fallback. */
      if (options.ml && window.PFAPhotoCutoutML) { offerLocalMl(image); return; }
      if (!options.remote || !remoteButton) return;
      remoteRow.hidden = false;
      remoteButton.disabled = false;
      remoteButton.textContent = 'Remove it anyway';
      remoteButton.onclick = function () {
        remoteButton.disabled = true;
        remoteButton.textContent = 'Removing...';
        sendForRemoval(image);
      };
    }

    /* The model runs on the device, so there is nothing to consent to - but it
       is a large download the first time, so it is still a button rather than
       something that happens to a person on a slow connection. */
    function offerLocalMl(image) {
      if (!remoteButton) return;
      remoteRow.hidden = false;
      remoteButton.disabled = false;
      remoteButton.textContent = 'Remove it anyway';
      remoteRow.querySelector('.help').textContent =
        'This runs on your device. The photograph is not sent anywhere.';
      remoteButton.onclick = function () {
        remoteButton.disabled = true;
        remoteButton.textContent = 'Preparing...';
        window.PFAPhotoCutoutML.remove(image, options.ground || [255, 255, 255], function (fraction) {
          remoteButton.textContent = 'Downloading ' + Math.round(fraction * 100) + '%';
        }).then(function (canvas) {
          var done = new Image();
          done.onload = function () {
            state.cutout = done;
            if (cutoutRow) cutoutRow.hidden = false;
            if (cutoutBox) cutoutBox.checked = true;
            remoteRow.hidden = true;
            note('');
            draw();
            onChange(report());
          };
          done.src = canvas.toDataURL('image/png');
        }).catch(function () {
          /* If the model could not load or run, fall through to the hosted
             service when there is one, rather than dead-ending. */
          if (options.remote) { offerRemoteOnly(image); return; }
          remoteRow.hidden = true;
          note('The background could not be removed. The photograph is fine as it is.');
        });
      };
    }

    function offerRemoteOnly(image) {
      remoteButton.disabled = false;
      remoteButton.textContent = 'Try our service instead';
      remoteRow.querySelector('.help').textContent =
        'This sends the photograph to our background-removal service. It is not kept.';
      remoteButton.onclick = function () {
        remoteButton.disabled = true;
        remoteButton.textContent = 'Removing...';
        sendForRemoval(image);
      };
    }

    function sendForRemoval(image) {
      var canvas = document.createElement('canvas');
      var long = Math.max(image.width, image.height);
      var scale = long > 1600 ? 1600 / long : 1;
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

      fetch(options.remote, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: canvas.toDataURL('image/jpeg', 0.9) })
      }).then(function (response) {
        if (!response.ok) throw new Error('failed');
        return response.json();
      }).then(function (body) {
        /* What comes back is transparent where the background was, so it is
           laid onto the card's own ground here rather than trusting the
           provider to have used the right colour. */
        var lifted = new Image();
        lifted.onload = function () {
          var ground = options.ground || [255, 255, 255];
          var flat = document.createElement('canvas');
          flat.width = lifted.width; flat.height = lifted.height;
          var fctx = flat.getContext('2d');
          fctx.fillStyle = 'rgb(' + ground[0] + ',' + ground[1] + ',' + ground[2] + ')';
          fctx.fillRect(0, 0, flat.width, flat.height);
          fctx.drawImage(lifted, 0, 0);

          var done = new Image();
          done.onload = function () {
            state.cutout = done;
            if (cutoutRow) cutoutRow.hidden = false;
            if (cutoutBox) cutoutBox.checked = true;
            remoteButton.hidden = true;
            note('');
            draw();
            onChange(report());
          };
          done.src = flat.toDataURL('image/png');
        };
        lifted.src = body.image;
      }).catch(function () {
        remoteButton.disabled = false;
        remoteButton.textContent = 'Try again';
        note('The background could not be removed just now. The photograph is fine as it is.');
      });
    }

    function note(text) {
      if (!cutoutNote) {
        cutoutNote = document.createElement('p');
        cutoutNote.className = 'help pe-cutout-note';
        controls.appendChild(cutoutNote);
      }
      cutoutNote.textContent = text || '';
      cutoutNote.hidden = !text;
    }

    if (cutoutBox) {
      cutoutBox.addEventListener('change', function () { draw(); onChange(report()); });
    }

    function toDataUrl() {
      if (!state.image) return '';
      var out = document.createElement('canvas');
      out.width = output;
      out.height = Math.round(output * aspect);
      paint(out, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.92);
    }

    function clear() {
      state.image = null;
      state.cutout = null;
      if (cutoutRow) cutoutRow.hidden = true;
      note('');
      controls.hidden = true;
      warn.hidden = true;
      draw();
    }

    layout();

    return {
      load: load,
      clear: clear,
      toDataUrl: toDataUrl,
      assess: assess,
      hasImage: function () { return Boolean(state.image); },
      relayout: layout
    };
  }

  window.PFAPhotoEditor = { create: create, IDEAL_PX: IDEAL_PX, POOR_PX: POOR_PX };
})();
