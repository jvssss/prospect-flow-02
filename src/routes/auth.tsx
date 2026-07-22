import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar · Meta Prospect" },
      { name: "description", content: "Acesse sua conta Meta Prospect e comece a bater meta com Números de Ouro." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/cockpit", replace: true });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo!");
    navigate({ to: "/cockpit", replace: true });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/cockpit`,
        data: { full_name: name },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada. Você já está dentro.");
    navigate({ to: "/cockpit", replace: true });
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) return toast.error("Falha no login com Google");
    if (result.redirected) return;
    navigate({ to: "/cockpit", replace: true });
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-5xl place-items-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[color:var(--border-subtle)] bg-white/75 p-8 shadow-[var(--shadow-glass)] backdrop-blur-xl">
          <Link to="/" className="mb-6 flex items-center gap-2 text-sm font-semibold">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground">
              <Target className="h-4 w-4" />
            </div>
            <span className="font-display text-base">meta<span className="text-primary">prospect</span></span>
          </Link>
          <h1 className="text-3xl tracking-tight">Acesse sua conta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cockpit de prospecção com Números de Ouro.
          </p>

          <Button
            type="button"
            variant="outline"
            className="mt-6 w-full rounded-2xl"
            onClick={handleGoogle}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continuar com Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> ou email <div className="h-px flex-1 bg-border" />
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2 rounded-2xl">
              <TabsTrigger value="signin" className="rounded-xl">Entrar</TabsTrigger>
              <TabsTrigger value="signup" className="rounded-xl">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div>
                  <Label htmlFor="in-email">Email</Label>
                  <Input id="in-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-xl" />
                </div>
                <div>
                  <Label htmlFor="in-pass">Senha</Label>
                  <Input id="in-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-xl" />
                </div>
                <Button disabled={loading} type="submit" className="w-full rounded-2xl">Entrar</Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div>
                  <Label htmlFor="up-name">Nome</Label>
                  <Input id="up-name" required value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
                </div>
                <div>
                  <Label htmlFor="up-email">Email</Label>
                  <Input id="up-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-xl" />
                </div>
                <div>
                  <Label htmlFor="up-pass">Senha</Label>
                  <Input id="up-pass" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-xl" />
                </div>
                <Button disabled={loading} type="submit" className="w-full rounded-2xl">Criar conta</Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}