/* With gratitude, to Rosie's Heroes (rosies-heroes.html): the owner's own
   design's script, as it moves (the words rising into place, the portrait
   drifting with the pointer and the scroll, the three photographs flying
   apart and settling, the photographs opening larger), in the site's shell.
   Owner, 27 Nov 2026: "this is exact look and feel I want..everything". */
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function splitWords(el){let index=0;const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);el.setAttribute('aria-label',el.innerText.trim().replace(/\s+/g,' '));nodes.forEach(node=>{const fragment=document.createDocumentFragment();node.textContent.split(/(\s+)/).forEach(word=>{if(!word.trim()){fragment.append(document.createTextNode(word));return}const mask=document.createElement('span');mask.className='motion-word';mask.setAttribute('aria-hidden','true');mask.style.setProperty('--word-index',index++);const inner=document.createElement('span');inner.textContent=word;mask.append(inner);fragment.append(mask)});node.replaceWith(fragment)})}
document.querySelectorAll('.gt h1,.gt .people h2,.gt .journey h2,.gt .closing h2').forEach(splitWords);
const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible','type-in','unfolded');observer.unobserve(entry.target)}}),{threshold:.13});
document.querySelectorAll('.gift-head,.gift-copy,.people-intro,.person,.gallery button,.timeline article').forEach(el=>{el.classList.add('reveal');observer.observe(el)});document.querySelectorAll('.people h2,.journey h2,.closing h2,.feature-photo').forEach(el=>observer.observe(el));
const track=document.querySelector('.hero-track'),hero=track.querySelector('.hero'),image=hero.querySelector('.hero-image'),label=hero.querySelector('.hero-label'),note=hero.querySelector('.hero-note'),scene=hero.querySelector('.gift-scene'),title=scene.querySelector('.scene-title'),credit=scene.querySelector('.scene-credit'),left=scene.querySelector('.scene-left'),right=scene.querySelector('.scene-right'),main=scene.querySelector('.scene-main');
const topRow=hero.querySelector('.gt-top');
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));const ease=n=>{n=clamp(n);return n*n*(3-2*n)};let frame=0,pointerX=0,pointerY=0,currentX=0,currentY=0;let progress=0;
function draw(){frame=0;const r=track.getBoundingClientRect();progress=clamp(-r.top/Math.max(1,track.offsetHeight-hero.offsetHeight));const exit=ease(progress/.35);const appear=ease((progress-.20)/.21);const spread=ease((progress-.30)/.30);const settle=ease((progress-.68)/.30);currentX+=(pointerX-currentX)*.07;currentY+=(pointerY-currentY)*.07;
image.style.transform=`translate3d(${currentX*10}px,${currentY*7-progress*40}px,0) scale(${1.025+progress*.13})`;image.style.filter=`brightness(${1-exit*.85}) blur(${exit*3}px)`;
label.style.opacity=1-exit;if(topRow){topRow.style.opacity=1-exit;topRow.style.visibility=exit>.98?'hidden':''}label.style.transform=`translate3d(0,${-exit*65}px,0)`;note.style.opacity=1-exit;scene.style.opacity=appear;title.style.opacity=appear;title.style.transform=`translateY(${(1-appear)*45}px)`;
const mobile=innerWidth<=850;left.style.transform=`translate(-50%,-50%) translate(${-spread*(mobile?innerWidth*.27:innerWidth*.29)}px,${40-spread*35}px) rotate(${-spread*13}deg) scale(${.65+spread*.35-settle*.12})`;right.style.transform=`translate(-50%,-50%) translate(${spread*(mobile?innerWidth*.27:innerWidth*.29)}px,${40-spread*35}px) rotate(${spread*13}deg) scale(${.65+spread*.35-settle*.12})`;left.style.opacity=right.style.opacity=1-settle*.85;
main.style.transform=`translate(-50%,-50%) translateY(${(1-appear)*130}px) rotate(${(1-spread)*8}deg) scale(${.5+spread*.4+settle*.23})`;credit.style.opacity=ease((progress-.5)/.2);credit.style.transform=`translateY(${(1-spread)*20}px)`;hero.style.setProperty('--motion-progress',progress);
if(Math.abs(pointerX-currentX)>.003||Math.abs(pointerY-currentY)>.003)requestTick()}
function requestTick(){if(!frame&&!reduced)frame=requestAnimationFrame(draw)}
if(!reduced){addEventListener('scroll',requestTick,{passive:true});addEventListener('resize',requestTick);if(matchMedia('(pointer:fine)').matches){hero.addEventListener('pointermove',e=>{pointerX=e.clientX/innerWidth-.5;pointerY=e.clientY/innerHeight-.5;requestTick()});hero.addEventListener('pointerleave',()=>{pointerX=pointerY=0;requestTick()})}requestTick();document.fonts.ready.then(requestTick)}
// Pause moving details while this page is in the background.
document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0}else requestTick()});
const dialog=document.querySelector('#lightbox');let lastFocus;document.querySelectorAll('.photo-open').forEach(button=>button.addEventListener('click',()=>{lastFocus=button;dialog.querySelector('img').src=button.dataset.image;dialog.querySelector('img').alt=button.dataset.caption;dialog.querySelector('p').textContent=button.dataset.caption;dialog.showModal();document.body.style.overflow='hidden'}));dialog.querySelector('.close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});dialog.addEventListener('close',()=>{document.body.style.overflow='';lastFocus?.focus()});

/* a word's mask lets go the moment the word has arrived (owner, 27 Nov 2026: "nothing can get clipped") */
document.addEventListener('animationend',e=>{const w=e.target.parentElement;if(w&&w.classList.contains('motion-word'))w.classList.add('done')});
document.addEventListener('transitionend',e=>{const w=e.target.parentElement;if(w&&w.classList.contains('motion-word')&&e.propertyName==='transform')w.classList.add('done')});
if(reduced)document.querySelectorAll('.motion-word').forEach(w=>w.classList.add('done'));
/* the site's menu: see-through and white over the dark, paper again over the
   people section, as CineKind's is over its wall */
(function(){const paper=document.querySelector('.gt .people'),top=document.querySelector('.gt .hero-track'),root=document.documentElement;function under(){const ann=document.querySelector('.announce'),head=document.querySelector('header.site');const line=(ann&&!ann.hidden?ann.offsetHeight:0)+(head?head.offsetHeight:0);
/* a phone keeps the site's paper app bar, as on every page */
let on=window.innerWidth>900;if(on&&paper){const r=paper.getBoundingClientRect();if(r.top<=line/2&&r.bottom>=line/2)on=false}root.classList.toggle('header-on-dark',on);root.classList.toggle('gt-solid',on&&!!top&&top.getBoundingClientRect().bottom<line+40)}
window.addEventListener('scroll',under,{passive:true});window.addEventListener('resize',under);under()})();
