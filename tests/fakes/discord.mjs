// A local stand-in for the Discord HTTP API, for tests.
// Records every request; serves channel webhooks and webhook executes.

import { createServer } from "node:http";

export async function startFakeDiscord({ token = "bot-token", existing = [], forbid = false } = {}) {
  const requests = [];
  const webhooks = [...existing];
  let seq = 1000;

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://fake");
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    const send = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };

    const channelHooks = url.pathname.match(/^\/channels\/(\d+)\/webhooks$/);
    if (channelHooks) {
      if (req.headers.authorization !== `Bot ${token}`) return send(401, { message: "401: Unauthorized", code: 0 });
      if (forbid) return send(403, { message: "Missing Permissions", code: 50013 });
      if (req.method === "GET") return send(200, webhooks.filter((w) => w.channel_id === channelHooks[1]));
      const hook = { id: String(++seq), token: `tok${seq}`, name: JSON.parse(body).name, channel_id: channelHooks[1], type: 1 };
      webhooks.push(hook);
      return send(200, hook);
    }

    if (url.pathname.startsWith("/webhooks/") && req.method === "POST") {
      return send(200, { id: String(++seq), channel_id: url.searchParams.get("thread_id") ?? "chan" });
    }

    send(404, { message: "Unknown route" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    requests,
    webhooks,
    hookUrl: (hook) => `${base}/webhooks/${hook.id}/${hook.token}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
