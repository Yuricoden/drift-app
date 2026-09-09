import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api } from '../api';
import { useSession } from '../store';
import { Chip } from '../components/ui';
import { useTrends } from '../trends';

const EXPLORING = ['Consumer Behavior', 'Technology', 'Fashion', 'Media', 'Travel', 'Design', 'Startups', 'Finance'];
const PURPOSES = ['Find startup ideas', 'Track cultural shifts', 'Brand strategy', 'Product research', 'Investment research', 'Creative inspiration'];
const INTERESTS = ['AI', 'Gen Z', 'Luxury', 'Social Behavior', 'Wellness', 'Gaming', 'Future of Work', 'Digital Culture', 'Commerce', 'Creativity'];

const STEPS = [
  { key: 'exploring', index: '01 / 04', title: 'What are you', em: 'exploring?', hint: 'Pick the territories you want DRIFT to watch. Choose as many as you like.' },
  { key: 'purposes', index: '02 / 04', title: 'What are you using', em: 'DRIFT for?', hint: 'This shapes how opportunities are framed for you.' },
  { key: 'interests', index: '03 / 04', title: 'What are you', em: 'curious about?', hint: 'Your curiosity tunes the signal ranking on Discover.' },
  { key: 'research', index: '04 / 04', title: 'Start with', em: 'a little discovery.', hint: 'Explore US conversations, search patterns, and emerging ideas — through your interests.' },
] as const;

type StepKey = Exclude<(typeof STEPS)[number]['key'], 'research'>;

export function Onboarding() {
  const session = useSession();
  const { refresh: startResearch, feed } = useTrends();
  const { route } = useLocation();
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState<Record<StepKey, string[]>>({ exploring: [], purposes: [], interests: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finishing = useRef(false);
  const hasSavedResearch = (feed?.topics.length ?? 0) > 0;

  useEffect(() => {
    if (session.ready && session.onboardingCompleted && !finishing.current) route('/app/discover', true);
  }, [session.ready, session.onboardingCompleted]);

  const options = step === 0 ? EXPLORING : step === 1 ? PURPOSES : INTERESTS;
  const key = STEPS[step].key;
  const chosen = key === 'research' ? [] : selections[key];

  const toggle = (option: string) => {
    if (key === 'research') return;
    setSelections((s) => ({
      ...s,
      [key]: s[key].includes(option) ? s[key].filter((o) => o !== option) : [...s[key], option],
    }));
  };

  const finish = async (startNew: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setError('');
    try {
      await api.saveOnboarding(selections);
      await session.refresh();
      if (startNew) {
        route('/app/research');
        window.scrollTo({ top: 0, behavior: 'instant' });
        void startResearch();
      } else {
        route('/app/discover');
      }
    } catch {
      setError('Could not save your preferences. Try again.');
      setBusy(false);
      finishing.current = false;
    }
  };

  return (
    <div class="onboarding page">
      <div class="onboarding__rail">
        {STEPS.map((s, i) => (
          <span key={s.key} aria-current={i === step ? 'step' : undefined} class={`onboarding__rail-step mono${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}>
            {s.index}
          </span>
        ))}
      </div>
      <div class="onboarding__stage" key={step}>
        <p class="page-head__tag mono">{STEPS[step].index} — {key === 'research' ? 'Start Research' : 'A short calibration'}</p>
        <h1 class="onboarding__title">
          {STEPS[step].title} <em>{STEPS[step].em}</em>
        </h1>
        <p class="page-head__sub">{STEPS[step].hint}</p>
        {key === 'research' ? <div class="onboarding__research">
          {hasSavedResearch && (
            <p class="onboarding__research-status">You already have <strong>{feed?.topics.length} findings</strong> from research{feed?.state.lastPulledAt ? ` on ${new Date(feed.state.lastPulledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}. You can open these now, or run new research to add more.</p>
          )}
          <dl>{([
            ['exploring', 'Your territories'], ['purposes', 'Your direction'], ['interests', 'Your interests'],
          ] as const).map(([field, label]) => <div key={field}><dt class="mono">{label}</dt><dd>{selections[field].join(' · ')}</dd></div>)}</dl>
          <p>{hasSavedResearch ? 'Open existing research reads your saved findings at no cost. Running new research adds fresh evidence and merges with what you already have.' : 'Start Research opens your research screen, where you can follow each search as findings arrive. Future research runs only when you request it.'}</p>
        </div> : <div class="onboarding__options">
          {options.map((option) => (
            <Chip key={option} active={chosen.includes(option)} onClick={() => toggle(option)}>
              {option}
            </Chip>
          ))}
        </div>}
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="onboarding__actions">
          {step > 0 && (
            <button type="button" class="btn" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}>
              <span class="btn__text">Back</span>
            </button>
          )}
          {step < 3 ? (
            <button type="button" class="btn btn--solid" disabled={chosen.length === 0} onClick={() => setStep(step + 1)}>
              <span class="btn__text">Continue</span><span class="btn__arrow">↗</span>
            </button>
          ) : hasSavedResearch ? (
            <>
              <button type="button" class="btn btn--solid" disabled={busy} onClick={() => void finish(false)}>
                <span class="btn__text">{busy ? 'Saving preferences…' : 'Open existing research'}</span><span class="btn__arrow">↗</span>
              </button>
              <button type="button" class="btn" disabled={busy} onClick={() => void finish(true)}>
                <span class="btn__text">Run new research</span>
              </button>
            </>
          ) : (
            <button type="button" class="btn btn--solid" disabled={busy} onClick={() => void finish(true)}>
              <span class="btn__text">{busy ? 'Saving preferences…' : 'Start Research'}</span><span class="btn__arrow">↗</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
