-- Colunas e tabelas que o código usa e que tinham sido criadas direto no banco
-- do Lovable, fora das migrações. Reconstruído a partir do código.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS cadencia_etapa int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cadencia_proximo_em timestamptz,
  ADD COLUMN IF NOT EXISTS cadencia_status text,
  ADD COLUMN IF NOT EXISTS google_meu_negocio text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS meta_ads text,
  ADD COLUMN IF NOT EXISTS google_ads text,
  ADD COLUMN IF NOT EXISTS social_media text;

CREATE INDEX IF NOT EXISTS leads_cadencia_proximo_idx ON public.leads (cadencia_proximo_em);
CREATE INDEX IF NOT EXISTS leads_user_gmn_idx ON public.leads (user_id, google_meu_negocio) WHERE google_meu_negocio IS NOT NULL;

-- Histórico de toques da cadência (WhatsApp / ligação).
CREATE TABLE IF NOT EXISTS public.disparos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canal text NOT NULL,
  etapa int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disparos_lead_idx ON public.disparos (lead_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disparos TO authenticated;
GRANT ALL ON public.disparos TO service_role;
ALTER TABLE public.disparos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shared all disparos" ON public.disparos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Log de falhas do enriquecimento. Só o servidor (service role) escreve.
CREATE TABLE IF NOT EXISTS public.diagnosticos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contexto text,
  mensagem text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.diagnosticos ENABLE ROW LEVEL SECURITY;
