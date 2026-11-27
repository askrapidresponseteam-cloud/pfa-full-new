/* Partners in giving (partners.html): the owner's second thank-you design to
   Rosie's Heroes (27 Nov 2026), its own script adapted to the site's shell.
   The opening's photographs gather as the page scrolls, the founder's
   portrait opens out, the team's portraits move as a rail, and the closing
   photograph drifts. The site's header runs see-through over the dark parts
   on a computer; on a phone the app bar stays. */
(()=>{'use strict';
const root=document.querySelector('.pt');if(!root)return;
document.documentElement.classList.add('pt-js');
const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
const mobile=matchMedia('(max-width:600px)');
for(const el of root.querySelectorAll('[data-split]')){{const c=el.cloneNode(true);c.querySelectorAll('br').forEach(x=>x.replaceWith(' '));el.setAttribute('aria-label',c.textContent.replace(/\s+/g,' ').trim())}let i=0;const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes){const frag=document.createDocumentFragment();node.textContent.split(/(\s+)/).forEach(word=>{if(!word.trim()){frag.append(document.createTextNode(word));return}const wrap=document.createElement('span'),inner=document.createElement('span');wrap.className='motion-word';wrap.setAttribute('aria-hidden','true');wrap.style.setProperty('--i',i++);inner.textContent=word;
/* the mask lets go once the word has arrived, so no letter is ever cut */
inner.addEventListener('transitionend',()=>wrap.classList.add('done'),{once:true});
wrap.append(inner);frag.append(wrap)});node.replaceWith(frag)}}
if(reduced)root.querySelectorAll('.motion-word').forEach(w=>w.classList.add('done'));
const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});root.querySelectorAll('[data-split],.reveal').forEach(el=>io.observe(el));
const $=s=>root.querySelector(s),clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x)},mix=(a,b,t)=>a+(b-a)*t;
const opening=$('.opening'),hero=$('.hero'),image=$('.hero-image'),label=$('.hero-label'),note=$('.hero-note'),chapters=$('.chapter-nav'),scene=$('.gift-scene'),title=$('.scene-title'),credit=$('.scene-credit'),left=$('.scene-left'),right=$('.scene-right'),main=$('.scene-main'),ftrack=$('.founder-track'),founder=$('.founder'),fimage=$('.founder-image'),fcopy=$('.founder-copy'),fcaption=$('.founder-caption'),gradient=$('.founder-gradient'),closing=$('.closing'),endPhoto=$('.closing-photo');
const html=document.documentElement,site=document.querySelector('header.site');
let raf=0,px=0,py=0,cx=0,cy=0;
function draw(){raf=0;const vh=innerHeight,w=innerWidth;const top=opening.getBoundingClientRect();const p=clamp(-top.top/Math.max(1,opening.offsetHeight-hero.offsetHeight));const fade=smooth((p-.08)/.34),arrive=smooth((p-.2)/.5),spread=smooth((p-.35)/.5);cx+=(px-cx)*.07;cy+=(py-cy)*.07;
if(!reduced){image.style.transform=`translate3d(${cx*10}px,${cy*7-p*35}px,0) scale(${1.02+p*.12})`;image.style.opacity=1-fade;label.style.opacity=note.style.opacity=chapters.style.opacity=1-fade;label.style.transform=`translateY(${-fade*65}px)`;chapters.style.visibility=fade>.99?'hidden':'';scene.style.opacity=smooth((p-.18)/.28);title.style.transform=`translateY(${40*(1-arrive)}px)`;credit.style.opacity=smooth((p-.65)/.25);const small=w<=850;left.style.transform=`translate(-50%,-50%) translate(${-spread*w*(small?.24:.29)}px,${mix(100,15,arrive)}px) rotate(${-spread*12}deg) scale(${mix(.5,1,arrive)})`;right.style.transform=`translate(-50%,-50%) translate(${spread*w*(small?.24:.29)}px,${mix(100,15,arrive)}px) rotate(${spread*12}deg) scale(${mix(.5,1,arrive)})`;main.style.transform=`translate(-50%,-50%) translateY(${mix(160,0,arrive)}px) rotate(${mix(9,0,arrive)}deg) scale(${mix(.5,1,arrive)})`;hero.style.setProperty('--pt-progress',p);
if(!mobile.matches){const stick=parseFloat(getComputedStyle(founder).top)||0;const fp=smooth((stick-ftrack.getBoundingClientRect().top)/Math.max(1,ftrack.offsetHeight-founder.offsetHeight));/* the words never meet the opening photograph: the copy fades by the real
   distance from the photograph's edge to its last letter, and the caption
   shows only once that edge has passed it (review of 27 Nov 2026) */
const fw=founder.clientWidth,iwp=mix(w<=850?50:53,100,fp),irp=mix(w<=850?0:w*.04,0,fp),il=fw-fw*iwp/100-irp;
fimage.style.top=mix(7,0,fp)+'%';fimage.style.height=mix(86,100,fp)+'%';fimage.style.width=iwp+'%';fimage.style.right=irp+'px';
const fb=founder.getBoundingClientRect().left,cR=textRight(fcopy)-fb+fp*70,capL=fcaption.offsetLeft;
fcopy.style.opacity=Math.min(1-smooth(fp/.65),clamp((il-cR)/48));fcopy.style.transform=`translateX(${-fp*70}px)`;
fcaption.style.opacity=Math.min(smooth((fp-.8)/.2),clamp((capL-il)/24));gradient.style.opacity=smooth((fp-.4)/.4)}else{fimage.removeAttribute('style');fcopy.removeAttribute('style')}
const cr=closing.getBoundingClientRect();if(cr.top<vh&&cr.bottom>0)endPhoto.style.transform=`scale(1.07) translateY(${(cr.top/vh)*-20}px)`}
/* the site's menu: see-through and white over the dark opening and the
   closing photograph, on a computer only; paper everywhere else */
/* see-through only while the dark opening lies under the whole header: never half over the paper below it, never over the bright closing photograph (27 Nov 2026: "contrast is fucked") */
if(site){const hb=site.getBoundingClientRect().bottom;const r=opening.getBoundingClientRect();const on=innerWidth>900&&r.top<=0&&r.bottom>=hb+2;html.classList.toggle('header-on-dark',on);
/* once the ambulance photographs move under it, the menu takes the scene's own dark behind it */
const pr=clamp(-r.top/Math.max(1,opening.offsetHeight-hero.offsetHeight));html.classList.toggle('pt-solid',on&&pr>.12)}
if(Math.abs(cx-px)>.005||Math.abs(cy-py)>.005)tick()}
function textRight(el){let r=0;const tw=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),rg=document.createRange();while(tw.nextNode()){if(!tw.currentNode.textContent.trim())continue;rg.selectNodeContents(tw.currentNode);for(const b of rg.getClientRects())if(b.right>r)r=b.right}return r}
function tick(){if(!raf)raf=requestAnimationFrame(draw)}
addEventListener('scroll',tick,{passive:true});addEventListener('resize',()=>{tick();updateRail()});
if(!reduced&&matchMedia('(pointer:fine)').matches){hero.addEventListener('pointermove',e=>{px=e.clientX/innerWidth-.5;py=e.clientY/innerHeight-.5;tick()});hero.addEventListener('pointerleave',()=>{px=py=0;tick()})}
document.fonts.ready.then(tick);tick();
const rail=$('.team-rail'),prev=$('#previous'),next=$('#next'),status=$('.rail-status');
const two=n=>String(n).padStart(2,'0');
/* the ends are marked, not disabled, so focus is never lost; the status is said once a move settles */
let said=0;const ends=(button,off)=>{button.setAttribute('aria-disabled',off?'true':'false');button.classList.toggle('is-end',off)};
function updateRail(){const cards=[...rail.children],r=rail.getBoundingClientRect(),visible=cards.map((c,i)=>({i,box:c.getBoundingClientRect()})).filter(c=>c.box.right>r.left+40&&c.box.left<r.right-40);ends(prev,rail.scrollLeft<5);ends(next,rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-5);if(!visible.length)return;const a=visible[0].i+1,b=visible[visible.length-1].i+1,text=(a===b?two(a):two(a)+'-'+two(b))+' / '+two(cards.length);clearTimeout(said);said=setTimeout(()=>{if(status.textContent!==text)status.textContent=text},180)}
const move=direction=>{const gap=parseFloat(getComputedStyle(rail).columnGap)||22;rail.scrollBy({left:direction*(rail.children[0].offsetWidth+gap),behavior:reduced?'instant':'smooth'})};
prev.addEventListener('click',()=>{if(prev.getAttribute('aria-disabled')!=='true')move(-1)});next.addEventListener('click',()=>{if(next.getAttribute('aria-disabled')!=='true')move(1)});rail.addEventListener('scroll',updateRail,{passive:true});
rail.addEventListener('keydown',e=>{if(e.target!==rail)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move(e.key==='ArrowRight'?1:-1)}});
updateRail();
const dialog=$('#portrait-dialog');let trigger;
root.querySelectorAll('.photo-open').forEach(button=>button.addEventListener('click',()=>{trigger=button;const img=button.querySelector('img');dialog.querySelector('img').src=img.src;dialog.querySelector('img').alt=img.alt;dialog.querySelector('p').textContent=button.dataset.caption;dialog.showModal()}));
dialog.querySelector('.close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});dialog.addEventListener('close',()=>{if(trigger)trigger.focus()});
})();
