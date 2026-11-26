import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/enrichment/jobs/")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/enrichment.server"), { GET: "listarJobs", POST: "criarJob" }),
  },
});
