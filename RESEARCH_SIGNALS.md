# Saved research signals and hypotheses

Discover, Signal Map, signal detail, and Transfer Lab share an authenticated, GET-only signals provider. It reads all saved owner-scoped signals and polls for extraction updates. Opening pages and saved deep links never starts research or AI generation.

## Analysis

- **Start Research** owns its follow-up extraction on the server, including when the browser closes.
- **Analyze saved research** processes pending normalized evidence without searching the web.
- `GET /api/signals/status` reports pending/processed evidence revisions, unavailable older topics, current state, and batch failures. It does not claim or start work.
- `POST /api/signals/extract` returns HTTP 202 while processing, with the existing count/signals fields plus `status`. Poll the GET status endpoint for completion.
- Evidence is processed in batches of 30. Revision hashes include the analysis version. Successful batches checkpoint independently; a failed batch remains pending for explicit resume.
- MongoDB provides atomic owner leases across workers. The file fallback supports a single server process. Heartbeats protect active jobs; interrupted jobs become explicitly resumable after lease expiry.
- Old classifications have no trustworthy version marker and are displayed as unclassified until analyzed. Reanalysis replaces, rather than unions, classifications. No industry is assumed by default.
- Map edges are undirected **AI-classified associations**, not evidence of migration. Momentum is measured Google Trends data, or **Not measured**.

## Generation

Transfer, opportunity, regeneration, workspace refinement, and confirmed chat proposals use the same owner-validating generation service. Only saved signal evidence and the selected industry name/ID are supplied. Taxonomy behavior descriptions are never supplied as factual evidence.

New outputs are hypotheses, separating cited observations from target-industry assumptions. Provenance includes signal ID/name, exact supplied evidence snapshot, actual response model, generation time, and analysis version. Section refinements retain their own provenance. Unknown citations and malformed outputs fail before modifying results.

Generation uses `OPENROUTER_SIGNAL_MODEL`, the existing OpenRouter key, and the shared monthly research spending ledger. Timeouts/transient errors get at most one retry; credentials, rate limits, budgets, schema errors, and malformed responses get none. No template fallback exists.

Legacy records remain readable by ID and through “Include legacy” controls. They are excluded by default and cannot be regenerated/refined as templates. Old unavailable saved signal references remain listed when legacy items are included; no evidence is invented for them.

## Verification

- `npm test`: isolated temporary research data, mocked AI/provider responses, fail-closed unexpected fetches. Includes batch resume/concurrency, ownership, generation, Saved hydration and chat proposal routes.
- `npm run typecheck`
- `npm run build`
- `npm run test:browser`: fixture-only desktop/mobile smoke checks using installed macOS Google Chrome. Blocks external page requests, asserts no API writes, and writes screenshots/report under `/tmp`. No additional browser library is required.

Browser smoke tests exercise shared signal rendering, map selection/deep links, layout overflow and read-only page entry. Automated service/route tests cover the generation-to-workspace/Saved flow. Live MongoDB and real provider/model behavior are intentionally not exercised by tests.
