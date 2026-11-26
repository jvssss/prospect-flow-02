const UF_POR_NOME: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

export const UFS = new Set(Object.values(UF_POR_NOME));

/** "São Paulo", "sp" e "SP" viram "SP". Devolve null quando não reconhece. */
export function normalizarUf(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (s.length === 2) {
    const u = s.toUpperCase();
    return UFS.has(u) ? u : null;
  }
  const chave = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return UF_POR_NOME[chave] ?? null;
}

/** Separa "Ipatinga, MG" / "Ipatinga - MG" em cidade e UF. */
export function separarCidadeUf(texto: string): { cidade: string; uf: string | null } {
  const m = texto.trim().match(/^(.*?)[\s]*[,\-/][\s]*([A-Za-z]{2})$/);
  if (m) {
    const uf = normalizarUf(m[2]);
    if (uf) return { cidade: m[1].trim(), uf };
  }
  return { cidade: texto.trim(), uf: null };
}
