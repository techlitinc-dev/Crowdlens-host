-- CrowdLens initial schema (architecture.md §6.1)
-- Tenant-first composite keys, RLS on every tenant table (forced), app role
-- without RLS bypass, append-only audit.

-- Application role: used by the control API at runtime. NOT the table owner,
-- so FORCE ROW LEVEL SECURITY applies to it (architecture.md §6.2).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crowdlens_app') THEN
    CREATE ROLE crowdlens_app LOGIN PASSWORD 'crowdlens_app_dev';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- identity ----------
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer text NOT NULL DEFAULT '',
  oidc_subject text NOT NULL DEFAULT '',
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_oidc_unique UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_from uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
-- Users see only their own row; sessions are only reachable by unguessable hash
-- (service-level authorisation), so the policy scopes reads to the caller's user.
CREATE POLICY users_self ON users
  FOR ALL TO crowdlens_app
  USING (id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);
CREATE POLICY sessions_user ON sessions
  FOR ALL TO crowdlens_app
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- ---------- tenancy ----------
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  data_policy jsonb NOT NULL DEFAULT '{}',
  plan_code text NOT NULL DEFAULT 'explorer',
  billing_version text NOT NULL DEFAULT '',
  authz_epoch bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','analyst','viewer','billing_admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id text NOT NULL DEFAULT '',
  request_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_member ON workspaces FOR ALL TO crowdlens_app
  USING (id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY memberships_scope ON memberships FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
-- audit: app role may insert and select only (append-only, OPS-02).
REVOKE UPDATE, DELETE ON audit_logs FROM crowdlens_app;

-- ---------- projects & documents ----------
CREATE TABLE IF NOT EXISTS projects (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  decision_question text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  stage text NOT NULL DEFAULT 'evidence',
  version bigint NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id)
);
CREATE TRIGGER projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS documents (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  parser_version text NOT NULL DEFAULT 'parse-v1',
  parse_status text NOT NULL DEFAULT 'uploaded',
  parse_artifact_key text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (workspace_id, project_id);
CREATE INDEX IF NOT EXISTS documents_hash_idx ON documents (workspace_id, sha256);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant ON projects FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY documents_tenant ON documents FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ---------- graphs (metadata; nodes/edges behind GraphStorage port) ----------
CREATE TABLE IF NOT EXISTS graphs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  embedding_profile text NOT NULL DEFAULT 'ollama-nomic-embed-v1',
  schema_version text NOT NULL DEFAULT 'graph-v1',
  source_set_hash text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  node_count int NOT NULL DEFAULT 0,
  edge_count int NOT NULL DEFAULT 0,
  artifact_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  workspace_id uuid NOT NULL,
  graph_id uuid NOT NULL,
  node_id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}',
  embedding jsonb,
  PRIMARY KEY (workspace_id, graph_id, node_id),
  FOREIGN KEY (workspace_id, graph_id) REFERENCES graphs(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS graph_edges (
  workspace_id uuid NOT NULL,
  graph_id uuid NOT NULL,
  src text NOT NULL,
  dst text NOT NULL,
  kind text NOT NULL DEFAULT 'related',
  attrs jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (workspace_id, graph_id) REFERENCES graphs(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE graphs FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY graphs_tenant ON graphs FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY graph_nodes_tenant ON graph_nodes FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY graph_edges_tenant ON graph_edges FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ---------- providers ----------
CREATE TABLE IF NOT EXISTS provider_configs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gemini','openrouter')),
  label text NOT NULL DEFAULT '',
  model_allowlist jsonb NOT NULL DEFAULT '[]',
  secret_ref text NOT NULL DEFAULT '',
  byok_encrypted text,
  data_policy jsonb NOT NULL DEFAULT '{"data_collection":"deny","zdr":false}',
  is_default boolean NOT NULL DEFAULT false,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

ALTER TABLE provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_configs_tenant ON provider_configs FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ---------- simulations ----------
CREATE TABLE IF NOT EXISTS simulations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  config_hash text NOT NULL,
  config jsonb NOT NULL,
  manifest jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','preparing','running','finalizing','completed','paused','failed','cancelled')),
  seed bigint NOT NULL,
  rate_card_version text NOT NULL,
  reservation_id uuid,
  credits_reserved integer,
  credits_used integer NOT NULL DEFAULT 0,
  cancel_requested_at timestamptz,
  error text,
  lineage_parent uuid,
  version bigint NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER simulations_updated BEFORE UPDATE ON simulations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS simulations_config_dedupe ON simulations (workspace_id, project_id, config_hash);

CREATE TABLE IF NOT EXISTS simulation_events (
  workspace_id uuid NOT NULL,
  simulation_id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  type text NOT NULL,
  tick integer,
  shard integer,
  payload jsonb NOT NULL DEFAULT '{}',
  authz_epoch bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, simulation_id, seq),
  FOREIGN KEY (workspace_id, simulation_id) REFERENCES simulations(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation_shards (
  workspace_id uuid NOT NULL,
  simulation_id uuid NOT NULL,
  shard_index integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  tick integer NOT NULL DEFAULT 0,
  checkpoint_key text,
  heartbeat_at timestamptz,
  PRIMARY KEY (workspace_id, simulation_id, shard_index),
  FOREIGN KEY (workspace_id, simulation_id) REFERENCES simulations(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_records (
  workspace_id uuid NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY,
  simulation_id uuid NOT NULL,
  activity_attempt text NOT NULL,
  usage_type text NOT NULL,
  provider text NOT NULL DEFAULT '',
  model_id text NOT NULL DEFAULT '',
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cached_input_tokens bigint NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  cost_micro_usd bigint,
  is_estimate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (simulation_id, activity_attempt, usage_type)
);

ALTER TABLE simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulations FORCE ROW LEVEL SECURITY;
ALTER TABLE simulation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE simulation_shards ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_shards FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
CREATE POLICY simulations_tenant ON simulations FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY simulation_events_tenant ON simulation_events FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY simulation_shards_tenant ON simulation_shards FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY usage_records_tenant ON usage_records FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ---------- reports & shares ----------
CREATE TABLE IF NOT EXISTS reports (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  simulation_id uuid NOT NULL,
  version integer NOT NULL,
  content_hash text NOT NULL,
  object_key text NOT NULL,
  evidence_manifest jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, simulation_id, version),
  FOREIGN KEY (workspace_id, simulation_id) REFERENCES simulations(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_shares (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'summary',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES reports(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
ALTER TABLE report_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY reports_tenant ON reports FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY report_shares_tenant ON report_shares FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ---------- commercial ----------
CREATE TABLE IF NOT EXISTS plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  price_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  interval text NOT NULL DEFAULT 'month',
  included_credits integer NOT NULL DEFAULT 0,
  agent_ceiling integer NOT NULL DEFAULT 10000,
  seats integer NOT NULL DEFAULT 1,
  max_concurrent_runs integer NOT NULL DEFAULT 1,
  max_active_projects integer NOT NULL DEFAULT 1,
  razorpay_plan_id_test text NOT NULL DEFAULT '',
  razorpay_plan_id_live text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS credit_packs (
  code text PRIMARY KEY,
  credits integer NOT NULL,
  price_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_code text NOT NULL REFERENCES plans(code),
  razorpay_customer_id text NOT NULL DEFAULT '',
  razorpay_subscription_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS purchases (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pack_code text NOT NULL REFERENCES credit_packs(code),
  credits integer NOT NULL,
  amount_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  razorpay_order_id text NOT NULL UNIQUE,
  razorpay_payment_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS wallets (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  available integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('plan_grant','topup_grant','reservation','reservation_release','usage_debit','adjustment','expiration')),
  amount integer NOT NULL,
  idempotency_key text NOT NULL,
  rate_card_version text NOT NULL,
  actor text NOT NULL DEFAULT '',
  event_ref text NOT NULL DEFAULT '',
  simulation_id uuid,
  reason text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_idempotency_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS credit_reservations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  simulation_id uuid NOT NULL UNIQUE,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

-- ---------- integration ----------
CREATE TABLE IF NOT EXISTS webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  event_key text NOT NULL,
  entity_id text NOT NULL DEFAULT '',
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  headers jsonb NOT NULL DEFAULT '{}',
  signature_valid boolean NOT NULL DEFAULT false,
  processing_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_event_key_unique UNIQUE (provider, event_key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL,
  aggregate_id text NOT NULL,
  correlation_id text,
  causation_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz
);

CREATE TABLE IF NOT EXISTS cache_versions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scope)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor, route, key)
);

-- ---------- durable work queue (runner / workers) ----------
CREATE TABLE IF NOT EXISTS work_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('document.parse','graph.build','simulation.stage','report.generate')),
  ref_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','done','failed','cancelled')),
  lease_owner text,
  lease_expires timestamptz,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_items_claim_idx ON work_items (status, kind, id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant ON subscriptions FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY purchases_tenant ON purchases FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY wallets_tenant ON wallets FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY ledger_tenant ON credit_ledger_entries FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY reservations_tenant ON credit_reservations FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- webhook_events/outbox_events/work_items are processed with row-level guards
-- (unique keys, leases) rather than workspace RLS; no tenant column reads.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_service ON webhook_events FOR ALL TO crowdlens_app
  USING (true) WITH CHECK (true);

-- ---------- grants ----------
GRANT USAGE ON SCHEMA public TO crowdlens_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crowdlens_app;
GRANT SELECT, INSERT ON audit_logs TO crowdlens_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crowdlens_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crowdlens_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crowdlens_app;
