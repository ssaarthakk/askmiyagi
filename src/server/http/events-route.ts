import type { ServerResponse } from "node:http";
import type { WatchEvent } from "../../shared/events.ts";

export function createEventsHandler() {
  const clients = new Set<ServerResponse>();

  return {
    handle(response: ServerResponse) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.flushHeaders();
      clients.add(response);
      response.on("close", () => clients.delete(response));
    },

    publish(event: WatchEvent) {
      for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  };
}
