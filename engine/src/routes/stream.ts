// Server-Sent Events: the real backing for the demo's live execution stream. The front-end
// (v5/05-execution.html, Chunk 6) will EventSource() this instead of dripping a hardcoded
// QUEUE. Replays recent history on connect so a late-joining browser catches up.
import type { FastifyInstance } from "fastify";
import { bus } from "../events/bus.ts";

export async function streamRoutes(app: FastifyInstance) {
  app.get<{ Params: { tripId: string } }>("/stream/:tripId", async (req, reply) => {
    const { tripId } = req.params;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

    // Catch the browser up on anything already emitted for this trip.
    for (const e of bus.replay(tripId)) send(e);

    const unsubscribe = bus.subscribe(tripId, send);
    const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), 15000);

    req.raw.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });
}
