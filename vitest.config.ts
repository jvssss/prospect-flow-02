import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config própria (e não a do Vite do app): os testes cobrem lógica pura e não
// precisam dos plugins do TanStack Start.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
