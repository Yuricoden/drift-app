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
DRIFT_LOGIN_EMAIL=demo@drift.ai        # the single predefined account
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

Each channel runs in two stages. **Retrieval** gathers evidence from that channel's provider only; **analysis** then turns that evidence into findings using a cheap model with *no* browsing access, so a topic can only cite a URL a provider actually returned. Retrieval queries cover roughly the past 30 days and require US relevance (Google Trends keeps its own 12-month window, labeled as such). Missing platform coverage is labeled; unrelated publisher URLs remain “Wider web.” No engagement counts or trend scores are fabricated.

A channel is marked **complete** only when its topics cite that channel's own domain; evidence from another domain is downgraded to **limited** rather than counted as coverage. A SerpApi credential or quota failure blocks only YouTube and Google Trends — Reddit and the wider web still run. An OpenRouter failure stops the pull, because every channel needs the analysis step.

The feed displays all accepted topics, source links, provider-supplied excerpts when available, why each finding could matter, an audience, a business hypothesis, and a first validation experiment. Only URLs actually returned in provider citations can become source evidence. Repeated topic titles merge while preserving earlier sources; new topics are retained alongside older findings. Filters and pagination never trigger AI calls.

Retrieval calls go to `perplexity/sonar` with OpenRouter's web plugin (`engine: perplexity`) and per-channel domain filters; the old `OPENROUTER_NATIVE_RESEARCH_MODEL` setting is unused. The analysis step uses `OPENROUTER_ASK_MODEL` (Gemini flash-lite by default) with no search plugin, so it cannot browse. Gemini also remains the default for signal extraction and Ask DRIFT's conversational analysis. Sonar retrieval does not use automatic model fallback.

When MongoDB is absent, **research state, topics, and usage** persist in the git-ignored `.drift/research` directory using serialized atomic writes. Other application data still uses the existing in-memory fallback. Mount this directory on durable storage for a single-process deployment, or configure MongoDB when running multiple workers. If adding MongoDB later, migrate these research records first to preserve the research history; storage is not automatically migrated.

Trend Research reserves $0.05 before each channel and reconciles against returned usage for retrieval **plus** analysis. Retrieval that fails before any paid model call releases its reservation; genuinely ambiguous charges retain it. SerpApi requests are not charged to this budget — they draw on the separate SerpApi subscription. The configurable monthly research budget defaults to $75 and cannot exceed it. Manual pulls have a one-minute cooldown and never overlap for the same account. This guard covers Trend Research; set a dedicated OpenRouter key's monthly limit to $80 to also cap other AI features sharing the key. Provider billing is the final authority for total charges. A full four-channel pull measured about **$0.076** in OpenRouter credits plus five SerpApi requests.

API: `GET /api/trends` reads the saved feed. `POST /api/trends/pull` accepts `{ "mode": "refresh" }` and returns `202` while running. The old `initial` mode is rejected by the API and is read-only internally. Polling never starts research.

## Research providers and normalized evidence

Set `SERPAPI_API_KEY` in `.env.local` or the server environment, then restart the server. No `VITE_` key or client-side provider calls are used. SerpApi usage is billed separately from OpenRouter; use SerpApi account limits to control that subscription's quota. Tests use mocked providers and require no keys.

`POST /api/research` accepts `{ "query": "repair cafés", "sources": ["web", "reddit", "youtube", "trends"], "extract": true }`. Any nonempty combination is allowed; omitted sources defaults to web for compatibility. Query length is 1–300 characters. Google Trends accepts one term, not a comma-separated comparison. The response adds `evidence`, `providers`, and `reason` while retaining legacy `answer` and `citations` fields. Multiple requested sources are independent; a failed source does not silently switch to another provider. Partial success includes error metadata and completed evidence.

