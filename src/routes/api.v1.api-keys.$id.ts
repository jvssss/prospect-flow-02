import { createFileRoute } from "@tanstack/react-router";
import { apiHandlers } from "@/lib/api/route";

export const Route = createFileRoute("/api/v1/api-keys/$id")({
  server: {
    handlers: apiHandlers(() => import("@/lib/api/handlers/keys.server"), { DELETE: "revogarChave" }),
  },
});
