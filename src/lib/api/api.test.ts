import { describe, expect, it } from "vitest";
import { consumir, zerarLimites } from "./rate-limit";
import { gerarChave, iguaisSeguro, sha256Hex } from "./auth.server";
import { ApiError } from "./errors";
import { likeSeguro, paraResposta } from "./http";
import { ordenarFila, prioridade } from "./handlers/queue.server";
import { normalizarUf, separarCidadeUf } from "@/lib/uf";
import { somar, sugerirAjuste } from "@/lib/metrics";
import { z } from "zod";

describe("rate limit", () => {
  it("bloqueia depois do limite e libera quando a janela passa", () => {
    zerarLimites();
    const t = 1_000_000;
    expect(consumir("a", 2, 60_000, t).ok).toBe(true);
    expect(consumir("a", 2, 60_000, t + 1).ok).toBe(true);
    const r = consumir("a", 2, 60_000, t + 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfter).toBeGreaterThan(0);
    expect(consumir("a", 2, 60_000, t + 61_000).ok).toBe(true);
    expect(consumir("b", 2, 60_000, t).ok).toBe(true); // chaves independentes
  });
});

describe("chaves de API", () => {
  it("gera chaves únicas com prefixo e hash estável", async () => {
    const a = gerarChave();
    const b = gerarChave();
    expect(a).toMatch(/^pf_live_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(await sha256Hex(a)).toBe(await sha256Hex(a));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("compara segredos sem aceitar prefixo parcial", () => {
    expect(iguaisSeguro("segredo", "segredo")).toBe(true);
    expect(iguaisSeguro("segredo", "segred")).toBe(false);
    expect(iguaisSeguro("segredo", "segredx")).toBe(false);
  });
});

describe("erros HTTP", () => {
  it("ApiError vira JSON com código e status", async () => {
    const r = paraResposta(new ApiError(404, "not_found", "Lead não encontrado."));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: "not_found", message: "Lead não encontrado." } });
  });
  it("ZodError vira 422 com o campo", async () => {
    const e = z.object({ x: z.string() }).safeParse({});
    const r = paraResposta(e.error);
    expect(r.status).toBe(422);
    expect((await r.json()).error.details[0].campo).toBe("x");
  });
  it("erro desconhecido vira 500 sem vazar detalhe", async () => {
    const r = paraResposta(new Error("senha=123"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("senha");
  });
});

describe("fila do Modo Foco", () => {
  const agora = new Date("2026-11-24T12:00:00Z").getTime();
  const leads = [
    { id: "d", last_call_at: "2026-11-20T10:00:00Z" },
    { id: "c", last_call_at: null },
    { id: "b", retorno_agendado_em: "2026-11-24T09:00:00Z", last_call_at: "2026-11-23T10:00:00Z" },
    { id: "a", followup_at: "2026-11-25T09:00:00Z", last_call_at: "2026-11-24T08:00:00Z" },
    { id: "e", retorno_agendado_em: "2026-11-30T09:00:00Z", last_call_at: "2026-11-01T10:00:00Z" }, // retorno no futuro
  ];
  it("follow-up, retorno vencido, nunca ligado; retorno futuro vai para o fim", () => {
    expect(ordenarFila(leads, agora).map((l) => l.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("retorno no futuro não é prioridade", () => {
    expect(prioridade(leads[4], agora)).toBe(3);
  });
});

describe("UF", () => {
  it("normaliza sigla, nome e rejeita lixo", () => {
    expect(normalizarUf("mg")).toBe("MG");
    expect(normalizarUf("São Paulo")).toBe("SP");
    expect(normalizarUf("Minas Gerais")).toBe("MG");
    expect(normalizarUf("XX")).toBeNull();
    expect(normalizarUf(null)).toBeNull();
  });
  it("separa 'Cidade, UF'", () => {
    expect(separarCidadeUf("Ipatinga, MG")).toEqual({ cidade: "Ipatinga", uf: "MG" });
    expect(separarCidadeUf("Ipatinga - mg")).toEqual({ cidade: "Ipatinga", uf: "MG" });
    expect(separarCidadeUf("Ipatinga")).toEqual({ cidade: "Ipatinga", uf: null });
  });
});

describe("sugestão de ajuste da meta", () => {
  const meta = {
    monthlyRevenueTarget: 30000, avgTicket: 1500, prospectingDaysPerWeek: 5, hoursPerDay: 2,
    rateCallToDecision: 0.3, rateDecisionToMeeting: 0.2, rateShowUp: 0.7, rateMeetingToClose: 0.25,
  };

  it("com pouca amostra mantém a meta e não recomenda mudança", () => {
    const s = sugerirAjuste(meta, somar([{ calls_made: 10, decisions_reached: 1 }]));
    expect(s.recomendar).toBe(false);
    expect(s.etapas.every((e) => e.confianca === "insuficiente")).toBe(true);
    expect(s.delta_ligacoes_dia).toBe(0);
  });

  it("conversão real menor que a estimada pede mais ligações por dia", () => {
    const s = sugerirAjuste(meta, somar([{ calls_made: 400, decisions_reached: 40 }])); // 10% contra 30% estimado
    expect(s.recomendar).toBe(true);
    expect(s.delta_ligacoes_dia).toBeGreaterThan(0);
    const e = s.etapas[0];
    expect(e.real).toBeCloseTo(0.1);
    expect(e.sugerido).toBeGreaterThan(0.1); // a média bayesiana não vai direto ao real
    expect(e.sugerido).toBeLessThan(0.3);
  });

  it("conversão real maior pede menos ligações", () => {
    const s = sugerirAjuste(meta, somar([{ calls_made: 200, decisions_reached: 100, meetings_scheduled: 20, meetings_held: 14, closes: 4 }]));
    expect(s.delta_ligacoes_dia).toBeLessThan(0);
  });
});

describe("likeSeguro", () => {
  it("remove o que quebra or() e escapa curingas do LIKE", () => {
    expect(likeSeguro("fama),cnpj.eq.1")).toBe("fama  cnpj.eq.1");
    expect(likeSeguro("100%_ok")).toBe("100\\%\\_ok");
  });
});
