import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/system.server"), { GET: "saude" }),
  },
});
