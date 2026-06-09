import type { FastifyInstance } from "fastify";
import { CARD_CATALOG, chooseCard, type ChargeCategory } from "../wallet/cards.ts";

export async function walletRoutes(app: FastifyInstance) {
  // GET /wallet/catalog — the curated card types (for the demo's card-type picker).
  app.get("/wallet/catalog", async () => ({
    cards: Object.values(CARD_CATALOG).map((c) => ({ key: c.key, name: c.name, network: c.network, perks: c.perks ?? [] })),
  }));

  // GET /wallet/recommend?category=airfare&amount=5000&accountId=demo
  // Previews which connected card the engine would charge for a given spend.
  app.get<{ Querystring: { category?: string; amount?: string; accountId?: string } }>(
    "/wallet/recommend",
    async (req, reply) => {
      const category = (req.query.category ?? "airfare") as ChargeCategory;
      const amountUsd = Number(req.query.amount ?? 0);
      if (!amountUsd || amountUsd <= 0) return reply.status(400).send({ error: "amount required" });
      const choice = chooseCard(req.query.accountId ?? "demo", { category, amountUsd });
      if (!choice) return reply.status(404).send({ error: "no_cards", message: "no payment cards connected" });
      return choice;
    },
  );
}
