import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BaseLocal, type ArquivoUf } from "./base-local";
import { resolverQsa } from "./resolve";

/**
 * Teste de fumaça com a base REAL de `public/rfb/`. Pula sozinho se a pasta
 * ainda não foi gerada (`npm run rfb:build`).
 *
 * Método: pega autoescolas reais de uma cidade e pergunta ao resolvedor por
 * elas com o nome "como o Google Maps escreve" (nome de fachada com sufixo de
 * bairro). Se ele devolver outro CNPJ, é falso positivo, o erro que importa.
 */
const dir = join(process.cwd(), "public", "rfb");
const temBase = existsSync(join(dir, "MG.json"));

const carregar = async (uf: string): Promise<ArquivoUf | null> => {
  const f = join(dir, `${uf}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf-8")) as ArquivoUf) : null;
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** Mesmo CNPJ, ou outra filial/registro do mesmo negócio (mesmo nome ou mesmos sócios). */
function mesmaEmpresa(achada: { cnpj: string; nomeFantasia: string | null; socios: { nome: string }[] } | null, real: { cnpj: string; fantasia: string | null; socios: { nome: string }[] }) {
  if (!achada) return false;
  if (achada.cnpj === real.cnpj) return true;
  if (norm(achada.nomeFantasia) && norm(achada.nomeFantasia) === norm(real.fantasia)) return true;
  const a = new Set(achada.socios.map((s) => s.nome));
  return real.socios.length > 0 && real.socios.every((s) => a.has(s.nome));
}

describe.skipIf(!temBase)("base real da Receita", () => {
  const base = new BaseLocal(carregar);

  it("tem decisor pessoa física na grande maioria das autoescolas", async () => {
    const mg = (await base.arquivo("MG"))!;
    const todos = Object.values(mg.cidades).flat();
    const comPf = todos.filter((r) => r.socios.some((s) => s.tipo === "PF")).length;
    console.log(`MG: ${todos.length} autoescolas, ${comPf} com sócio pessoa física (${Math.round((comPf / todos.length) * 100)}%)`);
    expect(comPf / todos.length).toBeGreaterThan(0.9);
  });

  it("devolve o CNPJ certo para nomes de fachada reais (sem falso positivo)", async () => {
    const mg = (await base.arquivo("MG"))!;
    const cidades = ["IPATINGA", "BELO HORIZONTE", "UBERLANDIA", "CONTAGEM", "JUIZ DE FORA"].filter((c) => mg.cidades[c]?.length);
    let total = 0, certos = 0, errados = 0, semResposta = 0, erradosAlta = 0;
    const exemplosErro: string[] = [];

    for (const c of cidades) {
      for (const r of mg.cidades[c].filter((x) => x.fantasia && x.situacao === "02").slice(0, 40)) {
        total++;
        const nomeMaps = `${r.fantasia} - ${r.bairro ?? "Centro"}`;
        const res = await resolverQsa(
          { nomeFantasia: nomeMaps, cidade: c, uf: "MG", bairro: r.bairro, telefone1: r.telefone },
          { base },
        );
        if (!res.encontrado) semResposta++;
        else if (mesmaEmpresa(res.empresa, r)) certos++;
        else {
          errados++;
          if (res.nivel === "alta") erradosAlta++;
          if (exemplosErro.length < 12) exemplosErro.push(`[${res.nivel} ${res.confianca}] ${nomeMaps} -> ${res.empresa?.nomeFantasia ?? res.empresa?.razaoSocial} (${res.empresa?.cnpj})`);
        }
      }
    }
    console.log(`Amostra ${total}: ${certos} certos, ${semResposta} sem resposta, ${errados} errados (${erradosAlta} com confiança ALTA)`, exemplosErro);
    expect(total).toBeGreaterThan(20);
    // O que importa: erro com selo de confiança alta. Erro com nota baixa/média é
    // filtrado ou sinalizado antes de virar dono do lead.
    expect(erradosAlta / total).toBeLessThan(0.02);
    expect(errados / total).toBeLessThan(0.08);
    expect(certos / total).toBeGreaterThan(0.85);
  });

  it("só aceita como 'alta' o que bate de verdade", async () => {
    const res = await resolverQsa({ nomeFantasia: "Autoescola Nome Que Nao Existe Qwerty", cidade: "Ipatinga", uf: "MG" }, { base });
    expect(res.nivel).not.toBe("alta");
  });
});
