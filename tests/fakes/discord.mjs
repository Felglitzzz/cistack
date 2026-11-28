// A local stand-in for the Discord HTTP API, for tests.
// Records every request; serves channel webhooks, webhook info and webhook executes,
// with or without files. A file over `uploadLimit` bytes is refused as Discord does.

import { createServer } from "node:http";

// A message's JSON body, or a multipart one's payload and files.
async function parse(body, type = "") {
  if (!body.length) return { body: null };
  if (!type.startsWith("multipart/")) return { body: JSON.parse(body) };
  const form = await new Response(body, { headers: { "content-type": type } }).formData();
  const files = await Promise.all(
    [...form].filter(([name]) => name.startsWith("files[")).map(async ([, file]) => ({ name: file.name, type: file.type, content: Buffer.from(await file.arrayBuffer()) })),
  );
  return { body: JSON.parse(form.get("payload_json") ?? "{}"), files };
}

export async function startFakeDiscord({ token = "bot-token", existing = [], forbid = false, uploadLimit = Infinity } = {}) {
  const requests = [];
  const webhooks = [...existing];
  let seq = 1000;

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { body, files } = await parse(Buffer.concat(chunks), req.headers["content-type"]);
    const url = new URL(req.url, "http://fake");
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body, files });
    const send = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };

    const channelHooks = url.pathname.match(/^\/channels\/(\d+)\/webhooks$/);
    if (channelHooks) {
      if (req.headers.authorization !== `Bot ${token}`) return send(401, { message: "401: Unauthorized", code: 0 });
      if (forbid) return send(403, { message: "Missing Permissions", code: 50013 });
      if (req.method === "GET") return send(200, webhooks.filter((w) => w.channel_id === channelHooks[1]));
      const hook = { id: String(++seq), token: `tok${seq}`, name: body.name, channel_id: channelHooks[1], type: 1 };
      webhooks.push(hook);
      return send(200, hook);
    }

    if (url.pathname.startsWith("/webhooks/") && req.method === "GET") {
      return send(200, { id: url.pathname.split("/")[2], guild_id: "5550001", channel_id: "chan" });
    }

    if (url.pathname.startsWith("/webhooks/") && req.method === "POST") {
      if (files?.some((file) => file.content.length > uploadLimit)) return send(413, { message: "Request entity too large", code: 40005 });
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
