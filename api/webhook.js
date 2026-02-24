import Stripe from "stripe";

export const config = { api: { bodyParser: false } };
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TOKENS_BY_AMOUNT = { "10": 7, "20": 15, "50": 42 };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

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

async function sendToHA(payload) {
  const body = process.env.HA_WEBHOOK_KEY
    ? { ...payload, key: process.env.HA_WEBHOOK_KEY }
    : payload;

  const r = await fetch(process.env.HA_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.ok;
}

export default async function handler(req, res) {
  try {
    const buf = await readRawBody(req);
    const sig = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.payment_status === "paid") {
        // 1) Marque "paid" en base
        await redisSet(`paid:${session.id}`, {
          amount_total: session.amount_total,
          metadata: session.metadata,
          created: session.created
        });

        // 2) Empêche double délivrance
        const alreadyUsed = await redisGet(`used:${session.id}`);
        if (!alreadyUsed) {
          const amount = session?.metadata?.amount;
          const tokens = TOKENS_BY_AMOUNT[String(amount)];

          if (tokens) {
            const ok = await sendToHA({ session_id: session.id, tokens });

            if (ok) {
              // 3) Marque "used" (AUTO a délivré)
              await redisSet(`used:${session.id}`, { used_at: Date.now(), tokens, mode: "auto" });
            }
          }
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}
