import { matchAutoescola, normCidade, type RfbEstab } from "@/lib/rfb-match";
import { situacaoDoCodigoReceita } from "./situacao";
import { telefonesIguais } from "./verify";
import type { Empresa, Socio } from "./types";

/**
 * Base local de autoescolas (CNAE 8599-6/01), um JSON por UF em `public/rfb/`.
 * Gerada a partir dos dados abertos de CNPJ da Receita Federal por
 * `scripts/build-rfb.py`. Sem limite de consulta, sem custo, sem rede externa.
 */

export type RegistroBase = {
  cnpj: string;
  basico: string;
  matriz: boolean;
  fantasia: string | null;
  situacao: string; // código da Receita: 02 ativa, 03 suspensa, 04 inapta
  abertura: string | null;
  bairro: string | null;
  cep: string | null;
  uf: string | null;
  cidade: string | null;
  telefone: string | null;
  email: string | null;
  razao: string | null;
  capital: number | null;
  socios: { nome: string; tipo: string | null; qualificacao: string | null; desde: string | null }[];
};

export type ArquivoUf = {
  uf: string;
  mes: string;
  fonte: string;
  cidades: Record<string, RegistroBase[]>;
};

export type CarregadorUf = (uf: string) => Promise<ArquivoUf | null>;

export function paraEmpresa(r: RegistroBase): Empresa {
  return {
    cnpj: r.cnpj,
    razaoSocial: r.razao,
    nomeFantasia: r.fantasia,
    situacao: situacaoDoCodigoReceita(r.situacao),
    capitalSocial: r.capital,
    dataAbertura: r.abertura,
    cidade: r.cidade,
    uf: r.uf,
    bairro: r.bairro,
    cep: r.cep,
    telefone: r.telefone,
    email: r.email,
    socios: r.socios.map(
      (s): Socio => ({
        nome: s.nome,
        qualificacao: s.qualificacao,
        tipo: s.tipo === "PF" || s.tipo === "PJ" || s.tipo === "EX" ? s.tipo : null,
        desde: s.desde,
      }),
    ),
    fonte: "base_local",
  };
}

function paraRfbEstab(r: RegistroBase): RfbEstab {
  return {
    cnpj: r.cnpj,
    cnpj_basico: r.basico,
    nome_fantasia: r.fantasia,
    razao_social: r.razao,
    cidade: r.cidade,
    uf: r.uf,
    bairro: r.bairro,
    cep: r.cep,
    telefone: r.telefone,
    ativa: r.situacao === "02",
  };
}

export type AcheiNaBase = {
  empresa: Empresa;
  /** Semelhança de nome já calculada pelo casamento (0..1). */
  similaridade: number;
  /** Tokens raros do nome que sustentaram o casamento. */
  tokensFortes: string[];
};

export class BaseLocal {
  private cache = new Map<string, Promise<ArquivoUf | null>>();
  private indicePorCnpj = new Map<string, Map<string, RegistroBase>>();

  constructor(private carregar: CarregadorUf) {}

  /** O arquivo da UF fica em memória enquanto o processo viver: os dados são mensais. */
  async arquivo(uf: string | null | undefined): Promise<ArquivoUf | null> {
    const k = (uf ?? "").trim().toUpperCase();
    if (k.length !== 2) return null;
    let p = this.cache.get(k);
    if (!p) {
      p = this.carregar(k).catch(() => null);
      this.cache.set(k, p);
      // Não guarda falha: se o arquivo não carregou agora, tenta de novo na próxima.
      p.then((v) => {
        if (!v) this.cache.delete(k);
      });
    }
    return p;
  }

  async temCidade(cidade: string, uf: string): Promise<boolean> {
    const a = await this.arquivo(uf);
    return !!a?.cidades[normCidade(cidade)]?.length;
  }

  async porNome(
    nome: string,
    cidade: string,
    uf: string | null | undefined,
    bairro?: string | null,
    telefones: (string | null | undefined)[] = [],
  ): Promise<AcheiNaBase | null> {
    const a = await this.arquivo(uf);
    const lista = a?.cidades[normCidade(cidade)];
    if (!lista?.length) return null;

    // Telefone é a chave mais forte: se algum candidato tem o mesmo número e o
    // nome é compatível, ele ganha de homônimos (duas empresas com o mesmo nome
    // de fachada na cidade são comuns).
    const mesmoFone = (r: RegistroBase) => telefones.some((t) => telefonesIguais(t, r.telefone));
    const comFone = lista.filter(mesmoFone);
    const hit =
      (comFone.length ? matchAutoescola(nome, cidade, comFone.map(paraRfbEstab), { bairro }) : null) ??
      matchAutoescola(nome, cidade, lista.map(paraRfbEstab), { bairro });
    if (!hit) return null;
    const achado = lista.find((r) => r.cnpj === hit.estab.cnpj);
    if (!achado) return null;

    // Rede com várias filiais (mesma raiz de CNPJ, mesmos sócios): entre elas,
    // fica a que tem o telefone do lead; senão a do mesmo bairro; senão a escolhida.
    const irmas = lista.filter((r) => r.basico === achado.basico);
    const bairroLead = normCidade(bairro);
    const reg =
      irmas.find(mesmoFone) ?? (bairroLead ? irmas.find((r) => normCidade(r.bairro) === bairroLead) : undefined) ?? achado;
    return {
      empresa: paraEmpresa(reg),
      similaridade: Math.max(hit.sim, hit.strong.length ? 0.78 : 0),
      tokensFortes: hit.strong,
    };
  }

  async porCnpj(cnpj: string, uf: string | null | undefined): Promise<Empresa | null> {
    const a = await this.arquivo(uf);
    if (!a) return null;
    let idx = this.indicePorCnpj.get(a.uf);
    if (!idx) {
      idx = new Map();
      for (const lista of Object.values(a.cidades)) for (const r of lista) idx.set(r.cnpj, r);
      this.indicePorCnpj.set(a.uf, idx);
    }
    const r = idx.get(cnpj.replace(/\D/g, ""));
    return r ? paraEmpresa(r) : null;
  }
}

/** Carregador para o servidor: busca o JSON estático servido junto com o app. */
export function carregadorPorHttp(origem: string, fetchImpl: typeof fetch = fetch): CarregadorUf {
  return async (uf) => {
    const res = await fetchImpl(`${origem.replace(/\/$/, "")}/rfb/${uf}.json`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ArquivoUf;
  };
}
