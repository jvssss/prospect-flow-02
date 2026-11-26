-- Chaves de API (n8n, WhatsApp, outros sistemas).
-- Só o hash SHA-256 é guardado; o valor completo aparece uma única vez, ao criar.
-- RLS ligado e SEM políticas de propósito: só a chave de serviço (servidor) acessa.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx ON public.api_keys (user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Fila de verificação do QSA: a rotina automática lê só o que está pendente.
CREATE INDEX IF NOT EXISTS leads_qsa_pendentes_idx
  ON public.leads (created_at)
  WHERE enrichment_status IS NULL OR enrichment_status = 'retry';

-- Detecção de duplicados por telefone na criação e no ingest.
-- (CNPJ já tem o índice único leads_user_cnpj_unique, e daily_metrics já tem UNIQUE(user_id, day).)
CREATE INDEX IF NOT EXISTS leads_user_telefone_idx ON public.leads (user_id, telefone_1) WHERE telefone_1 IS NOT NULL;
