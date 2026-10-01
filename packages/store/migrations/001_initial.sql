CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS accounts(
 id uuid PRIMARY KEY, owner_id text NOT NULL, marketplace text NOT NULL CHECK (marketplace='amazon.com'),
 session_generation integer NOT NULL DEFAULT 1, enabled boolean NOT NULL DEFAULT true, quarantined boolean NOT NULL DEFAULT false,
 quarantine_reason text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id, marketplace)
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS intents(
 id uuid PRIMARY KEY, owner_id text NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id),
 kind text NOT NULL, terms text NOT NULL, digest text NOT NULL, session_generation integer NOT NULL,
 expires_at timestamptz NOT NULL, approved_at timestamptz, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations(
 id uuid PRIMARY KEY, owner_id text NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id),
 kind text NOT NULL, mode text NOT NULL CHECK (mode IN ('read','write','commit')),
 input text NOT NULL, input_digest text NOT NULL, idempotency_key text NOT NULL,
 intent_id uuid UNIQUE REFERENCES intents(id), status text NOT NULL DEFAULT 'queued', revision integer NOT NULL DEFAULT 1,
 result text, worker_id text, started_at timestamptz, heartbeat_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS observations(
 id uuid PRIMARY KEY, owner_id text NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id),
 subject text NOT NULL, kind text NOT NULL, value text NOT NULL, digest text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS observations_subject ON observations(owner_id,account_id,subject,observed_at DESC);
CREATE TABLE IF NOT EXISTS watches(
 id uuid PRIMARY KEY, owner_id text NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id),
 kind text NOT NULL, input text NOT NULL, request_key text NOT NULL, input_digest text NOT NULL,
 cadence_seconds integer NOT NULL CHECK(cadence_seconds BETWEEN 300 AND 604800),
 paused boolean NOT NULL DEFAULT false, expires_at timestamptz, next_due timestamptz NOT NULL DEFAULT now(),
 last_success timestamptz, last_digest text, last_value text, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,request_key)
);
CREATE TABLE IF NOT EXISTS events(
 sequence bigserial PRIMARY KEY, id uuid UNIQUE NOT NULL, owner_id text NOT NULL, watch_id uuid REFERENCES watches(id) ON DELETE SET NULL,
 kind text NOT NULL, payload text NOT NULL, acknowledged_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit(
 sequence bigserial PRIMARY KEY, owner_id text NOT NULL, action text NOT NULL, resource_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS worker_health(id text PRIMARY KEY, heartbeat_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS operations_owner_recent ON operations(owner_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS operations_owner_account_status ON operations(owner_id,account_id,status);
INSERT INTO schema_migrations(version) VALUES ('001') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_deliveries(
 event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 channel text NOT NULL DEFAULT 'desktop', status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','dispatching','sent','failed','outcome_unknown')),
 result_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_pending ON notification_deliveries(created_at) WHERE status='pending';
ALTER TABLE watches ADD COLUMN IF NOT EXISTS price_threshold text;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS provenance text;
