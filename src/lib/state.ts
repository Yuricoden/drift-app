export const ENV = {
  reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const params = new URLSearchParams(window.location.search);

export const DEV = {
  /** px number, css selector, or 0..1 fraction via ?p= */
  scroll: params.get('scroll'),
  p: params.get('p'),
};

if (ENV.reduced) {
  document.documentElement.classList.add('no-motion');
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));
