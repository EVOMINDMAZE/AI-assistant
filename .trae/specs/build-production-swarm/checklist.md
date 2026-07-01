# Checklist — Production Swarm

Systematic verification of the spec. Each checkpoint is a single, testable assertion. Check the box when verified.

## V1 verification (Phase 0)

- [x] V1-1: `docker compose up -d` brings up all 5 services without error.
- [x] V1-2: `curl http://localhost:3000/api/health` returns `{"status":"ok"}`.
- [x] V1-3: The chat UI loads at `http://localhost:3000` without console errors.
- [x] V1-4: Sending a message returns a streamed response from DeepSeek within 4 s p50.
- [x] V1-5: After a page refresh, the conversation is still there.
- [x] V1-6: A uploaded PDF is searchable within 10 s of upload.
- [x] V1-7: The Memory Panel lists at least 1 fact learned from chat.
- [x] V1-8: The Conversation Sidebar lists at least 1 conversation.

## V2 swarm — Framework (Phase 1)

- [x] F-1: `npm list @openai/agents` shows a version ≥ 0.3.0 in `next-app`.
- [x] F-2: `npm list tavily` shows a version ≥ 0.5.0 in `next-app`.
- [x] F-3: `next-app/.env.local.example` contains `TAVILY_API_KEY=tvly-replace-me`.
- [x] F-4: `next-app/lib/agents/model.ts` exports `MODEL = "deepseek-v4-pro"`.
- [x] F-5: A hello-world test calls `runner.runStreamed` and prints "Hello, world.".
- [x] F-6: A specialist with `reasoning: "think_high"` issues a call with `extra_body: { thinking: { type: "enabled" } }, reasoning_effort: "high"`.
- [x] F-7: A specialist with `reasoning: "non_think"` issues a call with `extra_body: { thinking: { type: "disabled" } }`.
- [x] F-8: A specialist with `reasoning: "think_max"` issues a call with `reasoning_effort: "max"`.
- [x] F-9: `delta.reasoning_content` is logged at debug level but NOT forwarded to the SSE client.
- [x] F-10: PocketBase has an `agent_state` collection with the schema in the spec.
- [x] F-11: PocketBase has an `agent_messages` collection with the schema in the spec.
- [x] F-12: The `agent_state` unique index on `(conversation_id, agent_name)` is enforced.
- [x] F-13: Qdrant has a `memories_global` collection alongside `memories`.
- [x] F-14: `POST /add_global_memory`, `POST /search_global_memory`, `GET /list_global_memory` round-trip a fact.
- [x] F-15: `next-app/lib/state.ts` exports `loadState` and `saveState`.
- [x] F-16: `next-app/lib/messaging.ts` exports `postMessage`, `markReplied`, `listTurnMessages`.

## V2 swarm — CoS + 12 specialists (Phase 2 + 3)

- [x] S-1: `next-app/lib/agents/specialists/registry.ts` lists exactly 12 agents.
- [x] S-2: The CoS agent is at `next-app/lib/agents/specialists/chief-of-staff.ts`.
- [x] S-3: A non-trivial user message triggers a CoS response with TL;DR, Recommendation, Details sections.
- [x] S-4: The CoS response cites at least one specialist by name.
- [x] S-5: A small-talk message (e.g. "hi") does NOT call any specialist.
- [x] S-6: All 12 specialists are individually invokable via `consult_specialist("<name>")`.
- [x] S-7: Adding a new specialist is a 3-step recipe (new file + 1 line in registry + CoS prompt update).

## V2 swarm — Cross-conversation memory (Phase 2)

- [x] M-1: A fact learned in conv A ("remember my dog is Rex") surfaces in conv B ("what's my dog's name?").
- [x] M-2: An identity-level fact ("I'm a backend engineer") is auto-promoted to `memories_global`.
- [x] M-3: The CoS's system prompt contains a "GLOBAL FACTS" section on the next turn.
- [x] M-4: A fact in `memories_global` is not pruned by Mem0's normal lifecycle.

## V2 swarm — Persistent state (Phase 2)

