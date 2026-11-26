import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/queue/cities")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/queue.server"), { GET: "cidades" }),
  },
});
