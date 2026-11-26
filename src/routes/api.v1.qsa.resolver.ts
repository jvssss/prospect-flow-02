import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/qsa/resolver")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/qsa.server"), { POST: "resolverPorNome" }),
  },
});
