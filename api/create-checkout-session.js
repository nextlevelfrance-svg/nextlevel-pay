import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_BY_AMOUNT = {
  "10": process.env.PRICE_10,
  "20": process.env.PRICE_20,
  "50": process.env.PRICE_50
};

export default async function handler(req, res) {
  try {
    const { amount } = req.query;
    const price = PRICE_BY_AMOUNT[String(amount)];
    if (!price) return res.status(400).send("Invalid amount");

    const origin = `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}`,
      metadata: { amount: String(amount) }
    });

    res.writeHead(302, { Location: session.url });
    res.end();
  } catch (e) {
    res.status(500).send(e.message);
  }
}
