-- Identity provisioning runs through a SECURITY DEFINER function so the app
-- role can upsert users by (issuer, subject) without broad table rights.
-- The users RLS policy still governs all direct table access (self rows only).
CREATE OR REPLACE FUNCTION provision_user(p_issuer text, p_subject text, p_email text, p_display text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM users WHERE oidc_issuer = p_issuer AND oidc_subject = p_subject;
  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO users (id, oidc_issuer, oidc_subject, email, display_name)
      VALUES (v_id, p_issuer, p_subject, p_email, p_display);
  ELSE
    UPDATE users SET email = p_email, display_name = p_display WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION provision_user(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_user(text, text, text, text) TO crowdlens_app;
