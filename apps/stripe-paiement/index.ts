import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname === "/payments" && req.method === "POST") {
      const { amount, currency = "cad" } = await req.json();
      const intent = await stripe.paymentIntents.create({
        amount,                      // en cents : 1000 = 10,00 $
        currency,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      });
      return Response.json({ id: intent.id, clientSecret: intent.client_secret, status: intent.status });
    }

    if (url.pathname === "/webhooks/stripe" && req.method === "POST") {
      const body = await req.text();   // corps BRUT, obligatoire pour vérifier la signature
      try {
        const event = await stripe.webhooks.constructEventAsync(
          body, req.headers.get("stripe-signature")!, webhookSecret);
        console.log("event:", event.type, (event.data.object as any).id);
        return new Response("received");
      } catch (e) {
        return new Response(`signature invalide: ${e}`, { status: 400 });
      }
    }

    return new Response("not found", { status: 404 });
  },
});
