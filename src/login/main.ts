/** Login page: server-validated credentials, then route by onboarding state. */
const form = document.querySelector<HTMLFormElement>('#login-form')!;
const emailInput = document.querySelector<HTMLInputElement>('#login-email')!;
const passwordInput = document.querySelector<HTMLInputElement>('#login-password')!;
const note = document.querySelector<HTMLParagraphElement>('#login-note')!;
const submit = document.querySelector<HTMLButtonElement>('.login__submit')!;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  note.textContent = '';
  form.classList.remove('is-error');

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    fail('Enter both your email and password.');
    return;
  }

  submit.disabled = true;
  submit.querySelector('.btn__text')!.textContent = 'Checking…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      fail(data.error ?? 'Those credentials do not match the DRIFT account.');
      return;
    }
    const data = (await res.json()) as { onboardingCompleted: boolean };
    window.location.href = data.onboardingCompleted ? '/app/discover' : '/onboarding';
  } catch {
    fail('Could not reach the DRIFT server. Is it running?');
  } finally {
    submit.disabled = false;
    submit.querySelector('.btn__text')!.textContent = 'Enter DRIFT';
  }
});

function fail(message: string): void {
  note.textContent = message;
  form.classList.remove('is-error');
  void form.offsetWidth; // restart the shake animation
  form.classList.add('is-error');
  passwordInput.focus();
}