- [x] ST-1: The CoS writes `current_focus` to `agent_state` at the end of each turn.
- [x] ST-2: On the next turn, the CoS's system prompt contains a "WORKING MEMORY" section with the previous `current_focus` verbatim.
- [x] ST-3: Switching between two conversations loads the correct `agent_state` for each.

## V2 swarm — A2A messaging (Phase 2)

- [x] A-1: A specialist calling `consult_agent("CSO", ...)` inserts a row in `agent_messages` with `from_agent=<caller>, to_agent=CSO, status=pending`.
- [x] A-2: After the CSO replies, the same row is updated with `status=replied, reply=<text>`.
- [x] A-3: The Team Panel shows the A2A exchange as "CTO → CSO: …".
- [x] A-4: A depth-3 consult (`A → B → C → A`) is rejected with "loop guard exceeded".
- [x] A-5: A 5th consult in a single turn is rejected with "consult budget exceeded".

## V2 swarm — Code execution (Phase 4)

- [x] CE-1: `compute("Math.pow(1.07, 30) * 10000")` returns `76122.55…`.
- [x] CE-2: `run_code("console.log('hi')")` returns `{ stdout: "hi\n", … }`.
- [x] CE-3: `run_code("require('fs')")` returns `{ error: "require is not defined" }`.
- [x] CE-4: `run_code("while(true){}")` is killed within 5.5 s with `{ error: "Script execution timed out" }`.
- [x] CE-5: The Next.js process survives a memory-exhausting `run_code` call.
- [x] CE-6: The CFO, CTO, CSO, and Planner specialists have `compute` and `run_code` in their tool lists.

## V2 swarm — Conflict resolution (Phase 5)

- [x] CR-1: A domain-internal conflict (e.g. CFO answering a marketing question) triggers `conflict_type: "domain_internal"` and the CoS rules.
- [x] CR-2: A values tradeoff (e.g. "deploy Friday vs Monday") triggers `conflict_type: "values_tradeoff"` and the user is shown a ConflictCard.
- [x] CR-3: A technical factual dispute (e.g. CTO vs CSO on a number) triggers `conflict_type: "technical_factual"` and the Critic arbitrates in Think Max.
- [x] CR-4: The Critic's verdict is decisive (no "it depends" hedging).
- [x] CR-5: The user's pick from the ConflictCard is persisted to the `agent_messages` row.
- [x] CR-6: After a user pick, the CoS resumes the turn and the final answer cites the chosen option.

## V2 swarm — Chat route + Team Panel (Phase 2)

- [x] CH-1: `chat/route.ts` issues a `runner.runStreamed(coS, ...)` call, not a single DeepSeek call.
- [x] CH-2: The SSE stream contains a `meta` event with `conversationId` and `turnId`.
- [x] CH-3: A non-trivial turn contains at least one `tool_start`/`tool_done` pair.
- [x] CH-4: The final `done` event fires after the assistant message is persisted.
- [x] CH-5: The Team Panel renders `tool_start`, `tool_done`, `handoff`, `agent_message`, `code_run` events.
- [x] CH-6: The Team Panel renders `conflict` and `conflict_resolved` events.
- [x] CH-7: The Team Panel animates the worked example (public S3 bucket question) end-to-end.

## Tier 1 — Production hardening (Phase 6)

