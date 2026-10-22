/* ===========================================================
   EXTRACT - index.html
   home gate and PFA-world experience

   2 inline <script> block(s), in document order.
   READ-ONLY REFERENCE COPY. The live code is inside
   index.html in the UI/content zip. Edit it THERE; this file
   is a snapshot for reading and review only.
   =========================================================== */

/* ---- block 1 of 2 ---- */
document.documentElement.classList.remove('no-js');document.documentElement.classList.add('js');try{if(sessionStorage.getItem('pfa-entered'))document.documentElement.classList.add('entered')}catch(e){}

/* ---- block 2 of 2 ---- */
(function(){
  'use strict';
  var body=document.body;
  var opening=document.querySelector('[data-opening]');
  var enter=document.querySelector('[data-enter]');
  var skip=document.querySelector('[data-skip]');
  var replay=document.querySelector('[data-replay]');
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function finishOpening(){
    if(!opening)return;
    try{sessionStorage.setItem('pfa-entered','1')}catch(e){}
    opening.classList.add('is-open');
    body.classList.remove('opening-active');
    window.setTimeout(function(){opening.setAttribute('aria-hidden','true')},reduced?0:1100);
  }
  function replayOpening(){
    if(!opening)return;
    opening.classList.remove('is-open');opening.removeAttribute('aria-hidden');body.classList.add('opening-active');window.scrollTo({top:0,behavior:reduced?'auto':'smooth'});
  }
  if(document.documentElement.classList.contains('entered'))finishOpening();
  if(enter)enter.addEventListener('click',finishOpening);
  if(skip)skip.addEventListener('click',finishOpening);
  if(replay)replay.addEventListener('click',replayOpening);
  window.addEventListener('keydown',function(e){if(body.classList.contains('opening-active')&&(e.key==='Enter'||e.key==='ArrowDown'||e.key===' ')){e.preventDefault();finishOpening();}});
  window.addEventListener('wheel',function(e){if(body.classList.contains('opening-active')&&e.deltaY>10){e.preventDefault();finishOpening();}},{passive:false});

  var menu=document.querySelector('[data-mobile-menu]');
  var menuOpen=document.querySelector('[data-menu-open]');
  var menuClose=document.querySelector('[data-menu-close]');
  function setMenu(open){if(!menu)return;menu.classList.toggle('open',open);menu.setAttribute('aria-hidden',String(!open));body.classList.toggle('menu-open',open);if(menuOpen)menuOpen.setAttribute('aria-expanded',String(open));}
  if(menuOpen)menuOpen.addEventListener('click',function(){setMenu(true)});
  if(menuClose)menuClose.addEventListener('click',function(){setMenu(false)});
  if(menu)menu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setMenu(false)})});

  var overlay=document.querySelector('[data-search-overlay]');
  var searchOpen=document.querySelector('[data-search-open]');
  var searchClose=document.querySelector('[data-search-close]');
  var searchInput=document.querySelector('[data-search-input]');
  var searchResults=document.querySelector('[data-search-results]');
  var items=[
    ['Help and contacts','help.html','PFA local contacts by state, nearest first, and what not to do while you find a vet.','Help'],
    ['Contacts','network.html','Find a PFA local contact.','Contacts'],
    ['Stories','stories.html','Rescue, recovery and the people behind the work.','Explore'],
    ['The Wire','dispatch.html','Verified public animal welfare records.','Public record'],
    ['Learning Center','learning-center.html','Emergency guidance and animal care.','Learn'],
    ['Adopt','adopt.html','Meet animals ready for a safe home.','Act'],
    ['The PFA Store','store.html','Useful purchases that support the work.','Shop'],
    ['Become a Patron','membership.html','Join PFA for one rupee a day.','Membership'],
    ['Get involved','get-involved.html','Give time, skill or practical support.','Volunteer']
  ];
  function renderSearch(q){
    q=(q||'').trim().toLowerCase();
    var matches=items.filter(function(x){return !q||x.join(' ').toLowerCase().indexOf(q)>-1});
    searchResults.innerHTML=matches.length?matches.map(function(x){return '<a class="search-result" href="'+x[1]+'"><small>'+x[3]+'</small><div><strong>'+x[0]+'</strong><p>'+x[2]+'</p></div><span>↗</span></a>'}).join(''):'<div class="search-empty">No matching PFA destination found.</div>';
  }
  function setSearch(open){if(!overlay)return;overlay.classList.toggle('open',open);body.classList.toggle('search-open',open);if(open){renderSearch('');window.setTimeout(function(){searchInput.focus()},20)}}
  if(searchOpen)searchOpen.addEventListener('click',function(){setSearch(true)});
  if(searchClose)searchClose.addEventListener('click',function(){setSearch(false)});
  if(searchInput)searchInput.addEventListener('input',function(){renderSearch(searchInput.value)});

  document.querySelectorAll('.door-toggle').forEach(function(button){button.addEventListener('click',function(){var card=button.closest('.door-card');var open=!card.classList.contains('open');document.querySelectorAll('.door-card.open').forEach(function(c){if(c!==card){c.classList.remove('open');var b=c.querySelector('.door-toggle');if(b)b.setAttribute('aria-expanded','false')}});card.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open));});});

  var reveals=document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window&&!reduced){var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target)}})},{threshold:.1,rootMargin:'0px 0px -6% 0px'});reveals.forEach(function(el){observer.observe(el)});}else{reveals.forEach(function(el){el.classList.add('visible')});}

  document.addEventListener('keydown',function(e){if(e.key==='Escape'){setMenu(false);setSearch(false)}});
})();

