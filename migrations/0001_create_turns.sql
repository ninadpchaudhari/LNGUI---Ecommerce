-- The two artifacts Chapter 4 asks for.
--
-- Scalar columns are denormalized out of meta/σ so that the §4.15 metrics and
-- the §5.7 cross-mediator comparison are plain SQL, with no JSON parsing. The
-- JSON blobs keep full fidelity for the replay view.

-- §4.17 step 5: "Log every utterance, emitted command q, reached valuation V',
-- rendered display D', and MR outcome to a reproducible replay format."
CREATE TABLE IF NOT EXISTS turns (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  created_at            TEXT NOT NULL,          -- ISO8601 UTC
  created_ms            INTEGER NOT NULL,       -- epoch ms; ordering + keyset cursor
  turn_index            INTEGER NOT NULL,
  kind                  TEXT NOT NULL,          -- 'chat' | 'mr'
  relation              TEXT,
  role                  TEXT,                   -- 'source' | 'followup'
  trial                 INTEGER,
  utterance             TEXT NOT NULL,
  ok                    INTEGER NOT NULL,       -- 0/1

  -- P: prompt and runtime configuration. §4.17 requires every reported result
  -- to be paired with the model identifier and parameters.
  mode                  TEXT,                   -- 'llm' | 'local-test'
  provider              TEXT,
  base_url              TEXT,
  requested_model       TEXT,
  resolved_model        TEXT,                   -- what was actually served
  provider_name         TEXT,                   -- OpenRouter upstream provider
  temperature           REAL,
  top_p                 REAL,
  system_prompt_hash    TEXT,
  command_schema_hash   TEXT,
  history_policy        TEXT,                   -- 'full' | 'last-k' | 'none'
  history_max_turns     INTEGER,
  clear_action_enabled  INTEGER,

  -- Execution
  attempts_count        INTEGER,
  repaired              INTEGER,
  total_latency_ms      INTEGER,
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  total_tokens          INTEGER,
  cost_usd              REAL,
  error_code            TEXT,
  error                 TEXT,

  -- σ transition summary
  count_before          INTEGER,
  count_after           INTEGER,
  count_delta           INTEGER,
  fp                    TEXT,                   -- comma-separated control ids
  write_set             TEXT,
  controls_changed      INTEGER,

  -- Standing assertions (§4.6), reported outside the fault taxonomy
  over_reach            INTEGER,
  over_reach_controls   TEXT,
  context_intact        INTEGER,
  history_effective     INTEGER,
  history_displayed     INTEGER,

  -- Full fidelity
  q_json                TEXT,
  v_before_json         TEXT,
  v_after_json          TEXT,
  d_before_json         TEXT,
  d_after_json          TEXT,
  meta_json             TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_created  ON turns (created_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_turns_session  ON turns (session_id, created_ms DESC);
CREATE INDEX IF NOT EXISTS idx_turns_kind     ON turns (kind, created_ms DESC);
CREATE INDEX IF NOT EXISTS idx_turns_model    ON turns (resolved_model, created_ms DESC);
CREATE INDEX IF NOT EXISTS idx_turns_relation ON turns (relation, created_ms DESC);

-- The test report T of Algorithm 1: one row per MR test case over N trials.
CREATE TABLE IF NOT EXISTS mr_cases (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  created_ms            INTEGER NOT NULL,
  relation              TEXT NOT NULL,          -- MR_SE | MR_AC | MR_CA | MR_REV | CONTEXT_AMNESIA
  predicate             TEXT,                   -- Syn | Refine | Indep | Rev
  legacy_name           TEXT,                   -- pre-conformance label, for joining old exports
  source_trace          TEXT,                   -- JSON array of utterances
  followup_trace        TEXT,
  n                     INTEGER NOT NULL,       -- repetition count
  epsilon               REAL NOT NULL,          -- tolerated failure rate
  fails                 INTEGER NOT NULL,
  failure_rate          REAL NOT NULL,
  verdict               TEXT NOT NULL,          -- pass | fail | skipped
  skip_reason           TEXT,
  cov_nl                REAL,
  cov_mr                REAL,
  first_failure_ms      INTEGER,                -- §4.15 time-to-first-failure
  mediator_invocations  INTEGER,                -- §4.15 cost
  total_tokens          INTEGER,
  evidence_turn_ids     TEXT                    -- JSON array; the evidence set E
);

CREATE INDEX IF NOT EXISTS idx_cases_created  ON mr_cases (created_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cases_session  ON mr_cases (session_id, created_ms DESC);
CREATE INDEX IF NOT EXISTS idx_cases_relation ON mr_cases (relation, created_ms DESC);
