import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ENV, $, $$ } from '../lib/state';
import { SIGNALS, SIGNAL_FILTERS } from '../content/signals';

export function initSignalLandscape() {
  const landscape = $('#signal-landscape');
  if (!landscape) return;
  const nodes = $$<HTMLButtonElement>('[data-signal]');
  const caption = $('#landscape-caption')!;
  nodes.forEach(node => node.addEventListener('click', () => {
    const index = Number(node.dataset.signal);
    nodes.forEach(n => {
      n.classList.toggle('is-active', n === node);
      n.setAttribute('aria-pressed', String(n === node));
    });
    $$<SVGElement & HTMLElement>('[data-connection]').forEach(path => {
      path.style.opacity = path.dataset.connection === String(index) ? '1' : '.2';
      path.style.strokeWidth = path.dataset.connection === String(index) ? '2' : '1';
    });
    caption.textContent = SIGNALS[index].caption;
    if (!ENV.reduced) gsap.fromTo(caption, { opacity: .2, y: 4 }, { opacity: 1, y: 0, duration: .4, overwrite: true });
  }));
  const toggle = $('.motion-toggle')!;
  let paused = ENV.reduced;
  toggle.hidden = ENV.reduced;
  let parallax: gsap.core.Tween | undefined;
  const updateMotion = () => {
    landscape.classList.toggle('is-paused', paused);
    if (paused) parallax?.scrollTrigger?.disable(false);
    else parallax?.scrollTrigger?.enable();
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Resume landscape animation' : 'Pause landscape animation');
    toggle.textContent = paused ? '▷' : 'Ⅱ';
  };
  updateMotion();
  toggle.addEventListener('click', () => { paused = !paused; updateMotion(); });
  if (!ENV.reduced) {
    parallax = gsap.to('.landscape__lines', { rotate: 8, y: 30, ease: 'none', scrollTrigger: { trigger: '#surface', start: 'top top', end: 'bottom top', scrub: 1 } });
  }
}

export function initSignalLibrary() {
  const grid = $('#library-grid')!;
  const filters = $('#library-filters')!;
  const dialog = $('#signal-dialog') as HTMLDialogElement;
  const detail = $('#signal-dialog-content')!;
  let opener: HTMLElement | null = null;
  const close = () => dialog.close();
  $('.signal-dialog__close')!.addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  dialog.addEventListener('close', () => opener?.focus());
  function openSignal(index: number, button: HTMLElement) {
    const s = SIGNALS[index];
    opener = button;
    detail.innerHTML = `<div class="signal-dialog__art art-${s.art}" aria-hidden="true"><span></span></div><div class="signal-dialog__body"><p class="mono">Illustrative signal S—${s.id} / ${s.route}</p><h2 id="signal-dialog-title">${s.title}</h2><p class="signal-dialog__intro">${s.blurb}</p><h3>The observation</h3><p>${s.observation}</p><h3>The connection</h3><p>${s.connection}</p><h3>A possible direction</h3><p>${s.opportunity}</p><a class="hero__text-link" href="/app/discover">Explore with DRIFT ↗</a></div>`;
    detail.querySelector('a')!.addEventListener('click', close);
    dialog.showModal();
    dialog.scrollTop = 0;
  }
  SIGNALS.forEach((s, index) => {
    const card = document.createElement('article');
    card.className = 'signal-story';
    card.dataset.index = String(index);
    card.innerHTML = `<button class="signal-story__image art-${s.art}" aria-label="Read ${s.title}"><span class="art-object"></span><span class="signal-story__serial mono">FIELD NOTE / ${s.id}</span><span class="signal-story__image-arrow">↗</span></button><div class="signal-story__meta mono"><span>${s.route}</span><span class="signal-story__dot"></span></div><h3><button class="signal-story__title">${s.title}</button></h3><p>${s.blurb}</p><div class="signal-story__foot mono"><span>${s.stage}</span><button aria-label="Read ${s.title}">Read the signal ↗</button></div>`;
    card.querySelectorAll('button').forEach(button => button.addEventListener('click', () => openSignal(index, button)));
    grid.append(card);
  });
  SIGNAL_FILTERS.forEach((filter, index) => {
    const button = document.createElement('button');
    button.className = 'chip' + (index === 0 ? ' is-active' : '');
    button.setAttribute('aria-pressed', String(index === 0));
    button.textContent = filter;
    button.addEventListener('click', () => {
      filters.querySelectorAll('button').forEach(b => { b.classList.toggle('is-active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
      const cards = $$<HTMLElement>('.signal-story');
      cards.forEach(card => { card.hidden = index !== 0 && !SIGNALS[Number(card.dataset.index)].domains.includes(filter); });
      const visible = cards.filter(c => !c.hidden);
      $('#signal-count')!.textContent = `${String(visible.length).padStart(2, '0')} ${visible.length === 1 ? 'SIGNAL' : 'SIGNALS'}`;
      if (!ENV.reduced) gsap.fromTo(visible, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .4, stagger: .06, overwrite: true, clearProps: 'all' });
      ScrollTrigger.refresh();
    });
    filters.append(button);
  });
}

export function initDriftNavigation() {
  const menu = $('.nav__menu')!;
  const nav = $('#primary-nav')!;
  const setOpen = (open: boolean) => {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    nav.classList.toggle('is-open', open);
  };
  menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { setOpen(false); menu.focus(); } });
  document.addEventListener('click', e => { if (!(e.target as Element).closest('#nav')) setOpen(false); });
}
