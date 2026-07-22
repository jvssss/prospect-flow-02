
CREATE EXTENSION IF NOT EXISTS unaccent;

UPDATE public.leads l
SET
  cidade = j.city,
  cnpj = NULL,
  razao_social = NULL,
  capital_social = NULL,
  data_abertura = NULL,
  bairro = NULL,
  endereco = NULL,
  uf = NULL,
  socios = NULL,
  proprietario = NULL,
  email = NULL,
  enrichment_status = 'retry'
FROM public.enrichment_jobs j
WHERE l.enrichment_job_id = j.id
  AND l.cidade IS NOT NULL
  AND j.city IS NOT NULL
  AND lower(public.unaccent(trim(l.cidade))) <> lower(public.unaccent(trim(j.city)))
  AND lower(public.unaccent(trim(l.cidade))) NOT LIKE '%' || lower(public.unaccent(trim(j.city))) || '%'
  AND lower(public.unaccent(trim(j.city))) NOT LIKE '%' || lower(public.unaccent(trim(l.cidade))) || '%';
