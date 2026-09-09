import { initDriftNavigation, initSignalLibrary } from './scenes/signals';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { ENV, DEV, $, $$ } from './lib/state';
import { initHero, heroIntro } from './scenes/hero';
import { initManifesto } from './scenes/manifesto';
import { initCore } from './scenes/core';

gsap.registerPlugin(ScrollTrigger);

// ── smooth scroll ──
let lenis: Lenis | null = null;
if (!ENV.reduced) {
  lenis = new Lenis({ lerp: 0.105, wheelMultiplier: 1.02 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

// ── anchor navigation ──
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href');
  if (!id || id === '#') return;
  const target = document.querySelector(id);
  if (!target) return;
  e.preventDefault();
  if (lenis) {
    lenis.scrollTo(target as HTMLElement, { offset: -90, duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
  } else {
    (target as HTMLElement).scrollIntoView();
  }
});

// ── chrome: nav state and scroll progress ──
function initChrome() {
  const navProgress = $('#nav-progress');
  ScrollTrigger.create({
    start: 0,
    end: () => ScrollTrigger.maxScroll(window),
    onUpdate: (self) => {
      navProgress?.style.setProperty('transform', `scaleX(${self.progress})`);
      document.body.classList.toggle('scrolled', self.scroll() > 40);
    },
  });
}

// ── generic reveals ──
function initReveals() {
  if (ENV.reduced) {
    $$('[data-reveal]').forEach((el) => {
      (el as HTMLElement).style.opacity = '1';
      (el as HTMLElement).style.transform = 'none';
    });
    return;
  }
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 88%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.09 }),
  });
}

// ── assemble ──
async function start() {
  initHero();
  initManifesto();
  initSignalLibrary();
  initDriftNavigation();
  const year = $('#footer-year');
  if (year) year.textContent = String(new Date().getFullYear());
  initCore();
  initChrome();
  initReveals();

  // Wait for typography, but let slow font hosts fall back to system fonts.
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 1800);
    document.fonts.ready.then(() => { clearTimeout(timeout); resolve(); });
  });
  // Allow styles and layout to settle before revealing the page.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  window.dispatchEvent(new Event('drift:ready'));
  heroIntro();
  ScrollTrigger.refresh();
  applyDevScroll();

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/** dev-only hooks for visual QA: ?scroll=2400 | ?scroll=#library | ?p=0.5 */
function applyDevScroll() {
  if (!DEV.scroll && DEV.p === null) return;

  const compute = (): number | null => {
    if (DEV.p !== null) return parseFloat(DEV.p) * ScrollTrigger.maxScroll(window);
    if (!DEV.scroll) return null;
    if (DEV.scroll.startsWith('#')) {
      const el = document.querySelector(DEV.scroll) as HTMLElement | null;
      return el ? el.getBoundingClientRect().top + window.scrollY : null;
    }
    return parseInt(DEV.scroll, 10);
  };

  // re-apply across late layout shifts (fonts, pin setup) so the position sticks
  const apply = () => {
    const target = compute();
    if (target === null || Number.isNaN(target)) return;
    lenis?.scrollTo(target, { immediate: true, force: true });
    window.scrollTo(0, target);
    ScrollTrigger.update();
  };
  apply();
  requestAnimationFrame(apply);
  requestAnimationFrame(() => requestAnimationFrame(apply));
  setTimeout(apply, 300);
  setTimeout(apply, 900);
  setTimeout(apply, 1800);
}

start().catch((error: unknown) => {
  console.error('DRIFT could not initialize.', error);
  window.dispatchEvent(new Event('drift:error'));
});
