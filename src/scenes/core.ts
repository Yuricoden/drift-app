import gsap from 'gsap';
import { ENV, $ } from '../lib/state';

/** Access invitation: title reveal and local interest form. */
export function initCore() {
  // title lines
  if (!ENV.reduced) {
    gsap.to('.core__line-in', {
      y: 0,
      duration: 1.2,
      stagger: 0.12,
      ease: 'power4.out',
      scrollTrigger: { trigger: '.core__title', start: 'top 82%', once: true },
    });
  } else {
    gsap.set('.core__line-in', { y: 0 });
  }

  initForm();
}

function initForm() {
  const form = $('#access-form');
  const input = $('#access-email') as HTMLInputElement | null;
  const note = $('#form-note');
  if (!form || !input || !note) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = input.value.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val);
    if (!valid) {
      form.classList.remove('is-error');
      void form.offsetWidth; // restart shake
      form.classList.add('is-error');
      note.textContent = 'Please enter a valid email address.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      note.classList.remove('is-ok');
      return;
    }
    input.removeAttribute('aria-invalid');
    try {
      localStorage.setItem('drift-interest', JSON.stringify({ email: val, savedAt: new Date().toISOString() }));
      form.classList.remove('is-error');
      note.textContent = 'Your interest is saved on this device. This preview does not send your email.';
      note.classList.add('is-ok');
    } catch {
      note.textContent = 'This browser could not save your interest. Please allow local storage and try again.';
    }
  });
}
