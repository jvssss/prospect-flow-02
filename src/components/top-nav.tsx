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
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto grid h-16 max-w-[1500px] grid-cols-[auto_1fr_auto] items-center gap-4 px-6">
        <Link to="/cockpit" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-elegant)]">
            <Target className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold tracking-tight">
            flow<span className="text-primary">crm</span>
          </span>
        </Link>

        <nav className="mx-auto flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
          {TABS.map((t) => {
            const active = pathname === t.to || pathname.startsWith(t.to + "/");
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                  active ? "bg-primary text-primary-foreground shadow-[var(--shadow-soft)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{t.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{initial}</div>
            <div className="min-w-0 leading-tight">
              <div className="max-w-[160px] truncate text-sm font-semibold">{name}</div>
              <div className="max-w-[160px] truncate text-xs text-muted-foreground">{user?.email}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
}