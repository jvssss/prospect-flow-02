import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseLocal, type ArquivoUf, type RegistroBase } from "./base-local";
import { limparCooldowns, buscarCnpjGratis } from "./providers";
import { montarAtualizacaoLead } from "./aplicar";
import { resolverQsa } from "./resolve";

const reg = (over: Partial<RegistroBase>): RegistroBase => ({
  cnpj: "11222333000181",
  basico: "11222333",
  matriz: true,
  fantasia: "AUTO ESCOLA FAMA",
  situacao: "02",
  abertura: "2010-05-01",
  bairro: "CENTRO",
  cep: "35160000",
  uf: "MG",
  cidade: "IPATINGA",
  telefone: "3138221234",
  email: null,
  razao: "CENTRO DE FORMACAO DE CONDUTORES FAMA LTDA",
  capital: 50000,
  socios: [
    { nome: "MARIA SOUZA", tipo: "PF", qualificacao: "Sócio", desde: "2015-01-01" },
    { nome: "JOAO DA SILVA", tipo: "PF", qualificacao: "Sócio-Administrador", desde: "2010-05-01" },
  ],
  ...over,
});

const arquivoMG: ArquivoUf = {
  uf: "MG",
  mes: "2026-11",
  fonte: "teste",
  cidades: {
    IPATINGA: [
      reg({}),
      reg({
        cnpj: "00000000000191",
        basico: "00000000",
        fantasia: "AUTO ESCOLA ESTRELA",
        razao: "ESTRELA FORMACAO LTDA",
        telefone: "3133331111",
        socios: [{ nome: "CARLOS PEREIRA", tipo: "PF", qualificacao: "Sócio-Administrador", desde: null }],
      }),
    ],
  },
};

const base = () => new BaseLocal(async (uf) => (uf === "MG" ? arquivoMG : null));

afterEach(() => {
  limparCooldowns();
  vi.restoreAllMocks();
});

describe("resolverQsa", () => {
  it("acha pelo nome na base local e escolhe o sócio-administrador", async () => {
    const r = await resolverQsa({ nomeFantasia: "Auto Escola Fama - Centro", cidade: "Ipatinga", uf: "MG", telefone1: "(31) 3822-1234" }, { base: base() });
    expect(r.encontrado).toBe(true);
    expect(r.estrategia).toBe("base_local");
    expect(r.empresa?.cnpj).toBe("11222333000181");
    expect(r.decisor?.nome).toBe("JOAO DA SILVA");
    expect(r.nivel).toBe("alta");
  });

  it("não inventa: nome sem correspondente na cidade volta como não encontrado", async () => {
    const r = await resolverQsa({ nomeFantasia: "Autoescola Totalmente Diferente Xyz", cidade: "Ipatinga", uf: "MG" }, { base: base() });
    expect(r.encontrado).toBe(false);
    expect(r.estrategia).toBe("nao_encontrado");
    expect(r.tentativas.some((t) => t.fonte === "base_local" && t.resultado === "vazio")).toBe(true);
  });

  it("usa o CNPJ informado direto na base, sem rede", async () => {
    const f = vi.fn();
    const r = await resolverQsa({ cnpj: "00.000.000/0001-91", uf: "MG", nomeFantasia: "Auto Escola Estrela", cidade: "Ipatinga" }, { base: base(), providers: { fetchImpl: f as never } });
    expect(r.empresa?.nomeFantasia).toBe("AUTO ESCOLA ESTRELA");
    expect(r.estrategia).toBe("cnpj_informado");
    expect(f).not.toHaveBeenCalled();
  });

  it("CNPJ achado na web que cai em outra cidade fica com confiança baixa e não é aceito como dono", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          cnpj: "11222333000181", razao_social: "OUTRA FAMA LTDA", nome_fantasia: "AUTO ESCOLA FAMA", situacao_cadastral: 2,
          municipio: "SALVADOR", uf: "BA", qsa: [{ nome_socio: "FULANO DE TAL", qualificacao_socio: "Sócio", identificador_de_socio: 2 }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const r = await resolverQsa(
      { nomeFantasia: "Auto Escola Fama", cidade: "Ipatinga", uf: "SP" }, // UF fora da base
      { base: base(), buscarCnpjPorTexto: async () => "11222333000181", providers: { fetchImpl } },
    );
    expect(r.estrategia).toBe("busca_web");
    expect(r.nivel).toBe("baixa");
    const up = montarAtualizacaoLead(
      { cnpj: null, proprietario: null, email: null, razao_social: null, capital_social: null, data_abertura: null, qsa: null },
      r,
    );
    expect(up.proprietario).toBeUndefined();
    expect(up.enrichment_status).toBe("not_found");
  });
});

