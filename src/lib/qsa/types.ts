/**
 * Tipos do módulo de QSA (quadro societário).
 *
 * Sem I/O de propósito: tudo aqui é dado puro, para a verificação rodar igual
 * no servidor, num script ou nos testes.
 */

export type FonteQsa = "base_local" | "brasilapi" | "minhareceita" | "cnpja_open" | "informado";

export type SituacaoCadastral = "ativa" | "suspensa" | "inapta" | "baixada" | "nula" | "desconhecida";

export type Socio = {
  nome: string;
  /** Texto da qualificação na Receita, ex.: "Sócio-Administrador". */
  qualificacao: string | null;
  /** PF = pessoa física, PJ = pessoa jurídica, EX = estrangeiro. */
  tipo: "PF" | "PJ" | "EX" | null;
  /** Data de entrada na sociedade (AAAA-MM-DD). */
  desde: string | null;
};

export type Empresa = {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacao: SituacaoCadastral;
  capitalSocial: number | null;
  dataAbertura: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  socios: Socio[];
  fonte: FonteQsa;
};

/** O que sabemos do lead antes de procurar a empresa. */
export type EntradaLead = {
  nomeFantasia?: string | null;
  cidade?: string | null;
  uf?: string | null;
  bairro?: string | null;
  cnpj?: string | null;
  telefone1?: string | null;
  telefone2?: string | null;
};

export type Verificacao = {
  id: "cnpj_valido" | "empresa_ativa" | "nome_confere" | "cidade_confere" | "telefone_confere" | "tem_decisor";
  ok: boolean | null; // null = não deu para checar
  detalhe: string;
};

export type NivelConfianca = "alta" | "media" | "baixa";

export type Decisor = {
  nome: string;
  qualificacao: string | null;
  motivo: string;
};

export type ResultadoQsa = {
  encontrado: boolean;
  empresa: Empresa | null;
  decisor: Decisor | null;
  /** Demais sócios pessoa física, em ordem de relevância. */
  outrosSocios: Socio[];
  confianca: number; // 0..100
  nivel: NivelConfianca;
  verificacoes: Verificacao[];
  alertas: string[];
  /** Como o CNPJ foi achado. */
  estrategia: "cnpj_informado" | "base_local" | "busca_web" | "nao_encontrado";
  /** Fontes tentadas, em ordem, com o que aconteceu. Ajuda a depurar sem adivinhar. */
  tentativas: { fonte: string; resultado: "ok" | "vazio" | "erro" | "limite"; detalhe?: string }[];
};
