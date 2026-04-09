import "dotenv/config";
import express from "express";
import { handleCommandRequest } from "./api/command.ts";

const app = express();
app.use(express.json());

app.post("/api/command", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host") ?? "localhost:3001"}`;
  const request = new Request(`${baseUrl}${req.originalUrl}`, {
    method: req.method,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(req.body ?? {}),
  });

  const response = await handleCommandRequest(request);
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.send(await response.text());
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
