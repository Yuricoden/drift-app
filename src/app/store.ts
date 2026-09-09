import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { api } from './api';

export interface SessionState {
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  onboardingCompleted: boolean;
  exploring: string[];
  purposes: string[];
  interests: string[];
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  ready: false,
  authenticated: false,
  email: null,
  onboardingCompleted: false,
  exploring: [],
  purposes: [],
  interests: [],
  refresh: async () => {},
});

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function useProvideSession(): SessionState {
  const [state, setState] = useState<Omit<SessionState, 'refresh'>>({
    ready: false,
    authenticated: false,
    email: null,
    onboardingCompleted: false,
    exploring: [],
    purposes: [],
    interests: [],
  });

  const refresh = async () => {
    try {
      const session = await api.session();
      if (!session.authenticated) {
        setState((s) => ({ ...s, ready: true, authenticated: false }));
        window.location.href = '/login';
        return;
      }
      const profile = await api.profile();
      setState({
        ready: true,
        authenticated: true,
        email: profile.email,
        onboardingCompleted: profile.onboarding.completed,
        exploring: profile.onboarding.exploring,
        purposes: profile.onboarding.purposes,
        interests: profile.onboarding.interests,
      });
    } catch {
      setState((s) => ({ ...s, ready: true }));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { ...state, refresh };
}

export { SessionContext };
