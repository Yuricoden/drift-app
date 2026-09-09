# DRIFT — Cultural Signal Intelligence

Landing page + private web app: login, onboarding, Discover, Trend Research, Signal Map, Transfer Lab, Opportunities, Opportunity Workspace, Ask DRIFT, and Saved.

## Stack

- **Frontend**: Vite multi-page (vanilla TS landing & login, Preact app shell) — `index.html`, `login.html`, `app.html`
- **Server**: Express, mounted inside the Vite dev server in development and serving `dist/` in production
- **Data**: MongoDB (Atlas recommended) with a loud in-memory fallback for UI work without a database
- **Research**: Perplexity Sonar through OpenRouter (wider web + Reddit) and SerpApi (YouTube + Google Trends). Trend Research saves sourced findings and business hypotheses; Ask DRIFT uses the same providers when web research is enabled.
- **Analysis**: configurable OpenRouter models for Ask DRIFT and signal extraction. The original signal catalog and transfer/opportunity generators remain separate from the live Trend Research feed.

## Setup

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev                  # http://localhost:5173 (API included)
```

`.env.local`:

```env
DRIFT_LOGIN_EMAIL      # the single predefined account
DRIFT_LOGIN_PASSWORD=change-this-password
SESSION_SECRET=any-long-random-string
MONGODB_URI=mongodb+srv://...          # optional; without it data is kept in memory only
MONGODB_DB=drift
OPENROUTER_API_KEY=                   # server-side only
SERPAPI_API_KEY=                      # server-side only; YouTube + Google Trends
OPENROUTER_SONAR_MODEL=perplexity/sonar
DRIFT_RESEARCH_DATA_DIR=.drift/research
DRIFT_RESEARCH_MONTHLY_BUDGET=75
```

Credentials are validated **server-side only** against these variables. Sessions are
random 256-bit tokens stored in the `sessions` collection and sent as an
`HttpOnly; SameSite=Lax` cookie (`Secure` when `NODE_ENV=production`). Nothing
secret is ever exposed to the client bundle.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with the API and HTML guards mounted |
| `npm run build` | Production build to `dist/` |
| `npm run start` | Production server (Express serving `dist/` + API) on `PORT` (default 4173) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Research, persistence, budget, and conversational-agent tests |

Set `DRIFT_DEBUG=1` to log auth decisions per request. In production behind HTTPS, run with `NODE_ENV=production` so the session cookie is marked `Secure`.

## Data model (MongoDB, single owner = the env account)

- `profiles` — onboarding completion + preferences
- `sessions` — login sessions (TTL index, 7 days)
- `saved_items` — saved signals / transfers / opportunities with collections
- `transfers` — signal × industry interpretations
- `opportunities` — generated opportunities incl. the 10-section workspace
- `conversations` — Ask DRIFT threads
- `trend_states` — owner-scoped job progress and latest coverage
- `trend_topics` — sourced findings, usefulness, and proposed business experiments
- `trend_usage` — monthly research cost reservations and reconciliation

## Trend Research

Open `/app/research`, or select **Trend Research** in the app navigation. Research is entirely **on demand**. App entry, reloads, navigation, and opening Ask DRIFT do not start research. The app only reads saved research on entry. Onboarding has four steps: territories, purpose, interests, and **Start Research**. Clicking the final button saves preferences and opens the research screen with live loading and search progress. The shared **Start Research** button in the app starts another broad editorial pull and shows when research was last done (or the last attempt if it failed). Use **Research a signal term** to choose Wider web, Reddit, YouTube, and/or Google Trends. Chat research tools are only registered and executable when the message's web toggle is enabled. Failed refreshes retain the previous feed/results.

**Start Research runs four channels, each served by exactly one provider:**

| Channel | Provider | What is retrieved |
| --- | --- | --- |
| Reddit | Perplexity search on OpenRouter | Public threads/comments, restricted to `site:reddit.com` |
| Wider web | Perplexity search on OpenRouter | Reporting and research, **excluding** reddit.com, youtube.com, youtu.be and trends.google.com |
| YouTube | SerpApi `engine=youtube` | Organic videos uploaded this month, with provider-reported views/channel/length |
| Google Trends | SerpApi `engine=google_trends` | US interest over time (12 months) plus related/rising queries |


## Flow

Landing → Login → Onboarding (once, persisted) → Discover → Signal → Map → Transfer Lab → Opportunities → Workspace → Ask DRIFT → Saved → Logout.
