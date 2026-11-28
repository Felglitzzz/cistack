// A local stand-in for Cloudflare R2's S3 API, for tests: path-style PutObject and the
// bucket's lifecycle configuration. It checks each request's AWS signature (version 4)
// as the server would, from what arrived, and records what was stored.

import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

const error = (code) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;

function signatureProblem(req, url, body, { accessKeyId, secretAccessKey }) {
  const auth = req.headers.authorization?.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/);
  if (!auth) return "AccessDenied";
  const [, id, day, signed, signature] = auth;
  if (id !== accessKeyId) return "InvalidAccessKeyId";
  const names = signed.split(";");
  const date = req.headers["x-amz-date"] ?? "";
  const payload = req.headers["x-amz-content-sha256"];
  if (!["host", "x-amz-date", "x-amz-content-sha256"].every((n) => names.includes(n)) || !date.startsWith(day)) return "SignatureDoesNotMatch";
  if (payload !== "UNSIGNED-PAYLOAD" && payload !== sha256(body)) return "XAmzContentSHA256Mismatch";
  const query = [...url.searchParams].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort().join("&");
  const headers = names.map((name) => `${name}:${String(req.headers[name]).trim()}\n`).join("");
  const canonical = [req.method, url.pathname, query, headers, signed, payload].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", date, `${day}/auto/s3/aws4_request`, sha256(canonical)].join("\n");
  const key = [day, "auto", "s3", "aws4_request"].reduce(hmac, `AWS4${secretAccessKey}`);
  return hmac(key, toSign).toString("hex") === signature ? null : "SignatureDoesNotMatch";
}

// `deny` names what the token may not do: "objects" or "lifecycle".
export async function startFakeR2({ bucket = "videos", accessKeyId = "AKID123", secretAccessKey = "s3cr3t-key-value", lifecycle = null, deny = [] } = {}) {
  const requests = [];
  const objects = new Map();
  const state = { lifecycle };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ method: req.method, path: url.pathname, query: url.search });
    const send = (status, text = "") => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(text);
    };

    const problem = signatureProblem(req, url, body, { accessKeyId, secretAccessKey });
    if (problem) return send(403, error(problem));
    const [, name, ...rest] = url.pathname.split("/");
    if (name !== bucket) return send(404, error("NoSuchBucket"));
    const key = rest.join("/");

    if (url.searchParams.has("lifecycle") && !key) {
      if (deny.includes("lifecycle")) return send(403, error("AccessDenied"));
      if (req.method === "GET") return state.lifecycle ? send(200, state.lifecycle) : send(404, error("NoSuchLifecycleConfiguration"));
      if (req.method === "PUT") {
        if (req.headers["content-md5"] !== createHash("md5").update(body).digest("base64")) return send(400, error("InvalidDigest"));
        state.lifecycle = body.toString("utf8");
        return send(200);
      }
    }
    if (req.method === "PUT" && key) {
      if (deny.includes("objects")) return send(403, error("AccessDenied"));
      objects.set(key, { body, contentType: req.headers["content-type"] });
      return send(200);
    }
    send(404, error("NoSuchKey"));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    // What the owner would keep in .cistack/r2.json to reach it.
    config: {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      bucket,
      accessKeyId,
      secretAccessKey,
      publicUrl: "https://pub-fake.r2.example",
    },
    requests,
    objects,
    get lifecycle() {
      return state.lifecycle;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
