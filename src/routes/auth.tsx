import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

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

          <div className="mt-6" />

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