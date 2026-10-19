import "dotenv/config";
import express from "express";
import { handleApiRequest } from "./api/router.ts";
import { createFileTurnStore } from "./api/store-file.ts";
import { toFetchRequest } from "./api/node-adapter.ts";

const app = express();
app.use(express.json({ limit: "512kb" }));

const store = await createFileTurnStore(process.env.TURNS_FILE ?? ".data/turns.jsonl");

// Express 5 renamed the wildcard syntax; a bare "/api/*" throws at startup.
app.all("/api/*splat", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host") ?? "localhost:3001"}`;

  // Forwards every header (Langfuse switch, runs token). The
  // parity test uses the same adapter, so a dropped header fails a test.
  const request = toFetchRequest(
    `${baseUrl}${req.originalUrl}`,
    req.method,
    req.headers,
    req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {}),
  );

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
