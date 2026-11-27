// Cloudflare R2 through its S3 API, signed with AWS signature version 4. An error's
// message never carries a credential or the endpoint, so it can be posted.

import { createHash, createHmac } from "node:crypto";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

// `fetch`, failing without saying where it was going or what it sent.
export async function request(service, url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(`couldn't reach ${service} (${error.cause?.code ?? error.name})`);
  }
}

// One request to the bucket: to the object at `key`, or with `query` to the bucket's
// own settings. Resolves to {status, ok, text, code}, `code` being R2's error code.
export async function r2(config, method, { key = "", query = "", body = "", headers = {} } = {}) {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = config;
  const url = new URL(`${endpoint.replace(/\/+$/, "")}/${bucket}${key && `/${key}`}`);
  url.search = query;
  const date = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const payload = sha256(body);
  const signed = { ...headers, host: url.host, "x-amz-content-sha256": payload, "x-amz-date": date };
  const names = Object.keys(signed).sort();
  const canonical = [
    method,
    url.pathname,
    [...url.searchParams].map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).sort().join("&"),
    names.map((name) => `${name}:${signed[name]}\n`).join(""),
    names.join(";"),
    payload,
  ].join("\n");
  const signingKey = scope.split("/").reduce(hmac, `AWS4${secretAccessKey}`);
  const signature = hmac(signingKey, ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join("\n")).toString("hex");
  const { host, ...sent } = signed; // fetch sets it itself
  const response = await request("R2", url, {
    method,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    body: method === "GET" ? undefined : body,
  });
  const text = await response.text();
  return { status: response.status, ok: response.ok, text, code: text.match(/<Code>(\w+)<\/Code>/)?.[1] };
}

export const failure = ({ status, code }) => new Error(`R2 refused it: HTTP ${status}${code ? ` (${code})` : ""}`);
