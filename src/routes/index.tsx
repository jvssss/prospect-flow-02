import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Target, Gauge, Users, LayoutDashboard, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/cockpit", replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  if (checking) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-semibold">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground shadow-[var(--shadow-elegant)]">
            <Target className="h-4 w-4" />
          </div>
          <span className="font-display text-xl tracking-tight">meta<span className="text-primary">prospect</span></span>
        </div>
        <Button asChild variant="outline" className="rounded-2xl">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10 md:pt-20">
        <section className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center rounded-full border border-[color:var(--border-subtle)] bg-white/70 px-3 py-1 text-xs font-medium text-secondary-foreground shadow-[var(--shadow-glass)] backdrop-blur-xl">
            Matemática do Faturamento · Marcus Vinícius
          </span>
          <h1 className="mt-6 text-5xl tracking-tight text-foreground md:text-7xl">
            Bata sua meta com <span className="text-primary">clareza matemática</span>.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground md:text-xl">
            Um cockpit ultra-ágil para SDR/BDR: 60 a 65 ligações em 1h30, hotkeys,
            timer inteligente e Números de Ouro que traduzem sua meta mensal em ações
            do dia.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-2xl bg-primary shadow-[var(--shadow-elegant)]">
              <Link to="/auth">
                Começar agora <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            { icon: Target, title: "Números de Ouro", body: "Meta mensal + funil viram ligações/dia com um cálculo automático." },
            { icon: Gauge, title: "Modo Foco", body: "Um lead por vez, timer regressivo, hotkeys 1-5 e ritmo gamificado." },
            { icon: LayoutDashboard, title: "Diário de Bordo", body: "Conversão real vs. estimada e sugestão de recalibração." },
          ].map((f) => (
            <div key={f.title} className="rounded-3xl border border-[color:var(--border-subtle)] bg-white/70 p-6 shadow-[var(--shadow-glass)] backdrop-blur-xl">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-xl font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-24 flex items-center gap-3 text-sm text-muted-foreground">
          <Users className="h-4 w-4 text-primary" />
          Feito para times de SDR/BDR que precisam bater meta hoje, não semana que vem.
        </section>
      </main>
    </div>
  );
}
