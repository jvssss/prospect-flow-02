import { Link, useRouterState } from "@tanstack/react-router";
import { Target, LogOut, Gauge, KanbanSquare, Users, BarChart3, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const TABS = [
  { to: "/cockpit", label: "Modo Foco", icon: Gauge },
  { to: "/crm", label: "CRM", icon: KanbanSquare },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/goals", label: "Números", icon: BarChart3 },
  { to: "/diario", label: "Diário", icon: BookOpen },
] as const;

export function TopNav({ user }: { user: { email?: string | null; user_metadata?: any } | null }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const qc = useQueryClient();

  async function handleLogout() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    window.location.href = "/auth";
  }

  const name = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Usuário";
  const initial = String(name).trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 pt-4">
      <div className="mx-auto grid h-16 max-w-[1500px] grid-cols-[auto_1fr_auto] items-center gap-4 px-6">
        <Link to="/cockpit" className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground shadow-[var(--shadow-elegant)]">
            <Target className="h-4 w-4" />
          </div>
          <span className="font-display text-xl tracking-tight">
            meta<span className="text-primary">prospect</span>
          </span>
        </Link>

        <nav className="mx-auto flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-white/70 p-1 shadow-[var(--shadow-glass)] backdrop-blur-xl">
          {TABS.map((t) => {
            const active = pathname === t.to || pathname.startsWith(t.to + "/");
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                preload="intent"
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active ? "bg-foreground text-background shadow-[var(--shadow-soft)]" : "text-muted-foreground hover:bg-white/60 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{t.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/70 p-1 pl-3 shadow-[var(--shadow-glass)] backdrop-blur-xl">
          <div className="hidden min-w-0 leading-tight sm:block">
            <div className="max-w-[140px] truncate text-xs font-semibold">{name}</div>
            <div className="max-w-[140px] truncate text-[10px] text-muted-foreground">{user?.email}</div>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-sm font-bold text-primary-foreground shadow-[var(--shadow-elegant)]">{initial}</div>
          <button
            onClick={handleLogout}
            title="Sair"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-white/60 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}