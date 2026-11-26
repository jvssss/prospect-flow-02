import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/metrics/today")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/goals-metrics.server"), { GET: "metricasHoje" }),
  },
});
