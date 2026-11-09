-- ============================================================
-- Bảng lưu trạng thái phỏng vấn AI
-- Chạy trong Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS interview_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'started',
  answers         JSONB NOT NULL DEFAULT '{}',
  score           INTEGER,
  score_breakdown JSONB,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_status
  ON interview_sessions (user_id, status);

-- ============================================================
-- Bảng matches (dùng cho Matching Engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  job_post_id     UUID NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  score_breakdown JSONB,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_post_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_user_id ON matches (user_id);
CREATE INDEX IF NOT EXISTS idx_matches_score ON matches (score DESC);

-- ============================================================
-- Bảng reputation_events (dùng cho Matching Engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS reputation_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL,
  event_type TEXT NOT NULL,
  delta      INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reputation_shop ON reputation_events (shop_id);