- **Reddit** (`openrouter-reddit`) uses Perplexity search through OpenRouter's web plugin with `include_domains: ["reddit.com"]` *and* a `site:reddit.com` query. Both are only retrieval hints — the guarantee is server-side: a citation is kept only if it parses as a real `https://www.reddit.com/r/<sub>/comments/<id>/…` permalink, so front pages, search URLs, `business.reddit.com` and lookalike hosts such as `reddit.com.evil.example` are rejected. Subreddit and post/comment kind come from the URL; US relevance must be explicit in the title or excerpt. Vote and comment counts are **not** available from search citations and stay `null` rather than being estimated.
- **Wider web** (`openrouter-web`) uses the same plugin with `exclude_domains` for reddit.com, youtube.com, youtu.be, redd.it and trends.google.com, so web coverage can never double-count another channel. URLs from those hosts are dropped even if the provider returns them.
- **YouTube** (`serpapi-youtube`) uses `engine=youtube`, `gl=us`, `hl=en` and `sp=EgIIBA==` (YouTube's own “Upload date: This month” token). Only organic `video_results` are used; `ads_results` and `movie_results` are skipped. Links are canonicalized to `youtube.com/watch?v=<id>`, so Shorts and playlist URLs are rejected. Recency is verified per result from the provider's `published_date` label — an unparsable or out-of-window video is dropped and counted in the report reason, never assumed recent. Note that SerpApi's documented `sp=CAI=` example does **not** filter by date; `EgIIBA==` was verified against live results. `gl=us` is recorded as a search locale, not as evidence the video is about the US. Search results carry no transcript or comments, and none are implied.
- **Google Trends** (`serpapi-trends`) uses `engine=google_trends`, `geo=US`, `date=today 12-m`, and separate `TIMESERIES` / `RELATED_QUERIES` requests. Source values are normalized to dated 0–100 relative-interest observations. Server code computes an ordinary least-squares slope in **index points per month** over that window; it needs at least 12 valid points spanning 270 days. Missing, nonnumeric, and partial samples are excluded, not replaced with zero. Rising percentages and Breakout labels remain provider values; a Breakout without a numeric percentage stays `null`. Top-query indices are not growth percentages. See https://serpapi.com/google-trends-interest-over-time and https://serpapi.com/google-trends-related-queries.

Every live `Evidence` has `source`, `title`, `url`, `snippet`, `metrics`, `date`, `provider`, and `reason`. Provider IDs are `openrouter-web`, `openrouter-reddit`, `serpapi-youtube`, `serpapi-trends` and `perplexity-sonar` (native Sonar, used by Ask DRIFT). `serpapi-reddit` is retained only so research saved by earlier builds still renders. Provider reports include status, attempt count, retry/failure reason, and safe error text. Chat preserves citations/evidence from **all** research tool calls in the message. `reddit_research`, `youtube_research` and `trends_research` are available alongside `web_research` only with web enabled; results and failures are cached within the message, and credential/rate-limit failures stop subsequent calls to the same *service* — OpenRouter tools block independently of SerpApi tools.

Extraction receives the normalized evidence and structured Trends metrics. It can select only supplied evidence URLs. The resulting `ExtractedSignal` uses that evidence directly, returns measured `momentumEvidence`, and leaves the legacy composite `momentum` score `null`. Model-provided scores, slopes, growth values, and timelines are ignored. The original illustrative catalog keeps its legacy type; extraction does not overwrite it or fill gaps using demo signals.

Failure policy: 401/403 → credentials and 429 → rate-limited, with no retries, for both providers. Timeouts/network failures/5xx get exactly one retry per failed provider request. A completed Trends timeseries is retained if related queries fail; it is not requested again as part of that retry. Errors never expose SerpApi URLs containing the key. No failed research is replaced by demo data, and a failed channel never borrows another channel's results.


## Flow

Landing → Login → Onboarding (once, persisted) → Discover → Signal → Map → Transfer Lab → Opportunities → Workspace → Ask DRIFT → Saved → Logout.
