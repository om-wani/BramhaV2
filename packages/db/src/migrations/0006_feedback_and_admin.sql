-- 0006: admin flag + demo feedback

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    text NOT NULL,
  path       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback(user_id);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at DESC);

-- Bootstrap: make the demo account an admin so godmode is reachable.
UPDATE users SET is_admin = true WHERE email = 'demo@northwind.com';
