const TOKENS_BY_AMOUNT = { "10": 7, "20": 15, "50": 42 };

async function redisGet(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  });
  const j = await r.json();
  return j.result; // string or null
}

async function redisSet(key, value) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });
}

export default async function handler(req, res) {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "missing_session_id" });

    const paid = await redisGet(`paid:${session_id}`);
    if (!paid) return res.status(403).json({ error: "not_paid" });

    const used = await redisGet(`used:${session_id}`);
    if (used) return res.status(409).json({ error: "already_used" });

    const paidObj = JSON.parse(paid);
    const amount = paidObj?.metadata?.amount;
    const tokens = TOKENS_BY_AMOUNT[String(amount)];
    if (!tokens) return res.status(400).json({ error: "unknown_pack" });

    // Appel Home Assistant (webhook)
    const ha = await fetch(process.env.HA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, tokens })
    });

    if (!ha.ok) return res.status(502).json({ error: "ha_failed" });

    await redisSet(`used:${session_id}`, { used_at: Date.now(), tokens });

    res.json({ ok: true, tokens });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
