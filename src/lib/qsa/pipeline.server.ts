import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/api/auth.server";
import { BaseLocal, carregadorPorHttp } from "./base-local";
import { montarAtualizacaoLead, type LeadParaQsa } from "./aplicar";
import { buscarCnpjPorTexto } from "./busca-web";
import { resolverQsa } from "./resolve";
import type { ResultadoQsa } from "./types";

const bases = new Map<string, BaseLocal>();

/** Uma base por origem; os arquivos de UF ficam em memória depois do primeiro uso. */
export function baseLocalPara(origem: string): BaseLocal {
  const o = process.env.RFB_BASE_URL?.trim() || origem;
  let b = bases.get(o);
  if (!b) {
    b = new BaseLocal(carregadorPorHttp(o));
    bases.set(o, b);
  }
  return b;
}

const COLUNAS_LEAD =
  "id,user_id,nome_fantasia,cidade,uf,bairro,cnpj,telefone_1,telefone_2,proprietario,email,razao_social,capital_social,data_abertura,qsa,enrichment_status";

export type LeadQsaRow = LeadParaQsa & {
  id: string;
  user_id: string;
  nome_fantasia: string | null;
  cidade: string | null;
  uf: string | null;
  bairro?: string | null;
  telefone_1: string | null;
  telefone_2: string | null;
  enrichment_status: string | null;
};

export async function verificarLeadRow(
  lead: LeadQsaRow,
  origem: string,
  opcoes: { web?: boolean } = {},
): Promise<ResultadoQsa> {
  return resolverQsa(
    {
      nomeFantasia: lead.nome_fantasia,
      cidade: lead.cidade,
      uf: lead.uf,
      bairro: lead.bairro,
      cnpj: lead.cnpj,
      telefone1: lead.telefone_1,
      telefone2: lead.telefone_2,
    },
    {
      base: baseLocalPara(origem),
      buscarCnpjPorTexto: opcoes.web === false ? undefined : buscarCnpjPorTexto,
    },
  );
}

/** Verifica um lead e grava o resultado. Devolve o laudo e o que foi gravado. */
export async function verificarEGravar(
  db: Db,
  lead: LeadQsaRow,
  origem: string,
  opcoes: { web?: boolean } = {},
) {
  const resultado = await verificarLeadRow(lead, origem, opcoes);
  let atualizacao = montarAtualizacaoLead(lead, resultado);
  let { error } = await db.from("leads").update(atualizacao as never).eq("id", lead.id);

  // (user_id, cnpj) é único: se outro lead do mesmo usuário já tem este CNPJ, a
  // mesma empresa foi listada duas vezes no Maps. Grava tudo menos o CNPJ e
  // deixa o aviso no laudo, em vez de travar o lead em "pendente" para sempre.
  if (error?.code === "23505" && "cnpj" in atualizacao) {
    const { cnpj: repetido, ...resto } = atualizacao;
    const qsa = resto.qsa as { alertas?: string[] } | undefined;
    if (qsa) qsa.alertas = [...(qsa.alertas ?? []), `CNPJ ${repetido} já está em outro lead seu (empresa listada duas vezes).`];
    atualizacao = resto as typeof atualizacao;
    ({ error } = await db.from("leads").update(atualizacao as never).eq("id", lead.id));
  }
  if (error) throw new Error(error.message);
  return { resultado, atualizacao };
}

export type ResumoLote = {
  processados: number;
  enriquecidos: number;
  baixa_confianca: number;
  nao_encontrados: number;
  inativos: number;
  tentar_novamente: number;
  erros: number;
  restantes: number;
  esgotou_tempo: boolean;
  ms: number;
};

/**
 * Processa leads ainda não verificados (`enrichment_status` nulo ou `retry`).
 * Base local resolve quase tudo sem rede, então a concorrência pode ser alta;
 * o orçamento de tempo protege o limite de execução do Worker.
 */
export async function processarPendentes(
  db: Db,
  origem: string,
  opcoes: { userId?: string; limite?: number; orcamentoMs?: number; concorrencia?: number; leadIds?: string[] } = {},
): Promise<ResumoLote> {
  const t0 = Date.now();
  const orcamento = opcoes.orcamentoMs ?? 20_000;
  const limite = Math.min(opcoes.limite ?? 100, 500);
  const sb = db as unknown as SupabaseClient;

  let q = sb
    .from("leads")
    .select(COLUNAS_LEAD)
    .not("nome_fantasia", "is", null)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (opcoes.leadIds?.length) q = q.in("id", opcoes.leadIds);
  else q = q.or("enrichment_status.is.null,enrichment_status.eq.retry");
  if (opcoes.userId) q = q.eq("user_id", opcoes.userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const fila = (data ?? []) as unknown as LeadQsaRow[];
  const resumo: ResumoLote = {
    processados: 0,
    enriquecidos: 0,
    baixa_confianca: 0,
    nao_encontrados: 0,
    inativos: 0,
    tentar_novamente: 0,
    erros: 0,
    restantes: 0,
    esgotou_tempo: false,
    ms: 0,
  };

  let i = 0;
  const trabalhadores = Array.from({ length: opcoes.concorrencia ?? 6 }, async () => {
    while (i < fila.length) {
      if (Date.now() - t0 > orcamento) {
        resumo.esgotou_tempo = true;
        return;
      }
      const lead = fila[i++];
      try {
        const { resultado, atualizacao } = await verificarEGravar(db, lead, origem);
        resumo.processados++;
        const st = atualizacao.enrichment_status;
        if (st === "enriched") resumo.enriquecidos++;
        else if (st === "inactive") resumo.inativos++;
        else if (st === "retry") resumo.tentar_novamente++;
        else if (resultado.encontrado && resultado.nivel === "baixa") resumo.baixa_confianca++;
        else resumo.nao_encontrados++;
      } catch {
        resumo.erros++;
      }
    }
  });
  await Promise.all(trabalhadores);

  let cont = sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("nome_fantasia", "is", null)
    .or("enrichment_status.is.null,enrichment_status.eq.retry");
  if (opcoes.userId) cont = cont.eq("user_id", opcoes.userId);
  const { count } = await cont;
  resumo.restantes = count ?? 0;
  resumo.ms = Date.now() - t0;
  return resumo;
}
