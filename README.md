# Chat-Assisted Ecommerce

A Vite + React demo where a natural language prompt is converted into structured product filters.

## What Changed

The API is now runtime-agnostic and uses the standard Fetch API instead of Vercel-specific request/response types.

- Core handler: `api/command.ts` exports `handleCommandRequest(request, env?)`
- Local dev adapter: `server.ts` maps Express requests to `Request`
- Cloudflare entrypoint: `api/worker.ts`

## LLM Routing (OpenRouter Default)

This project uses the OpenAI SDK with a configurable base URL.

Default behavior (when `LITELLM_BASE_URL` is not set):

- `OPENAI_BASE_URL` defaults to `https://openrouter.ai/api/v1`
- `OPENAI_MODEL` defaults to `openai/gpt-4o-mini`

Required for default OpenRouter usage:

- `OPENAI_API_KEY`

Optional overrides in direct mode:

- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

Optional for LiteLLM usage:

- `LITELLM_BASE_URL` (example: `https://litellm.example.com/v1`)
- `LITELLM_MODEL` (example: `openai/gpt-4o-mini`)
- `LITELLM_API_KEY` (if your LiteLLM proxy requires auth)
- `LITELLM_API_KEY_HEADER` (custom auth header name when not using `Authorization`)

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

### LiteLLM: Cloud vs Local Container

You can use either mode:

1. Cloud LiteLLM:
- Set `LITELLM_BASE_URL` to your hosted LiteLLM endpoint (for example `https://<your-host>/v1`).
- Run normal compose:

```bash
docker compose up --build
```

2. Local LiteLLM in Docker:
- Add `OPENAI_API_KEY` in `.env` for the LiteLLM container.
- Set app routing in `.env`:
	- `LITELLM_BASE_URL=http://litellm:4000/v1`
	- `LITELLM_MODEL=openai/gpt-4o-mini`
- Start compose with LiteLLM profile:

```bash
docker compose --profile litellm up --build
```

LiteLLM local config is in `litellm.config.yaml` and exposes port `4000` on your machine.

## Local Test Mode (No External LLM)

If you want to test the full app flow locally without calling LiteLLM/OpenAI, set:

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
