
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'activate',
  ADD COLUMN IF NOT EXISTS socios JSONB,
  ADD COLUMN IF NOT EXISTS proprietario TEXT,
  ADD COLUMN IF NOT EXISTS sdr_qualification JSONB,
  ADD COLUMN IF NOT EXISTS closer_summary JSONB,
  ADD COLUMN IF NOT EXISTS closer_notes TEXT,
  ADD COLUMN IF NOT EXISTS meeting_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meeting_link TEXT,
  ADD COLUMN IF NOT EXISTS meeting_status TEXT,
  ADD COLUMN IF NOT EXISTS meeting_result TEXT,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_pipeline_stage_idx ON public.leads(user_id, pipeline_stage);
