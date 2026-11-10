-- Seed server-managed catalog (plans, credit packs). Codes are configuration;
-- Razorpay plan ids are filled when payment plans are created per mode.
INSERT INTO plans
  (code, name, price_minor, currency, interval, included_credits, agent_ceiling, seats, max_concurrent_runs, max_active_projects, razorpay_plan_id_test, razorpay_plan_id_live, active)
VALUES
  ('explorer', 'Explorer', 0, 'INR', 'month', 300, 10000, 1, 1, 1, '', '', true),
  ('professional', 'Professional', 499900, 'INR', 'month', 2500, 100000, 3, 2, 10, '', '', true),
  ('business', 'Business', 1999900, 'INR', 'month', 12000, 1000000, 10, 5, 100, '', '', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO credit_packs (code, credits, price_minor, currency, active)
VALUES
  ('pack-500', 500, 99900, 'INR', true),
  ('pack-2000', 2000, 349900, 'INR', true),
  ('pack-10000', 10000, 1499900, 'INR', true)
ON CONFLICT (code) DO NOTHING;
