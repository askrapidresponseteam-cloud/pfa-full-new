# CineKind media - what is here, what is missing, and where it should come from

`cinekind.html` asks for ten local files that are not in this tree: seven
honouree portraits and three videos. Until they arrive, the page shows those
cards set in type, without photographs, and never a grey box. Run
`npm run check:media` at any time to see the current list.

Drop the files in at exactly these paths and nothing else needs changing.

## Honouree portraits

`media/cinekind-2025/<file>` - portrait, 720px wide or larger, `.webp`. The
tiles are 3:4 and crop from near the top (`object-position: 50% 14%`), so a
face in the upper third survives every screen size.

### Present (v1.356)

| File | Honouree | Where it came from |
| --- | --- | --- |
| `nirmal.webp` | Nirmal Verma | Supplied inside the page on 16 Sep 2026 (the CineKind step-and-repeat) |
| `nitin.webp` | Nitin Vemupati | Supplied inside the page on 16 Sep 2026 (the Kooran trailer launch) |
| `ashish.webp` | Ashish Goswami | Supplied inside the page on 16 Sep 2026 (with a rescued green pigeon) |

These three arrived as base64 inside `cinekind.html`, 4.5 MB of it, which is
what `test/page-weight.test.js` exists to refuse. They are real files now,
sized for the tile at twice its largest rendering.

### Missing

| File | Honouree | Link on the page |
| --- | --- | --- |
| `harsha.webp` | Dr Harsha Atmakuri | maakadoodh.in |
| `dolly.webp` | Dolly Vyas Ahuja | Times of India |
| `rupali.webp` | Rupali Ganguly | Times of India |
| `kushagra.webp` | Kushagra Dixit | Times of India |
| `pooja.webp` | Pooja Bhatt | Filmfare |
| `sandhya.webp` | Dr Sandhya Sekar | Mongabay India |
| `mohit.webp` | Mohit Chauhan | Times of India |

**Those links are citations, not photo sources.** They are there to show why
each person was honoured. The photographs on those pages belong to those
publications and their photographers, and PFA has no licence on record to
republish them. Copying or hot-linking them onto this site would be
infringement, and Times of India in particular pursues it.

### The photographs the 16 Sep 2026 page hot-linked

The page supplied on 16 Sep 2026 pointed these seven tiles straight at other
sites. v1.356 points them back at the local files above, for three reasons:
the rights question above; `vercel.json`'s Content-Security-Policy names none
of these hosts, so the day it is enforced every one of them goes blank
(`test/security-headers.test.js` stops the build on exactly this); and two of
them were going to break on their own. The LinkedIn address is signed and
expires on 8 October 2026, and a profile picture's address changes whenever
its owner changes the picture.

They are kept here so the choice of picture is not lost. If PFA holds
permission for one, download it, crop it to the size above, save it under
the file name in the table, and the tile picks it up.

| File | Address the page used |
| --- | --- |
| `harsha.webp` | https://pbs.twimg.com/profile_images/1554316024148795392/t-02LWJs_400x400.jpg |
| `dolly.webp` | https://cdn.shoutouthtx.com/wp-content/uploads/2025/04/c-1738515458127-personal_1738515457221_1738515457221_dolly_vyasahuja_dolly-vyas-ahuja_front.png |
| `rupali.webp` | https://d3lzcn6mbbadaf.cloudfront.net/media/details/ANI-20260807130030.jpg (an ANI agency photograph) |
| `kushagra.webp` | https://media.licdn.com/dms/image/v2/D5622AQH4jzQ5SSnwwA/feedshare-shrink_1280/B56ZtBHqfmLAAs-/0/1766324093067?e=1791417600&v=beta&t=mjfHkCkqH0gkS7ZlRdVFMXMnDPLKQt9KYhIf8hm74p0 (signed: `e=1791417600` is 8 Oct 2026, after which it answers with an error) |
| `pooja.webp` | https://filmfare.wwmindia.com/content/2025/jul/pooja-bhatt-to-host-talk-show.jpg |
| `sandhya.webp` | https://mongabay.org/wp-content/uploads/2024/11/IMG_20250415_180434-Sandhya-Sekar.jpg |
| `mohit.webp` | https://media5.bollywoodhungama.in/wp-content/uploads/2016/05/433826547.jpg |

Three ways to fill these in properly, best first:

1. **Ask the honourees.** Each was given an award by PFA; a portrait they are
   happy for PFA to use is usually one email. This also gets a better
   photograph than a news crop.
2. **Use the ceremony photographs.** The Film Federation of India's CineKind
   set covers the evening the awards were presented, and PFA is co-presenter,
   so the rights question is answerable rather than hopeless. See below.
3. **Licence them.** Each publication sells reuse rights.

## Ceremony photographs (the Federation's set)

The film strip at the 2025 gate, the ceremony mosaic and the trophy frame use
the Film Federation of India's own CineKind photographs, credited on the page
with a link to `filmfederation.in/events.php`.

In this tree the page asks for them at `https://filmfederation.in/images/events/cinekind/<n>.jpg`,
a host the Content-Security-Policy names, with `referrerpolicy="no-referrer"`.
`DEPLOY.command` runs `node scripts/fetch-cinekind-media.js --rewrite`, which
downloads the whole set into `media/cinekind-2025/ffi/` and points the page at
the local copies, but only if every file arrived: a local path to a file that
is not there fails as silently as a hot-link does. The page supplied on
16 Sep 2026 had already been rewritten on a machine that held those files,
so it asked for thirteen `ffi/` files this tree does not carry; v1.356 puts
the Federation's addresses back so the tree works as it stands.

## Ceremony videos

`media/cinekind-elephant.mp4`, `media/cinekind-langur.mp4`,
`media/cinekind-lion.mp4` - short silent loops, muted and autoplaying, used as
a decorative strip. Any short PFA-owned footage works; they are not captioned
and carry `aria-hidden`, so nothing depends on what is in them.

If PFA does not have them, delete that strip from `cinekind.html` rather than
leaving three empty frames.

## The ten honours, 6 Nov 2026

Owner: "ensure you find images for all the people named here and they have
to render the same way. not like some with edges and some not".

Every tile has a photograph now. Kushagra Dixit's is the portrait on his
Times of India author page
(`https://timesofindia.indiatimes.com/authorphoto/479256218.cms?len=207224`);
the LinkedIn address had expired. Each `<img>` carries `class="cut"`, the
photograph's own size in `data-size`, and a 3:4 cut measured on it
(`--cx`, `--cy`, `--cw`, `--ch`, fractions of the photograph). The cuts leave
out only background and the borders two sources print around the portrait
(Dolly Vyas Ahuja's poster frame and name, the white bands either side of
Rupali Ganguly's), never a head. `test/cinekind-honours-cut.test.js` holds
every cut to 3:4 and inside its photograph. Swapping a photograph means
measuring its new cut; a local file under the names above still works the
same way.
