import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/leads/$id/calls")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/calls.server"), { GET: "listarLigacoes", POST: "registrarLigacao" }),
  },
});
