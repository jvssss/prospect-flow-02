import { describe, expect, it } from "vitest";
import type { Empresa, Socio } from "./types";
import {
  avaliar,
  cnpjValido,
  compararCidades,
  escolherDecisor,
  normalizarTelefone,
  pesoQualificacao,
  telefonesIguais,
} from "./verify";

const socio = (nome: string, qualificacao: string | null, extra: Partial<Socio> = {}): Socio => ({
  nome,
  qualificacao,
  tipo: "PF",
  desde: null,
  ...extra,
});

const empresa = (over: Partial<Empresa> = {}): Empresa => ({
  cnpj: "11222333000181",
  razaoSocial: "CENTRO DE FORMACAO DE CONDUTORES FAMA LTDA",
  nomeFantasia: "AUTO ESCOLA FAMA",
  situacao: "ativa",
  capitalSocial: 50000,
  dataAbertura: "2010-05-01",
  cidade: "IPATINGA",
  uf: "MG",
  bairro: "CENTRO",
  cep: "35160000",
  telefone: "3138221234",
  email: null,
  socios: [socio("JOAO DA SILVA", "Sócio-Administrador")],
  fonte: "base_local",
  ...over,
});

describe("cnpjValido", () => {
  it("aceita CNPJ real, com ou sem máscara", () => {
    expect(cnpjValido("00000000000191")).toBe(true);
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
  });
  it("rejeita dígito errado, tamanho errado e repetidos", () => {
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("123")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
    expect(cnpjValido(null)).toBe(false);
  });
});

describe("escolherDecisor", () => {
  it("prefere sócio-administrador a sócio comum, mesmo vindo depois na lista", () => {
    const { decisor, outros } = escolherDecisor([
      socio("MARIA SOUZA", "Sócio"),
      socio("PEDRO LIMA", "Sócio-Administrador"),
    ]);
    expect(decisor?.nome).toBe("PEDRO LIMA");
    expect(outros.map((s) => s.nome)).toEqual(["MARIA SOUZA"]);
  });

  it("ignora sócio pessoa jurídica e nome com cara de empresa", () => {
    const { decisor } = escolherDecisor([
      socio("HOLDING FAMA PARTICIPACOES LTDA", "Sócio-Administrador", { tipo: "PJ" }),
      socio("ANA PAULA", "Sócio"),
    ]);
    expect(decisor?.nome).toBe("ANA PAULA");
  });

  it("desempata pelo mais antigo na sociedade", () => {
    const { decisor } = escolherDecisor([
      socio("NOVO SOCIO", "Sócio", { desde: "2022-01-01" }),
      socio("FUNDADOR", "Sócio", { desde: "2005-03-10" }),
    ]);
    expect(decisor?.nome).toBe("FUNDADOR");
  });

  it("devolve null quando só há empresas no QSA", () => {
    expect(escolherDecisor([socio("X PARTICIPACOES LTDA", "Sócio", { tipo: "PJ" })]).decisor).toBeNull();
    expect(escolherDecisor([]).decisor).toBeNull();
  });

  it("reconhece qualificação sem acento ou com variação", () => {
    expect(pesoQualificacao("Socio Administrador")).toBe(100);
    expect(pesoQualificacao("Procurador")).toBeLessThan(pesoQualificacao("Sócio"));
  });
});

describe("telefone e cidade", () => {
  it("normaliza +55, zero e máscara", () => {
    expect(normalizarTelefone("+55 (31) 98822-1234")).toBe("31988221234");
    expect(normalizarTelefone("031 3822-1234")).toBe("3138221234");
    expect(normalizarTelefone("123")).toBeNull();
  });
  it("compara pelos 8 últimos dígitos (ignora o nono dígito)", () => {
    expect(telefonesIguais("(31) 3822-1234", "31 93822-1234")).toBe(true);
    expect(telefonesIguais("(31) 3822-1234", "(31) 3822-9999")).toBe(false);
  });
  it("distingue mesma cidade, região metropolitana e cidade diferente", () => {
    expect(compararCidades("Ipatinga", "IPATINGA")).toBe("igual");
    expect(compararCidades("Timóteo", "Ipatinga")).toBe("regiao");
    expect(compararCidades("Ipatinga", "Belo Horizonte")).toBe("diferente");
    expect(compararCidades(null, "Ipatinga")).toBe("desconhecida");
  });
});

describe("avaliar", () => {
  const lead = { nomeFantasia: "Auto Escola Fama", cidade: "Ipatinga", uf: "MG", telefone1: "(31) 3822-1234" };

  it("dá confiança alta quando nome, cidade, situação, telefone e decisor batem", () => {
    const a = avaliar(lead, empresa());
    expect(a.nivel).toBe("alta");
    expect(a.confianca).toBeGreaterThanOrEqual(90);
    expect(a.alertas).toEqual([]);
  });

  it("derruba a confiança quando a empresa está em outra cidade (homônimo)", () => {
    const a = avaliar(lead, empresa({ cidade: "BELO HORIZONTE", telefone: null }));
    expect(a.nivel).not.toBe("alta");
    expect(a.confianca).toBeLessThanOrEqual(54);
    expect(a.alertas.join(" ")).toMatch(/outra cidade/);
  });

  it("avisa de empresa baixada e não deixa passar como alta", () => {
    const a = avaliar(lead, empresa({ situacao: "baixada" }));
    expect(a.alertas.join(" ")).toMatch(/baixada/);
    expect(a.verificacoes.find((v) => v.id === "empresa_ativa")?.ok).toBe(false);
  });

  it("rejeita CNPJ com dígito verificador inválido", () => {
    const a = avaliar(lead, empresa({ cnpj: "11222333000182" }));
    expect(a.confianca).toBeLessThanOrEqual(10);
    expect(a.nivel).toBe("baixa");
  });

  it("nome muito diferente com telefone igual ainda fica sustentado pelo telefone", () => {
    const a = avaliar(
      { ...lead, nomeFantasia: "Autoescola Estrela do Vale" },
      empresa({ nomeFantasia: "AUTO ESCOLA FAMA", razaoSocial: "FAMA LTDA" }),
    );
    expect(a.verificacoes.find((v) => v.id === "telefone_confere")?.ok).toBe(true);
    expect(a.confianca).toBeGreaterThanOrEqual(50);
  });

  it("sem empresa, confiança zero", () => {
    const a = avaliar(lead, null);
    expect(a.confianca).toBe(0);
    expect(a.nivel).toBe("baixa");
  });
});
