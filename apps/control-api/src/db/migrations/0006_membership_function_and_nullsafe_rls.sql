-- 1) Membership resolution must not depend on RLS context (it ESTABLISHES the
--    tenant context). Exposed via a SECURITY DEFINER function with only the
--    execute grant for the app role.
CREATE OR REPLACE FUNCTION get_membership(p_workspace uuid, p_user uuid)
RETURNS TABLE (role text, authz_epoch bigint, workspace_status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role, w.authz_epoch, w.status
  FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.workspace_id = p_workspace AND m.user_id = p_user
$$;

REVOKE ALL ON FUNCTION get_membership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_membership(uuid, uuid) TO crowdlens_app;

-- 2) NULL-safe (and empty-safe) tenant policies: an absent or malformed GUC
--    fails closed instead of raising, so no query path can crash on RLS
--    evaluation. current_setting(..., true) returns NULL when unset; NULLIF
--    also maps the empty string to NULL.
DROP POLICY IF EXISTS workspaces_member ON workspaces;
CREATE POLICY workspaces_member ON workspaces FOR ALL TO crowdlens_app
  USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS memberships_scope ON memberships;
CREATE POLICY memberships_scope ON memberships FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS projects_tenant ON projects;
CREATE POLICY projects_tenant ON projects FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS documents_tenant ON documents;
CREATE POLICY documents_tenant ON documents FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS graphs_tenant ON graphs;
CREATE POLICY graphs_tenant ON graphs FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS graph_nodes_tenant ON graph_nodes;
CREATE POLICY graph_nodes_tenant ON graph_nodes FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS graph_edges_tenant ON graph_edges;
CREATE POLICY graph_edges_tenant ON graph_edges FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS provider_configs_tenant ON provider_configs;
CREATE POLICY provider_configs_tenant ON provider_configs FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS simulations_tenant ON simulations;
CREATE POLICY simulations_tenant ON simulations FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS simulation_events_tenant ON simulation_events;
CREATE POLICY simulation_events_tenant ON simulation_events FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS simulation_shards_tenant ON simulation_shards;
CREATE POLICY simulation_shards_tenant ON simulation_shards FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS usage_records_tenant ON usage_records;
CREATE POLICY usage_records_tenant ON usage_records FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS reports_tenant ON reports;
CREATE POLICY reports_tenant ON reports FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS report_shares_tenant ON report_shares;
CREATE POLICY report_shares_tenant ON report_shares FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS subscriptions_tenant ON subscriptions;
CREATE POLICY subscriptions_tenant ON subscriptions FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS purchases_tenant ON purchases;
CREATE POLICY purchases_tenant ON purchases FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS wallets_tenant ON wallets;
CREATE POLICY wallets_tenant ON wallets FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS ledger_tenant ON credit_ledger_entries;
CREATE POLICY ledger_tenant ON credit_ledger_entries FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS reservations_tenant ON credit_reservations;
CREATE POLICY reservations_tenant ON credit_reservations FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS interviews_tenant ON interviews;
CREATE POLICY interviews_tenant ON interviews FOR ALL TO crowdlens_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  FOR ALL TO crowdlens_app
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);
