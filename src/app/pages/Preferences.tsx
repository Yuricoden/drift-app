import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api } from '../api';
import { useSession } from '../store';
import { Chip, PageHead } from '../components/ui';

const EXPLORING = ['Consumer Behavior', 'Technology', 'Fashion', 'Media', 'Travel', 'Design', 'Startups', 'Finance'];
const PURPOSES = ['Find startup ideas', 'Track cultural shifts', 'Brand strategy', 'Product research', 'Investment research', 'Creative inspiration'];
const INTERESTS = ['AI', 'Gen Z', 'Luxury', 'Social Behavior', 'Wellness', 'Gaming', 'Future of Work', 'Digital Culture', 'Commerce', 'Creativity'];

export function Preferences() {
  const session = useSession();
  const { route } = useLocation();
  const [exploring, setExploring] = useState<string[]>(session.exploring);
  const [purposes, setPurposes] = useState<string[]>(session.purposes);
  const [interests, setInterests] = useState<string[]>(session.interests);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, option: string) => {
    setSaved(false);
    set(list.includes(option) ? list.filter((o) => o !== option) : [...list, option]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveOnboarding({ exploring, purposes, interests });
      await session.refresh();
      setSaved(true);
      route('/app/discover');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page preferences">
      <PageHead
        index="Preferences"
        title={<>Retune the<br /><em>instrument.</em></>}
        sub={`${session.email ?? ''} — your calibration shapes Discover and Ask DRIFT.`}
      />

      <section class="preferences__group">
        <h2 class="section-label mono">What are you exploring?</h2>
        <div class="chip-row">
          {EXPLORING.map((o) => <Chip key={o} active={exploring.includes(o)} onClick={() => toggle(exploring, setExploring, o)}>{o}</Chip>)}
        </div>
      </section>
      <section class="preferences__group">
        <h2 class="section-label mono">What are you using DRIFT for?</h2>
        <div class="chip-row">
          {PURPOSES.map((o) => <Chip key={o} active={purposes.includes(o)} onClick={() => toggle(purposes, setPurposes, o)}>{o}</Chip>)}
        </div>
      </section>
      <section class="preferences__group">
        <h2 class="section-label mono">What are you curious about?</h2>
        <div class="chip-row">
          {INTERESTS.map((o) => <Chip key={o} active={interests.includes(o)} onClick={() => toggle(interests, setInterests, o)}>{o}</Chip>)}
        </div>
      </section>

      <div class="preferences__actions">
        <button type="button" class="btn btn--solid" disabled={busy} onClick={() => void save()}>
          <span class="btn__text">{busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save preferences'}</span><span class="btn__arrow">↗</span>
        </button>
      </div>
    </div>
  );
}
