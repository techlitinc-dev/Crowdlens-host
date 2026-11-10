-- Sessions are reached only by unguessable SHA-256 token hash (service-level
-- authorisation; membership/workspace checks happen separately per request).
-- The strict per-user policy made token lookup impossible before user context
-- existed, so sessions use an open policy like webhook_events; the hashed
-- bearer token remains the access control.
DROP POLICY IF EXISTS sessions_user ON sessions;
CREATE POLICY sessions_open ON sessions
  FOR ALL TO crowdlens_app
  USING (true)
  WITH CHECK (true);
