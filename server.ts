import "dotenv/config";
import express from "express";
import { handleCommandRequest } from "./api/command.ts";

const app = express();
app.use(express.json({ limit: "512kb" }));

app.post("/api/command", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host") ?? "localhost:3001"}`;
  const request = new Request(`${baseUrl}${req.originalUrl}`, {
    method: req.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body ?? {}),
  });

  // Express has no ctx.waitUntil, so background work is collected and awaited
  // after the response is sent. That keeps the Langfuse round-trip off the
  // user-visible latency path while still guaranteeing delivery.
  const pending: Promise<unknown>[] = [];
  const response = await handleCommandRequest(request, process.env, {
    waitUntil: (p) => {
      pending.push(p.catch(() => {}));
    },
  });

  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.send(await response.text());

  await Promise.allSettled(pending);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
