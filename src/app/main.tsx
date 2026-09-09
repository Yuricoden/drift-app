import { render } from 'preact';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { useEffect } from 'preact/hooks';
import { SessionContext, useProvideSession } from './store';
import { Chrome } from './components/Chrome';
import { Onboarding } from './pages/Onboarding';
import { Discover } from './pages/Discover';
import { SignalDetail } from './pages/SignalDetail';
import { SignalMapPage } from './pages/SignalMap';
import { TransferLab } from './pages/TransferLab';
import { Opportunities } from './pages/Opportunities';
import { Workspace } from './pages/Workspace';
import { Saved } from './pages/Saved';
import { Preferences } from './pages/Preferences';
import { TrendResearch } from './pages/TrendResearch';
import { SignalsProvider } from './signals';
import { TrendResearchProvider } from './trends';

/** Sends /app → /app/discover and keeps the onboarding state consistent. */
function Redirects() {
  const { path, route } = useLocation();
  useEffect(() => {
    if (path === '/app' || path === '/app/') route('/app/discover', true);
  }, [path]);
  return null;
}

function NotFound() {
  return (
    <div class="page">
      <header class="page-head">
        <p class="page-head__tag mono">Off the map</p>
        <h1 class="page-head__title">This part of the field<br /><em>isn’t charted yet.</em></h1>
        <p class="page-head__sub"><a class="text-link" href="/app/discover">Back to Discover ↗</a></p>
      </header>
    </div>
  );
}

function App() {
  const session = useProvideSession();

  if (!session.ready) {
    return (
      <div class="app-boot" role="status">
        <span class="app-boot__brand">DRIFT<span>✳</span></span>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <LocationProvider>
        <TrendResearchProvider>
        <SignalsProvider><Chrome>
          <Redirects />
          <Router>
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/app/discover" component={Discover} />
            <Route path="/app/research" component={TrendResearch} />
            <Route path="/app/signals/:id" component={SignalDetail} />
            <Route path="/app/map" component={SignalMapPage} />
            <Route path="/app/transfer" component={TransferLab} />
            <Route path="/app/opportunities" component={Opportunities} />
            <Route path="/app/opportunities/:id" component={Workspace} />
            <Route path="/app/saved" component={Saved} />
            <Route path="/app/preferences" component={Preferences} />
            <Route default component={NotFound} />
          </Router>
        </Chrome></SignalsProvider>
        </TrendResearchProvider>
      </LocationProvider>
    </SessionContext.Provider>
  );
}

render(<App />, document.getElementById('root')!);
