import gsap from 'gsap';
import { ENV, $ } from '../lib/state';
import { splitWords } from '../lib/split';

/** Manifesto: word-by-word scroll reveal. */
export function initManifesto() {
  const text = $('#manifesto-text');
  if (text) {
    const words = splitWords(text);
    if (!ENV.reduced) {
      gsap.to(words, {
        opacity: 1,
        stagger: 0.06,
        ease: 'none',
        scrollTrigger: {
          trigger: '.manifesto',
          start: 'top 72%',
          end: 'center 42%',
          scrub: 0.5,
        },
      });
    } else {
      gsap.set(words, { opacity: 1 });
    }
  }
}
