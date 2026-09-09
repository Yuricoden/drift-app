# DRIFT — Cultural Signal Intelligence

**DRIFT is a cultural signal intelligence platform that helps people understand where culture may be moving before those shifts become obvious trends.**

It collects weak signals from across the web—conversations, search behavior, emerging products, media, and communities—then uses AI to connect those observations into larger patterns. DRIFT shows where a signal started, how it is moving between industries, and what new products, brands, or companies could emerge from it.

I built it because most trend platforms tell you what is already popular. I wanted something that could help answer a more interesting question: **what is beginning to change, and where could that change go next?**
s. It gathers evidence from Reddit, the wider web, YouTube, and Google Trends, then uses AI to extract signals, map relationships between them, and explore how a signal could translate into new products, brands, or ventures.

For me, it is a tool for exploring the intersection of culture, technology, consumer behavior, and startups—and turning curiosity about those shifts into concrete ideas worth building.

**Architecture**

The frontend is built with Preact, TypeScript, and Vite. An Express API manages authentication, research, AI analysis, and application data. MongoDB stores each user’s profile, preferences, research, signals, transfers, opportunities, saved items, and conversations.
OpenRouter provides the AI models used for research interpretation and signal extraction. SerpApi supplies structured YouTube and Google Trends data. The application is deployed through Vercel.
The app currently supports three predefined users whose credentials are configured securely on the server. Each user has a separate owner identity, so their onboarding progress and content remain isolated.

**Key decisions and tradeoffs**

I separated collected evidence from AI interpretation. Source links and measured data are preserved, while generated conclusions are presented as hypotheses rather than established facts. This makes the results easier to evaluate, although it creates a more complex research pipeline.
Research only runs when a user requests it. This prevents navigation and page refreshes from accidentally starting paid searches, but it means users must manually request fresh findings.
The current research process starts background work inside the Vercel server. It is simple and works well for a small private release, but a server restart or timeout can interrupt a long research run. The application preserves completed findings and reports the interruption rather than losing existing work.
Predefined credentials were a practical choice for a private prototype. They keep registration simple, but they are not appropriate for a public product with many users.

**What I would do next**

I would add public registration and replace environment-based passwords with securely hashed passwords stored in MongoDB using bcrypt. That work would also include email verification, password reset, login rate limiting, and optional Google authentication.
I would move research into Inngest, which would manage each research source as a reliable background step. This would allow interrupted jobs to resume, automatically retry temporary failures, and prevent completed work from being repeated.
MongoDB would remain the permanent source of truth. I would consider Redis for short-lived caching, duplicate-job prevention, and rate limiting once usage grows. I would also improve signal ranking using evidence quality, recency, and agreement across sources, then add collaborative workspaces and notifications when saved signals change.

## What each part of DRIFT is for

| Section | What it does | When to use it |
|---|---|---|
| **Trend Research** | Searches Reddit, the wider web, YouTube, and Google Trends for current conversations and behavior changes. | Start here when you want fresh evidence or want to update previous research. |
| **Discover** | Turns collected research into clear cultural signals. | Use it to browse emerging patterns and decide which signals deserve attention. |
| **Signal Detail** | Explains a signal’s meaning, supporting evidence, audience needs, and possible importance. | Open this when a signal looks relevant and you want to understand it more deeply. |
| **Signal Map** | Visualizes relationships between signals and industries. | Use it to find unexpected connections and see how an idea may be spreading. |
| **Transfer Lab** | Applies a cultural signal to a selected industry. | Use it when you want to turn a signal into unmet needs, product directions, or business possibilities. |
| **Opportunities** | Collects the concrete opportunities generated from Transfer Lab. | Use it to compare ideas and select one worth developing. |
| **Opportunity Workspace** | Helps develop an opportunity into a clearer concept, audience, value proposition, risks, and experiments. | Use it when you are ready to move from an interesting idea toward something testable. |
| **Saved** | Organizes signals, transfers, and opportunities you want to revisit. | Save anything valuable while exploring so it does not get lost. |
| **Ask DRIFT** | Lets you ask questions across your research and saved signals. | Use it when you need help comparing signals, finding connections, or deciding what to explore next. |


