'use strict';
/* Eight YouTube films added to the founder page's Watch grid, beside the four
   that were there.
 *
 * The section's promise is that nothing third-party loads until play is
 * pressed, and a thumbnail is the easiest way to break that promise by
 * accident: a still hot-linked from i.ytimg.com is a request to Google on
 * page load, before the visitor has done anything. So the stills are served
 * from this site, and these tests hold that line.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { after } = require('node:test');

/* A mounted player runs timers, and an open jsdom window with a live timer
   holds the process open long after the assertions are done: the tests
   passed and the file still timed out. Every window this file opens is
   closed when it is finished with them. */
const OPEN = [];
after(() => { OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* already gone */ } }); });

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'founder.html'), 'utf8');
const { filmsFromPage, forPage } = require(path.join(ROOT, 'scripts', 'fetch-founder-films.js'));

const IDS = ['KzUJG-EUS4M', 'UHNhRXX-E4Q', 'g40fggAdoYM', 'BVbpSc_EXlI',
  'qJ90k2QxPB8', 'gE9o8fIo49Q', 'qCKHi-lA6YA', 'YCq7BBDZGJw'];

test('all eight films are on the page, and the four that were there still are', () => {
  const missing = IDS.filter((id) => !html.includes(`id:'${id}'`));
  assert.deepEqual(missing, [], `not added: ${missing.join(', ')}`);
  /* "not replace, add": the reels and their app links are untouched. */
  for (const reel of ['DTOAdZZEyUf', 'DXuZ2tak7pG', 'DYhxVU4z64O', 'Dbnstj0gf7o']) {
    assert.ok(html.includes(`id:'${reel}'`), `${reel} was dropped`);
  }
  assert.match(html, /apps:\{ android:/, 'the Rapid Response tile keeps its store links');
});

test('nothing is fetched from YouTube when the page loads', () => {
  /* The one rule this section is built on. An embed is built at the moment
     play is pressed; a still would otherwise be requested immediately. */
  const beforePlay = html.slice(0, html.indexOf('function embed('));
  assert.ok(!/i\.ytimg\.com|img\.youtube\.com/.test(beforePlay),
    'a still hot-linked from YouTube is a third-party request on page load');
  assert.ok(!/i\.ytimg\.com|img\.youtube\.com/.test(html),
    'and there is no reason for that host to appear on this page at all');
});

test('every film points its still at this site', () => {
  for (const id of IDS) {
    assert.ok(html.includes(`poster:'media/founder-films/${id}.jpg'`),
      `${id} has no local still path`);
  }
});

test('nothing reaches YouTube until play is pressed', () => {
  /* The page used to build its own youtube-nocookie frame. The frame is the
     shared player's now, so what is proved here is the promise that outlived
     the builder: no still and no frame is requested while the page is merely
     open. The module builds one on press, and the stills are served from
     this site. */
  /* watch?v= links are identifiers, not requests: they are what a film is,
     and what the reels' Watch link opens. What must not be here is a still
     host or a frame, either of which is a request made on load. */
  assert.ok(!/ytimg\.com|img\.youtube\.com/.test(html), 'no still is fetched from Google');
  assert.ok(!/youtube(-nocookie)?\.com\/embed/.test(html), 'and no frame is built by the page');
  const mod = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.js'), 'utf8');
  assert.match(mod, /youtube\.com\/embed\//, 'the player builds the frame');
  assert.match(mod, /function load\(/, 'and only inside load, which runs on a press');
});
test('the tiles say where each film comes from', () => {
  assert.match(html, /SOURCE = \{[^}]*youtube:'YouTube'/, 'a YouTube tile must not be labelled Facebook');
  assert.match(html, /instagram:'Instagram'/, 'and the reels keep theirs');
});

test('a film with no title yet shows its number rather than an empty line', () => {
  /* The eight ship with empty titles on purpose: they are films of a named
     person, and a title typed here would be a caption asserting something
     about a real recording. npm run media:founder asks YouTube instead.
     Since 13 Sep 2026 the title lives on the caption stage and the button's
     own label rather than on the tile, so the fallback is checked where the
     title is now made. */
  assert.match(html, /var title = v\.title \|\| 'Film ' \+ pad\(i \+ 1\);/);
  assert.match(html, /data-title="' \+ esc\(title\)/, 'the stage reads from data-title');
  assert.match(html, /aria-label="Play: ' \+ esc\(title\)/, 'a screen reader hears the same title');
});

test('colour is revealed by hover; the still itself is never hidden', () => {
  /* Reversed on 13 Sep 2026. The old rule put typography first and raised
     the still under it on hover; the owner asked for the opposite, after
     www.offforum.com: the stills carry the wall, no text sits on them, and
     what hover reveals is colour and the play chip. The keyboard clause
     survives the reversal: focus must reach the same state as a pointer. */
  assert.match(html, /\.vtile__bg\{[^}]*grayscale/, 'the still rests in half-tone');
  assert.match(html, /\.vtile:hover \.vtile__bg,\.vtile:focus-visible \.vtile__bg\{filter:none/,
    'and comes to colour when the tile is considered');
  assert.match(html, /focus-visible \.vtile__(bg|chip)/, 'a keyboard must reach the same state as a pointer');
  assert.ok(!/vtile__ttl/.test(html.split('grid.innerHTML')[1].split('}).join')[0]),
    'no title is rendered onto the tile');
});

test('a missing still leaves the tile exactly as it was', () => {
  /* This is what lets the page ship before the folder is filled. The poster
     layer is inserted on decode, so a file that is not there yet is a no-op
     rather than an empty dark panel over the type. */
  assert.match(html, /probe\.onload = function\(\)\{/);
  const insert = html.slice(html.indexOf('probe.onload'), html.indexOf('probe.src'));
  /* The landing spot moved on 13 Sep 2026 - the still now lives inside the
     tile's frame rather than across the whole tile - but the gate is the
     point and the gate is unchanged: nothing is inserted until decode. */
  assert.match(insert, /insertBefore\(bg, frame\.firstChild\)/, 'only on load, never before');
});

/* ---------------------------------------------------------------- script --- */

test('the fetcher reads its film list from the page, not a second list', () => {
  /* Two lists drift, and the one that drifts silently is the one that stops
     fetching a still nobody notices is missing. */
  const found = filmsFromPage(html).map((f) => f.id);
  assert.deepEqual(found, IDS, 'the script and the grid must agree on which films exist');
});

test('a fetched title cannot break the page it is written into', () => {
  assert.equal(forPage("Maneka's rescue"), "Maneka\\'s rescue", 'an apostrophe would end the literal early');
  assert.equal(forPage('back\\slash'), 'back\\\\slash');
});

test('the command is registered and the folder is explained', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['media:founder'], 'node scripts/fetch-founder-films.js');
  const readme = path.join(ROOT, 'media', 'founder-films', 'README.md');
  assert.ok(fs.existsSync(readme), 'an empty folder with no note is a folder someone deletes');
});

/* ------------------------------------------------------------- rendering --- */

const THEATRE_JS = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.js'), 'utf8');

/* jsdom does not fetch a <script src>, so the module is inlined where the page
   links it: same code, same order, same globals a browser would have. */
function theatre() {
  const tag = '<script src="assets/theatre.js"></script>';
  assert.ok(html.includes(tag), 'the page must link the shared player');
  const dom = new JSDOM(html.replace(tag, `<script>${THEATRE_JS}</script>`),
    { runScripts: 'dangerously', url: 'https://pfa.test/founder.html' });
  OPEN.push(dom);
  const d = dom.window.document;
  return { dom, d, w: dom.window, $: (q) => d.querySelector(q) };
}

test('the page carries no player of its own', () => {
  /* The whole point. A copy on the page is free to drift from the one on the
     wall, and every time it did, the same bug had to be found twice. */
  assert.match(html, /<script src="assets\/theatre\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="assets\/theatre\.css">/);
  assert.ok(!/class="th-top"|id="thStrip"|id="thCap"/.test(html), 'no lookalike markup left');
  assert.ok(!/\.th-bottom\{position:absolute/.test(html), 'and no lookalike css');
});

test('it mounts the wall\'s player, with its own memory', () => {
  assert.match(html, /PFA_THEATRE\.mount\(\{ films: FILMS, progKey: 'pfa:founder:progress'/,
    'a separate key: where someone got to here is not the community wall');
  assert.match(html, /name: 'Her, in motion'/,
    'and its own name: calling it The Wall here would point at a different section of this site');
});

test('the eight films go to the player and the four reels do not', () => {
  const p = theatre();
  assert.equal(p.d.querySelectorAll('#vgrid [data-i]').length, 8, 'the grid is films the player can drive');
  assert.equal(p.d.querySelectorAll('#reels .reel').length, 4, 'the reels have their own strip');
  assert.equal(p.w.PFA_THEATRE.list().length, 8, 'and the player is given only what it can drive');
});

test('a reel plays here, on a press, and asks Instagram for nothing before it', () => {
  /* A reel cannot be driven from this page: nothing can reach inside the
     frame to seek it, time it, pause it or mute it. That is a reason to give
     it no transport bar. It is not a reason to send someone to Instagram to
     watch it, which is what the first version of this strip did. A film on
     this page plays on this page. */
  const p = theatre();
  assert.equal(p.d.querySelectorAll('#reels [data-reel]').length, 4, 'every reel has a Play control');
  assert.equal(p.$('#rboxFrame').innerHTML, '', 'and nothing is fetched from Instagram while the page is merely open');

  p.$('#reels [data-reel="0"]').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  assert.equal(p.$('#rbox').hidden, false, 'the press opens the player here');
  const frame = p.$('#rboxFrame iframe');
  assert.ok(frame, 'and builds the frame only then');
  assert.match(frame.src, /instagram\.com\/reel\/[\w-]+\/embed\//);
  assert.ok(p.$('#rboxTtl').textContent.length > 0, 'the reel is named while it plays');
  /* no way out to Instagram from the box (owner: videos and reels play
     inside the site and never send anyone to Instagram) */
  assert.equal(p.$('#rboxOut'), null, 'no Open on Instagram link');
  assert.equal(p.d.querySelectorAll('#rbox a[href*="instagram.com"]').length, 0);
});

test('closing the reel player takes the frame with it', () => {
  /* An iframe left in a hidden dialog keeps loading and keeps its cookies. */
  const p = theatre();
  p.$('#reels [data-reel="1"]').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  p.$('#rboxX').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  assert.equal(p.$('#rbox').hidden, true);
  assert.equal(p.$('#rboxFrame').innerHTML, '', 'the frame and its requests go with it');
});

test('Escape closes the reel player too', () => {
  const p = theatre();
  p.$('#reels [data-reel="2"]').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  p.d.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.$('#rbox').hidden, true);
});

test('the reel tile is not a link, so its app buttons stay inside it', () => {
  /* An <a> inside an <a> is invalid and a parser closes the outer one, which
     spilled the Android and iPhone buttons out of the tile and into a row
     under the grid. */
  const p = theatre();
  const tiles = [...p.d.querySelectorAll('#reels .reel')];
  assert.equal(tiles[0].tagName, 'DIV');
  const withApps = tiles.filter((t) => t.querySelectorAll('.vapp').length === 2);
  assert.equal(withApps.length, 1, 'exactly one reel carries app links');
  assert.equal(p.d.querySelectorAll('#reels > .vapp').length, 0, 'and none escaped the tile');
});
test('a tile opens that film in the shared player', () => {
  const p = theatre();
  p.d.querySelector('#vgrid [data-i="2"]').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  assert.equal(p.$('#theatre').hidden, false, 'the wall\'s theatre, injected by the module');
  assert.equal(p.w.PFA_THEATRE.current(), 2);
});

test('the features that were impossible before now come with it', () => {
  /* These exist because the player drives the film rather than embedding it,
     and they arrived the moment the page stopped carrying a copy. */
  const p = theatre();
  p.d.querySelector('#vgrid [data-i="0"]').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  for (const id of ['#thPlay', '#thSeek', '#thClock', '#thSound', '#thRateBtn', '#thShare', '#thFull', '#thStrip', '#thRule']) {
    assert.ok(p.$(id), `${id} is missing: the lookalike could not have it, this one must`);
  }
});

test('the module brings its own markup rather than the page keeping a copy', () => {
  const p = theatre();
  assert.ok(p.$('#theatre'), 'injected on mount');
  assert.ok(!/id="theatre"/.test(html), 'and absent from the page source');
});

/* --------------------------------------------------------------- quality ---
   YouTube picks a quality tier when the player initialises and will not be
   told otherwise: setPlaybackQuality became a no-op in 2019 and the vq
   parameter went with it. Neither of these forces anything. They remove two
   reasons the player has to choose low; the third, a frame drawn smaller than
   the screen, is theatre-quality.test.js. */

test('the stage is measured before the frame is built', () => {
  /* The theatre goes from display:none to visible one line earlier. An embed
     created before the browser has laid that out is an embed measured at
     nothing, and nothing is the size the lowest tier is chosen for. */
  const mod = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.js'), 'utf8');
  const open = mod.slice(mod.indexOf('function open(i, which, startAt)'));
  const shown = open.indexOf("th.hidden = false");
  const measured = open.indexOf("offsetHeight");
  const built = open.indexOf("load(i || 0");
  assert.ok(shown > -1 && measured > -1 && built > -1, 'all three steps must be in open()');
  assert.ok(shown < measured && measured < built,
    'show, then measure, then build: any other order gives YouTube a frame of no size');
});

test('nothing is asked of Google until a visitor shows interest', () => {
  /* A preconnect is a real connection. It belongs at the moment of intent,
     which loadYtApi already is, and not in the page head. */
  const mod = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.js'), 'utf8');
  assert.match(mod, /rel = 'preconnect'/, 'the handshake is warmed ahead of the first bytes');
  const api = mod.slice(mod.indexOf('function loadYtApi()'), mod.indexOf('function loadYtApi()') + 200);
  assert.match(api, /warmYouTube\(\)/, 'and only from the call that already means interest');
  assert.ok(!/rel="preconnect"/.test(html), 'never from the page head, which would contact Google on load');
});

test('the frame is never given a fixed size that would cap it', () => {
  const mod = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.js'), 'utf8');
  assert.ok(!/iframe\.width\s*=|setAttribute\('width'/.test(mod),
    'a width attribute would pin the player below the space it has');
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.css'), 'utf8');
  assert.match(css, /\.th-stage video,\.th-stage iframe\{[^}]*width:100%;height:100%/,
    'the frame fills its stage, which is the largest it can honestly be');
});
