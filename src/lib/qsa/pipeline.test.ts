import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/api/auth.server";
import { processarPendentes, verificarEGravar, type LeadQsaRow } from "./pipeline.server";

const arquivoMG = {
  uf: "MG",
  mes: "2026-11",
  fonte: "teste",
  cidades: {
    IPATINGA: [
      {
        cnpj: "11222333000181", basico: "11222333", matriz: true, fantasia: "AUTO ESCOLA FAMA", situacao: "02",
        abertura: "2010-05-01", bairro: "CENTRO", cep: "35160000", uf: "MG", cidade: "IPATINGA", telefone: "3138221234",
        email: null, razao: "CENTRO DE FORMACAO DE CONDUTORES FAMA LTDA", capital: 50000,
        socios: [{ nome: "JOAO DA SILVA", tipo: "PF", qualificacao: "Sócio-Administrador", desde: "2010-05-01" }],
      },
    ],
  },
};

const lead = (over: Partial<LeadQsaRow> = {}): LeadQsaRow => ({
  id: "lead-1", user_id: "u1", nome_fantasia: "Auto Escola Fama", cidade: "Ipatinga", uf: "MG",
  telefone_1: "(31) 3822-1234", telefone_2: null, cnpj: null, proprietario: null, email: null,
  razao_social: null, capital_social: null, data_abertura: null, qsa: null, enrichment_status: null, ...over,
});

/** Cliente Supabase falso: guarda o que foi gravado e pode simular erros no update. */
function dbFalso(errosDoUpdate: ({ code: string; message: string } | null)[] = []) {
  const gravados: Record<string, unknown>[] = [];
  const fila = [...errosDoUpdate];
  const db = {
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          gravados.push(payload);
          return { error: fila.shift() ?? null };
        },
      }),
    }),
  };
  return { db: db as unknown as Db, gravados };
}

afterEach(() => vi.unstubAllGlobals());

function stubArquivos() {
  vi.stubGlobal("fetch", async (url: string) =>
    String(url).endsWith("/rfb/MG.json") ? new Response(JSON.stringify(arquivoMG)) : new Response("", { status: 404 }),
  );
}

describe("verificarEGravar", () => {
  it("lê a base por HTTP, verifica e grava dono e CNPJ", async () => {
    stubArquivos();
    const { db, gravados } = dbFalso();
    const { resultado } = await verificarEGravar(db, lead(), "http://app.teste", { web: false });
    expect(resultado.nivel).toBe("alta");
    expect(gravados[0]).toMatchObject({ enrichment_status: "enriched", proprietario: "JOAO DA SILVA", cnpj: "11222333000181" });
  });

  it("CNPJ já usado por outro lead do usuário: grava o resto sem o CNPJ e deixa aviso", async () => {
    stubArquivos();
    const { db, gravados } = dbFalso([{ code: "23505", message: "duplicate key value" }]);
    await verificarEGravar(db, lead({ id: "lead-2" }), "http://app.teste-2", { web: false });
    expect(gravados).toHaveLength(2);
    expect(gravados[0]).toHaveProperty("cnpj");
    expect(gravados[1]).not.toHaveProperty("cnpj");
    expect(gravados[1]).toMatchObject({ enrichment_status: "enriched", proprietario: "JOAO DA SILVA" });
    const alertas = (gravados[1].qsa as { alertas: string[] }).alertas.join(" ");
    expect(alertas).toMatch(/já está em outro lead/);
  });

  it("propaga erro de banco que não é de duplicidade", async () => {
    stubArquivos();
    const { db } = dbFalso([{ code: "42501", message: "permission denied" }]);
    await expect(verificarEGravar(db, lead({ id: "lead-3" }), "http://app.teste-3", { web: false })).rejects.toThrow(/permission denied/);
  });
});

describe("processarPendentes", () => {
  it("conta enriquecidos e não-encontrados e respeita o limite de tempo", async () => {
    stubArquivos();
    const linhas = [
      lead({ id: "a" }),
      lead({ id: "b", nome_fantasia: "Autoescola Inexistente Zzz", telefone_1: null }),
    ];
    const gravados: Record<string, unknown>[] = [];
    // select encadeável: sempre devolve as mesmas linhas e a contagem 0.
    const consulta: any = {
      select: () => consulta, not: () => consulta, order: () => consulta, limit: () => consulta,
      or: () => consulta, in: () => consulta, eq: () => consulta,
      then: (ok: (v: unknown) => void) => ok({ data: linhas, count: 0, error: null }),
      update: (p: Record<string, unknown>) => ({ eq: async () => (gravados.push(p), { error: null }) }),
    };
    const db = { from: () => consulta } as unknown as Db;
    const r = await processarPendentes(db, "http://app.teste-4", { userId: "u1", orcamentoMs: 10_000, concorrencia: 2 });
    expect(r.processados).toBe(2);
    expect(r.enriquecidos).toBe(1);
    expect(r.nao_encontrados + r.baixa_confianca).toBe(1);
    expect(r.erros).toBe(0);
  });
});
