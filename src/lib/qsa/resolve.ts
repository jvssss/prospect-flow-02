import type { BaseLocal } from "./base-local";
import { buscarCnpjGratis, type OpcoesBusca, type Tentativa } from "./providers";
import type { Empresa, EntradaLead, ResultadoQsa } from "./types";
import { avaliar, cnpjValido, escolherDecisor, soDigitos } from "./verify";

export type DepsResolver = {
  base?: BaseLocal | null;
  /** Último recurso: descobrir um CNPJ por texto (ex.: busca na web). */
  buscarCnpjPorTexto?: (nome: string, cidade: string | null) => Promise<string | null>;
  providers?: OpcoesBusca;
};

/**
 * Do lead ao decisor verificado, só com fontes gratuitas.
 *
 * Ordem (a mais barata e mais confiável primeiro):
 *   1. CNPJ já conhecido  -> base local; se não estiver lá, fontes gratuitas.
 *   2. Nome + cidade      -> base local da Receita (sem rede).
 *   3. Busca por texto    -> CNPJ candidato, confirmado nas fontes gratuitas.
 *
 * Todo resultado passa por `avaliar`: um CNPJ achado por texto só é aceito se
 * a cidade e o nome baterem, então um homônimo de outra cidade cai em "baixa".
 */
export async function resolverQsa(entrada: EntradaLead, deps: DepsResolver = {}): Promise<ResultadoQsa> {
  const tentativas: Tentativa[] = [];
  const nome = entrada.nomeFantasia?.trim() || null;
  const cidade = entrada.cidade?.trim() || null;
  const cnpjInformado = soDigitos(entrada.cnpj);

  let empresa: Empresa | null = null;
  let estrategia: ResultadoQsa["estrategia"] = "nao_encontrado";
  let similaridade: number | undefined;

  const viaCnpj = async (cnpj: string): Promise<Empresa | null> => {
    const local = deps.base ? await deps.base.porCnpj(cnpj, entrada.uf) : null;
    if (local) {
      tentativas.push({ fonte: "base_local", resultado: "ok", detalhe: "por CNPJ" });
      return local;
    }
    if (deps.base) tentativas.push({ fonte: "base_local", resultado: "vazio", detalhe: "CNPJ fora da base" });
    const r = await buscarCnpjGratis(cnpj, deps.providers);
    tentativas.push(...r.tentativas);
    return r.empresa;
  };

  // 1) CNPJ informado
  if (cnpjInformado) {
    if (cnpjValido(cnpjInformado)) {
      empresa = await viaCnpj(cnpjInformado);
      if (empresa) estrategia = "cnpj_informado";
    } else {
      tentativas.push({ fonte: "validacao", resultado: "erro", detalhe: "CNPJ informado é inválido; buscando pelo nome." });
    }
  }

  // 2) Nome + cidade na base local
  if (!empresa && nome && cidade && deps.base) {
    const hit = await deps.base.porNome(nome, cidade, entrada.uf, entrada.bairro, [entrada.telefone1, entrada.telefone2]);
    if (hit) {
      empresa = hit.empresa;
      similaridade = hit.similaridade;
      estrategia = "base_local";
      tentativas.push({ fonte: "base_local", resultado: "ok", detalhe: `por nome (${hit.tokensFortes.join(", ") || "semelhança"})` });
    } else {
      const temCidade = await deps.base.temCidade(cidade, entrada.uf ?? "");
      tentativas.push({
        fonte: "base_local",
        resultado: "vazio",
        detalhe: temCidade ? "cidade na base, nenhum nome casou" : "cidade ou UF fora da base",
      });
    }
  }

  // 3) Busca por texto -> CNPJ -> fontes gratuitas
  if (!empresa && nome && deps.buscarCnpjPorTexto) {
    try {
      const achado = await deps.buscarCnpjPorTexto(nome, cidade);
      if (achado && cnpjValido(achado)) {
        empresa = await viaCnpj(soDigitos(achado));
        if (empresa) estrategia = "busca_web";
      } else {
        tentativas.push({ fonte: "busca_web", resultado: "vazio" });
      }
    } catch (e) {
      tentativas.push({ fonte: "busca_web", resultado: "erro", detalhe: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }

  const av = avaliar(entrada, empresa, { similaridade });
  const { decisor, outros } = empresa ? escolherDecisor(empresa.socios) : { decisor: null, outros: [] };

  // Rejeita o que a avaliação já considera descartável, em vez de gravar lixo no lead.
  const aceitavel = !!empresa && av.verificacoes.find((v) => v.id === "cnpj_valido")?.ok !== false;

  return {
    encontrado: aceitavel,
    empresa: aceitavel ? empresa : null,
    decisor: aceitavel ? decisor : null,
    outrosSocios: aceitavel ? outros : [],
    confianca: av.confianca,
    nivel: av.nivel,
    verificacoes: av.verificacoes,
    alertas: av.alertas,
    estrategia: aceitavel ? estrategia : "nao_encontrado",
    tentativas,
  };
}
