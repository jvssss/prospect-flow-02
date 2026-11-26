import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/leads/$id")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/leads.server"), { GET: "obter", PATCH: "atualizar", DELETE: "remover" }),
  },
});
