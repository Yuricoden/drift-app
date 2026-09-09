import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api } from '../api';
import { useSession } from '../store';
import { AskDrift } from './AskDrift';
import { ResearchStart } from './ResearchStart';
import { useTrends } from '../trends';

const LINKS = [
  { href: '/app/research', label: 'Trend Research' },
  { href: '/app/discover', label: 'Discover' },
  { href: '/app/map', label: 'Signal Map' },
  { href: '/app/transfer', label: 'Transfer Lab' },
  { href: '/app/opportunities', label: 'Opportunities' },
  { href: '/app/saved', label: 'Saved' },
];

export function Chrome(props: { children: preact.ComponentChildren }) {
  const { path } = useLocation();
  const session = useSession();
  const { toast, dismissToast } = useTrends();
  const [askOpen, setAskOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      window.location.href = '/';
    }
  };

  const inOnboarding = path.startsWith('/onboarding');

  return (
    <div class="app-shell">
      <header class="app-nav">
        <a class="app-nav__brand" href={session.onboardingCompleted ? '/app/discover' : '/'} aria-label="DRIFT home">
          DRIFT<span class="brand-star" aria-hidden="true">✳</span>
        </a>
        {!inOnboarding && (
          <nav class="app-nav__links" aria-label="App sections">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} aria-current={path.startsWith(link.href) ? 'page' : undefined}>
                {link.label}
              </a>
            ))}
          </nav>
        )}
        <div class="app-nav__right">
          {!inOnboarding && (
            <button type="button" class="app-nav__ask" onClick={() => setAskOpen(true)}>
              Ask DRIFT <span aria-hidden="true">✳</span>
            </button>
          )}
          <div class="app-nav__user" ref={menuRef}>
            <button type="button" class="app-nav__avatar" aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}>
              {(session.email ?? 'd').slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <div class="app-nav__menu" role="menu">
                <p class="app-nav__email mono">{session.email}</p>
                <a href="/app/preferences" role="menuitem">Preferences</a>
                <button type="button" role="menuitem" onClick={() => void logout()}>Log out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* {!inOnboarding && session.onboardingCompleted && path !== '/app/research' && <div class="app-research-bar"><span class="mono">Your cultural landscape</span><ResearchStart /></div>} */}
      {!inOnboarding && toast && (
        <div class="research-toast" role="status" aria-live="polite">
          <span>
            <strong>Research is done.</strong>{' '}
            {toast.totalTopics} finding{toast.totalTopics === 1 ? '' : 's'} available
            {toast.limited ? ' — some channels had limited evidence.' : '.'}{' '}
            <a href="/app/discover">Discover what's there ↗</a>
          </span>
          <button type="button" aria-label="Dismiss" onClick={dismissToast}>✕</button>
        </div>
      )}
      <main class="app-main">{props.children}</main>
      <AskDrift open={askOpen} onClose={() => setAskOpen(false)} />
    </div>
  );
}
