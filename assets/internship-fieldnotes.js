/* The remote internship's field notes (owner, 1 Nov 2026: "this is how the
   internship page should be", internship-process.html, exactly): how the
   internship works first; Continue shows the five mandatory tasks and the
   seven optional ones in their own lanes; a card opens its task in the
   reader under its lane. The photographs and the tasks are the page's own
   JSON (#v-data, #lane-data). */
(()=>{const c=document.getElementById('pfa-official-dark'),ctx=c.getContext('2d'),im=new Image();im.onload=()=>{c.width=im.width;c.height=im.height;ctx.drawImage(im,0,0);const z=ctx.getImageData(0,0,c.width,c.height),a=z.data;for(let y=Math.round(c.height*.85);y<c.height;y++)for(let x=0;x<c.width;x++){const j=(y*c.width+x)*4;a[j]=a[j+1]=a[j+2]=255}ctx.putImageData(z,0,0)};im.src='media/internship/field-notes/pfa-logo-dark.png';})();
(()=>{'use strict';const root=document.querySelector('#collection'),intro=document.querySelector('#internship-process'),lanes=document.querySelector('#task-lanes'),tasks=JSON.parse(document.querySelector('#lane-data').textContent),photos=JSON.parse(document.querySelector('#v-data').textContent),reader=document.querySelector('#v-reader'),next=document.querySelector('#process-continue'),back=document.querySelector('#back-process');let openedBy=null;const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
root.querySelectorAll('img[data-photo]').forEach(im=>{im.src=photos[Number(im.dataset.photo)].img;im.loading='lazy';im.decoding='async'});
function scrollTop(){root.scrollIntoView({behavior:reduce?'instant':'smooth',block:'start'})}next.addEventListener('click',()=>{intro.hidden=true;lanes.hidden=false;scrollTop();back.focus({preventScroll:true})});back.addEventListener('click',()=>{if(reader.open)reader.close();lanes.hidden=true;intro.hidden=false;scrollTop();next.focus({preventScroll:true})});root.querySelectorAll('.lane-controls button').forEach(b=>b.addEventListener('click',()=>{const track=b.closest('.task-lane').querySelector('.lane-track');track.scrollBy({left:Number(b.dataset.step)*(track.querySelector('.lane-card').offsetWidth+24),behavior:reduce?'instant':'smooth'})}));
root.querySelectorAll('.lane-card').forEach(b=>b.addEventListener('click',()=>{openedBy=b;const t=tasks[Number(b.dataset.taskIndex)],p=photos[t.photo];reader.querySelector('.v-readhead span').textContent=t.label+' / PFA INTERNSHIP';reader.querySelector('.v-readtext').innerHTML='<h2>'+t.title+'</h2>'+t.body;reader.querySelector('.v-readimg img').src=p.img;reader.querySelector('.v-readimg img').alt=p.alt;b.closest('.task-lane').append(reader);if(!reader.open)reader.show();reader.scrollIntoView({behavior:reduce?'instant':'smooth',block:'start'})}));reader.querySelector('.v-readclose').onclick=()=>reader.close();reader.addEventListener('close',()=>{document.body.style.overflow='';openedBy?.focus({preventScroll:true})});reader.addEventListener('click',e=>{if(e.target===reader||e.target.closest('a[href^="#"]'))reader.close()});new IntersectionObserver(es=>document.body.classList.toggle('v-mode',es[0].isIntersecting),{threshold:.1}).observe(root);root.querySelector('.v-home').onclick=()=>document.querySelector('#top').scrollIntoView({behavior:reduce?'instant':'smooth'});root.querySelector('.v-time').textContent='REMOTE INTERNSHIP';})();

/* The sample certificate (2 Nov 2026: "where is that cool certificate on the
   internship page? the sample preview one"): under step 04 when asked for,
   drawn in its blue by assets/certificate.js, marked SAMPLE, dated as if
   the reader began today, with their name on it as they type. */
(function () {
  'use strict';
  var C = window.PFACertificate;
  var peek = document.querySelector('.cert-peek');
  var box = document.getElementById('cert-sample');
  if (!peek || !box) return;
  if (!C) { peek.hidden = true; return; }
  var canvas = box.querySelector('.vi-cert__canvas');
  var input = box.querySelector('.vi-try');
  var iso = function (d) { return d.toISOString().slice(0, 10); };
  var start = new Date();
  var end = new Date(start.getTime() + 55 * 864e5);
  var paint = function () {
    C.draw(canvas, { name: (input.value || '').trim(), startDate: iso(start), endDate: iso(end), issuedOn: iso(end), sample: true }, 1);
  };
  var drawn = false;
  input.addEventListener('input', paint);
  peek.addEventListener('click', function () {
    var open = box.hidden;
    box.hidden = !open;
    peek.setAttribute('aria-expanded', String(open));
    peek.textContent = open ? 'Hide the sample' : 'See a sample certificate';
    if (!open) return;
    if (!drawn) { drawn = true; paint(); C.load().then(paint, paint); }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  });
})();
