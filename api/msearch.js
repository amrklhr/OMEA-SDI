// Vercel serverless function for batched _msearch requests (used by the
// keyword-context and section-context lookups). Reads the raw NDJSON body
// manually since it isn't standard JSON, then forwards it with credentials
// attached server-side only.

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { AIVEN_HOST, AIVEN_PORT, AIVEN_USER, AIVEN_PASSWORD } = process.env;
  const url = `https://${AIVEN_HOST}:${AIVEN_PORT}/_msearch`;
  const auth = Buffer.from(`${AIVEN_USER}:${AIVEN_PASSWORD}`).toString("base64");

  try {
    const rawBody = await readRawBody(req);
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-ndjson",
        Authorization: `Basic ${auth}`,
      },
      body: rawBody,
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Upstream OpenSearch msearch request failed", detail: String(err) });
  }
}
