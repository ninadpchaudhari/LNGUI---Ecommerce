import "dotenv/config";
import express from "express";
import { handleApiRequest } from "./api/router.ts";
import { createFileTurnStore } from "./api/store-file.ts";

const app = express();
app.use(express.json({ limit: "512kb" }));

const store = await createFileTurnStore(process.env.TURNS_FILE ?? ".data/turns.jsonl");

// Express 5 renamed the wildcard syntax; a bare "/api/*" throws at startup.
app.all("/api/*splat", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host") ?? "localhost:3001"}`;

  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = req.headers["x-runs-token"];
  if (typeof token === "string") headers["x-runs-token"] = token;

  const request = new Request(`${baseUrl}${req.originalUrl}`, {
    method: req.method,
    headers,
    // A Fetch Request throws if a GET or HEAD carries a body.
    ...(req.method === "GET" || req.method === "HEAD"
      ? {}
      : { body: JSON.stringify(req.body ?? {}) }),
  });

  // Express has no ctx.waitUntil, so background work is collected and awaited
  // after the response is sent. That keeps the Langfuse round-trip off the
  // user-visible latency path while still guaranteeing delivery.
  const pending: Promise<unknown>[] = [];
  const response = await handleApiRequest(request, process.env, {
    store,
    waitUntil: (p) => {
      pending.push(p.catch(() => {}));
    },
  });

  if (!response) {
    res.status(404).json({ error: "Not Found" });
    return;
  }

  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.send(await response.text());

  await Promise.allSettled(pending);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT} (persistence: ${store.kind})`);
});
