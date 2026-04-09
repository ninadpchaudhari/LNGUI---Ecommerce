import { handleCommandRequest, type CommandRuntimeEnv } from "./command.ts";

export interface Env extends CommandRuntimeEnv {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/command") {
      return handleCommandRequest(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
