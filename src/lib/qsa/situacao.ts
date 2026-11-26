import type { SituacaoCadastral } from "./types";

/** Código de situação cadastral da Receita (arquivo de Estabelecimentos). */
export function situacaoDoCodigoReceita(codigo: string | number | null | undefined): SituacaoCadastral {
  switch (String(codigo ?? "").padStart(2, "0")) {
    case "01":
      return "nula";
    case "02":
      return "ativa";
    case "03":
      return "suspensa";
    case "04":
      return "inapta";
    case "08":
      return "baixada";
    default:
      return "desconhecida";
  }
}