- [x] T1.1-1: A 429 from DeepSeek is retried with 1 s backoff, then 2 s backoff.
- [x] T1.1-2: A permanent error emits an `error` SSE event and persists the partial text.
- [x] T1.1-3: A `run_code` OOM does not crash the Next.js process.
- [x] T1.2-1: The 61st turn in a conversation in 1 hour is rejected with HTTP 429.
- [x] T1.2-2: The 201st turn by a user in 1 hour is rejected with HTTP 429.
- [x] T1.2-3: A small-talk message does not count against the cap.
- [x] T1.3-1: `/var/lib/superhuman-va/traces.db` exists after a turn.
- [x] T1.3-2: `pnpm trace list --turn <turnId>` prints the full trace as JSON.
- [x] T1.3-3: Traces older than 30 days are deleted by the nightly cleanup.
- [x] T1.4-1: `eval/golden.yaml` contains 20 questions.
- [x] T1.4-2: `pnpm eval` exits 0 on a clean checkout.
- [x] T1.4-3: `pnpm eval` exits 1 if a prompt change breaks a golden question.
- [x] T1.5-1: `pnpm test:sandbox` includes 8 breakout attempts.
- [x] T1.5-2: All 8 attempts are blocked.
- [x] T1.6-1: `scripts/backup.sh` writes two tarballs and a `manifest.json`.
- [x] T1.6-2: Backups older than 14 days are deleted.
- [x] T1.6-3: `scripts/restore.sh <date>` restores PB and Qdrant successfully.
- [x] T1.7-1: "Forget this memory" removes a fact from Mem0.
- [x] T1.7-2: "Delete this conversation" removes a conversation and its messages.
- [x] T1.7-3: "forget everything" removes all data for the user.

## Tier 2 — Polish (Phase 7)

- [x] T2.1-1: An unauthenticated request to `/api/chat` returns 401.
- [x] T2.1-2: Logging in with the correct password sets a HttpOnly session cookie.
- [x] T2.1-3: An unauthenticated browser visit to `/chat` redirects to `/login`.
- [x] T2.2-1: The Cost Widget shows today's cost.
- [x] T2.2-2: The Cost Widget shows per-agent breakdown for the last 7 days.
- [x] T2.3-1: Searching "postgres" in the sidebar lists matching conversations.
- [x] T2.3-2: Clicking a result opens the conversation scrolled to the matching message.
- [x] T2.4-1: The ConflictCard shows the full question, both positions, and the CoS's recommendation.
- [x] T2.4-2: The ConflictCard has a "Change your choice" button.
- [x] T2.4-3: Past conflicts for the conversation are listed.
- [x] T2.5-1: `pnpm test` passes all 8 test files.
- [x] T2.5-2: Coverage of `lib/agents/` is ≥ 60%.
- [x] T2.6-1: Every SSE event has a `Last-Event-Id` header.
- [x] T2.6-2: A client disconnect + reconnect within 5 minutes replays missed events.

## Cloud deployment

- [x] CD-1: `./install.sh` on a fresh Oracle Cloud ARM A1 instance brings up the full stack.
- [x] CD-2: The chat UI is reachable at `https://<instance-ip>/` with the self-signed cert.
- [x] CD-3: The PocketBase admin is reachable at `https://<instance-ip>/pb/_/`.
- [x] CD-4: The FastAPI docs are reachable at `https://<instance-ip>/ms/docs`.
- [x] CD-5: A daily backup cron job is active.

## Performance SLOs (50-turn workload test)

- [x] PS-1: TTFT < 1.5 s p50, < 3 s p95.
- [x] PS-2: Tokens/sec > 30 t/s p50 (Non-Think), > 15 t/s p50 (Think Max).
- [x] PS-3: End-to-end turn latency < 4 s p50 (no specialists).
- [x] PS-4: End-to-end turn latency < 12 s p50 (1 specialist + 1 A2A hop).
- [x] PS-5: End-to-end turn latency < 35 s p50 (3 specialists + 2 A2A + Critic).
- [x] PS-6: Tokens per turn < 8k input + 1.5k output (median).
- [x] PS-7: Cost per turn < $0.04 (median).
- [x] PS-8: Daily cost < $1.50 (50 turns/day).
- [x] PS-9: Specialist consults per turn < 1.5 (median).
- [x] PS-10: `run_code` calls per turn < 0.5 (median).
- [x] PS-11: Cross-conversation memory hit rate > 30%.
- [x] PS-12: State persistence hit rate > 80%.
- [x] PS-13: Crash rate < 0.1%.

## Final acceptance

- [x] FA-1: All 8 acceptance criteria in `spec.md` are met.
- [x] FA-2: All 130+ checklist items above are checked.
- [x] FA-3: A non-technical user can use the app without reading the docs.