## The ideal journey

**Complete onboarding**

Choose your interests, goals, and areas of exploration.

**Start Trend Research**

Let DRIFT collect current evidence from multiple sources.

**Review Discover**

Browse the signals extracted from that research.

**Open a promising signal**

Read its evidence and understand why it could matter.

**Explore the Signal Map**

Look for related signals and industries.

**Use Transfer Lab**

Combine the signal with an industry to reveal possible unmet needs.

**Generate opportunities**

Turn the strongest transfer into concrete product, brand, or venture ideas.

**Develop an opportunity**

Use it to compare ideas and generate one worth developing.

**Save the strongest work**

Build a personal library of signals and opportunities.

**Ask DRIFT for direction**

Ask questions such “Which opportunity would be best for me?” 

## Stack

Landing page + private web app: login, onboarding, Discover, Trend Research, Signal Map, Transfer Lab, Opportunities, Opportunity Workspace, Ask DRIFT, and Saved.

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
DRIFT_LOGIN_EMAIL      # account 1 (kept unsuffixed for backward compatibility)
DRIFT_LOGIN_PASSWORD=change-this-password
DRIFT_LOGIN_EMAIL_2=   # account 2
DRIFT_LOGIN_PASSWORD_2=change-this-password
DRIFT_LOGIN_EMAIL_3=   # account 3
DRIFT_LOGIN_PASSWORD_3=change-this-password
SESSION_SECRET=any-long-random-string
MONGODB_URI=mongodb+srv://...          # optional; without it data is kept in memory only
MONGODB_DB=drift
OPENROUTER_API_KEY=                   # server-side only
SERPAPI_API_KEY=                      # server-side only; YouTube + Google Trends
OPENROUTER_SONAR_MODEL=perplexity/sonar
DRIFT_RESEARCH_DATA_DIR=.drift/research
DRIFT_RESEARCH_MONTHLY_BUDGET=75
```

Credentials are validated **server-side only** against these variables. Each normalized
email is a separate owner, so first login creates an empty profile and each account's
onboarding, research, signals, transfers, opportunities, saves, and conversations remain
separate. Sessions are
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

## Vercel deployment

Vercel serves the Vite `dist/` output and runs the Express API through `api/index.ts`. An explicit `/api/:path*` → `/api` rewrite sends nested requests such as `/api/auth/login` to that function. The other rewrites map `/login` to `login.html`, and `/onboarding` plus `/app/*` to `app.html`.

Server-side relative imports use `.js` extensions so compiled ES modules can load in Node without the local `tsx` loader. `npm run build` checks the server entry points with NodeNext resolution before building the frontend. The deployment regression test also compiles the API into an isolated directory and verifies session reads and login in plain Node using fixture credentials.

Add these project environment variables in Vercel: the three `DRIFT_LOGIN_EMAIL` / `DRIFT_LOGIN_PASSWORD` pairs shown above, `SESSION_SECRET`, `MONGODB_URI`, `MONGODB_DB`, `OPENROUTER_API_KEY`, and `SERPAPI_API_KEY`. Use MongoDB Atlas; without `MONGODB_URI`, each serverless invocation uses temporary in-memory/local research storage and will not reliably persist sessions or signals.

Select Production for the live site's variables and redeploy after changing them. Set values directly in Vercel without adding `.env`-style wrapping quotes; password whitespace is significant. Deploy from the project root so both `api/` and `vercel.json` are included. To diagnose login, an unauthenticated `GET /api/auth/session` should return HTTP 200 with JSON; Vercel `NOT_FOUND` (404) or `FUNCTION_INVOCATION_FAILED` (500) means routing or runtime startup is failing before credentials can be checked. Inspect Runtime Logs for startup exceptions; never log passwords or API keys.

Serverless functions are request-scoped. Starting Trend Research or signal extraction must stay within the configured function duration; for longer jobs, move that work to a queue or a persistent background worker.

## Data model (MongoDB, owner-scoped by normalized login email)

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



