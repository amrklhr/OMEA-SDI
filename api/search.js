// Vercel serverless function. Keeps Aiven credentials server-side —
// the browser never sees the OpenSearch host, username, or password.
// Only forwards to the fixed omea-articles index's _search endpoint
// (read-only), so even an arbitrary query body can't mutate data.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { AIVEN_HOST, AIVEN_PORT, AIVEN_USER, AIVEN_PASSWORD } = process.env;
  const url = `https://${AIVEN_HOST}:${AIVEN_PORT}/omea-articles/_search`;
  const auth = Buffer.from(`${AIVEN_USER}:${AIVEN_PASSWORD}`).toString("base64");

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Upstream OpenSearch request failed", detail: String(err) });
  }
}
