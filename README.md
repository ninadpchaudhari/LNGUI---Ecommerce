# Chat-Assisted Ecommerce

A Vite + React demo where a natural language prompt is converted into structured product filters.

## What Changed

The API is now runtime-agnostic and uses the standard Fetch API instead of Vercel-specific request/response types.

- Core handler: `api/command.ts` exports `handleCommandRequest(request, env?)`
- Local dev adapter: `server.ts` maps Express requests to `Request`
- Cloudflare entrypoint: `api/worker.ts`

## LLM Routing (OpenRouter Default)

This project uses the OpenAI SDK with a configurable base URL. Provider selection is
**key-first**: whichever key is present decides the provider.

| Provider | Selected when | Base URL | Model default |
| --- | --- | --- | --- |
| `openrouter` | `OPEN_ROUTER_API_KEY` or `OPENROUTER_API_KEY` is set | `OPENROUTER_BASE_URL` → `OPENAI_BASE_URL` → `https://openrouter.ai/api/v1` | `OPENROUTER_MODEL` → `OPENAI_MODEL` → `openai/gpt-4o-mini` |
| `openai` | only `OPENAI_API_KEY` is set | `OPENAI_BASE_URL`, else the SDK default | `OPENAI_MODEL` → `gpt-4o-mini` |
| none | neither is set | — | request fails with HTTP 500 |

Optional OpenRouter attribution, shown in the OpenRouter dashboard:

- `OPENROUTER_SITE_URL` (sent as `HTTP-Referer`)
- `OPENROUTER_APP_TITLE` (sent as `X-Title`)

## Observability (Langfuse)

Langfuse tracing is enabled when both keys are present:

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

Optional:

- `LANGFUSE_BASE_URL`

The command API records:

- input prompt and available filters/sorts
- model and routing metadata
- initial LLM generation and repair attempt
- final status and output/error

## Run Locally

```bash
npm install
npm run dev
```

Client runs on Vite and API is proxied to `http://localhost:3001/api/command`.

## Run Locally With Docker Compose

You can run both frontend and API in one containerized dev workflow.

1. Add required env vars to `.env` (same env vars used by local Node run).
2. Start services:

```bash
docker compose up --build
```

3. Open the app at `http://localhost:5173`.

The API is available at `http://localhost:3001/api/command` and Vite still proxies `/api` requests automatically.

To stop:

```bash
docker compose down
```

## Local Test Mode (No External LLM)

If you want to test the full app flow locally without calling OpenRouter/OpenAI, set:

- `LOCAL_TEST_MODE=true`

When enabled, the API uses a deterministic prompt parser and returns a valid command payload without any network LLM call.

Example `.env` for local-only testing:

```bash
LOCAL_TEST_MODE=true
```

This is useful for UI and filter workflow testing while keeping production behavior unchanged.

## Cloudflare Workers

Use `api/worker.ts` as your Worker entrypoint.

Example pattern:

```ts
import worker from "./api/worker";
export default worker;
```

Route `POST /api/command` to this worker and provide the env vars above in your worker configuration.
