# Agentes

- Deploy: Vercel, a partir do branch `main` do GitHub. O build usa Nitro com o preset `vercel` (`vite.config.ts`).
- Banco: Supabase, projeto `vmnaatcwginshkpedwoc` (compartilhado com o app emporio-painel; as tabelas deste app ficam no schema `public`).
- Toda mudança de schema vai em `supabase/migrations/`. Não crie tabela ou coluna direto no banco.
- O projeto não usa mais o Lovable.
