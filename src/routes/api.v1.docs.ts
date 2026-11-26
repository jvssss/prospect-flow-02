import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/docs")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/system.server"), { GET: "documentacao" }),
  },
});
