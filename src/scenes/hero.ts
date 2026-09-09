import gsap from 'gsap';
import { ENV } from '../lib/state';
import { initSignalLandscape } from './signals';

/** Cultural landscape and editorial headline entrance. */
export function initHero() {
  initSignalLandscape();
}

export function heroIntro() {
  const items = gsap.utils.toArray<HTMLElement>('[data-intro]');
  if (ENV.reduced) {
    gsap.set('.hero__line-in', { y: 0 });
    gsap.set(items, { opacity: 1 });
    return;
  }
  gsap.set(items, { opacity: 0, y: 26 });
  const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
  tl.to('.hero__line-in', { y: 0, duration: 1.35, stagger: 0.12 }, 0.1)
    .to(items, { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, 0.4);
}