describe("montarAtualizacaoLead", () => {
  const vazio = { cnpj: null, proprietario: null, email: null, razao_social: null, capital_social: null, data_abertura: null, qsa: null };

  it("grava dono e sócios quando a confiança é alta", async () => {
    const r = await resolverQsa({ nomeFantasia: "Auto Escola Fama", cidade: "Ipatinga", uf: "MG", telefone1: "3138221234" }, { base: base() });
    const up = montarAtualizacaoLead(vazio, r);
    expect(up.enrichment_status).toBe("enriched");
    expect(up.proprietario).toBe("JOAO DA SILVA");
    expect(up.cnpj).toBe("11222333000181");
    expect(up.cidade).toBeUndefined(); // geografia nunca é tocada
    expect((up.qsa as { nivel: string }).nivel).toBe("alta");
  });

  it("não sobrescreve o decisor que o SDR digitou no Modo Foco", async () => {
    const r = await resolverQsa({ nomeFantasia: "Auto Escola Fama", cidade: "Ipatinga", uf: "MG", telefone1: "3138221234" }, { base: base() });
    const up = montarAtualizacaoLead({ ...vazio, proprietario: "Dona Cida (atendeu)" }, r);
    expect(up.proprietario).toBeUndefined();
    expect(up.cnpj).toBe("11222333000181");
  });

  it("troca o dono que o próprio QSA gravou antes", async () => {
    const r = await resolverQsa({ nomeFantasia: "Auto Escola Fama", cidade: "Ipatinga", uf: "MG", telefone1: "3138221234" }, { base: base() });
    const up = montarAtualizacaoLead({ ...vazio, proprietario: "ANTIGO", qsa: { proprietario_auto: "ANTIGO" } }, r);
    expect(up.proprietario).toBe("JOAO DA SILVA");
  });

  it("falha de rede vira retry e, depois de muitas, not_found", async () => {
    const falha = await resolverQsa({ cnpj: "11222333000181", uf: "SP" }, {
      base: base(),
      providers: { fetchImpl: (async () => new Response("x", { status: 503 })) as unknown as typeof fetch },
    });
    expect(falha.encontrado).toBe(false);
    expect(montarAtualizacaoLead(vazio, falha).enrichment_status).toBe("retry");
    expect(montarAtualizacaoLead({ ...vazio, qsa: { tentativas_de_rede: 4 } }, falha).enrichment_status).toBe("not_found");
  });
});

describe("buscarCnpjGratis", () => {
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
  const brasil = { cnpj: "11222333000181", razao_social: "X", municipio: "IPATINGA", uf: "MG", situacao_cadastral: 2, qsa: [] };

  it("cai para a próxima fonte quando a primeira dá 429 e a coloca em pausa", async () => {
    const chamadas: string[] = [];
    const fetchImpl = (async (url: string) => {
      chamadas.push(url);
      if (url.includes("brasilapi")) return new Response("", { status: 429, headers: { "retry-after": "30" } });
      return ok(brasil);
    }) as unknown as typeof fetch;

    const r1 = await buscarCnpjGratis("11222333000181", { fetchImpl });
    expect(r1.empresa?.fonte).toBe("minhareceita");
    expect(r1.tentativas[0]).toMatchObject({ fonte: "brasilapi", resultado: "limite" });

    chamadas.length = 0;
    const r2 = await buscarCnpjGratis("11222333000181", { fetchImpl });
    expect(chamadas.some((u) => u.includes("brasilapi"))).toBe(false); // não insiste na fonte em pausa
    expect(r2.empresa).not.toBeNull();
  });

  it("404 é 'vazio', não erro, e segue para a próxima", async () => {
    const fetchImpl = (async (url: string) =>
      url.includes("brasilapi") ? new Response("", { status: 404 }) : ok(brasil)) as unknown as typeof fetch;
    const r = await buscarCnpjGratis("11222333000181", { fetchImpl });
    expect(r.tentativas[0].resultado).toBe("vazio");
    expect(r.empresa?.fonte).toBe("minhareceita");
  });

  it("não consulta CNPJ inválido", async () => {
    const f = vi.fn();
    const r = await buscarCnpjGratis("123", { fetchImpl: f as never });
    expect(r.empresa).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
