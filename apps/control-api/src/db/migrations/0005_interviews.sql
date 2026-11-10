-- Agent interviews (RPT-06): provenance-labelled, never mistaken for testimony.
CREATE TABLE IF NOT EXISTS interviews (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  agent_ref text NOT NULL,
  question text NOT NULL,
  response jsonb,
  provenance text NOT NULL DEFAULT 'llm_generated',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES reports(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews FORCE ROW LEVEL SECURITY;
CREATE POLICY interviews_tenant ON interviews FOR ALL TO crowdlens_app
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON interviews TO crowdlens_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO crowdlens_app;
