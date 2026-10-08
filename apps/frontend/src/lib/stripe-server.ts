/**
 * Fonctions serveur Stripe Terminal
 * Ces fonctions s'exécutent côté Worker (serveur), jamais dans le navigateur.
 * La clé secrète Stripe ne quitte jamais le serveur.
 *
 * Variables d'environnement requises :
 *   STRIPE_SECRET_KEY=sk_test_...   (dans .dev.vars en local, wrangler secret en production)
 */
import { createServerFn } from "@tanstack/react-start";
import Stripe from "stripe";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY manquante.\n" +
        "• Local : créez .dev.vars avec  STRIPE_SECRET_KEY=sk_test_...\n" +
        "• Production : wrangler secret put STRIPE_SECRET_KEY",
    );
  }
  return new Stripe(key);
}

/**
 * Génère un ConnectionToken pour le Stripe Terminal SDK côté client.
 * Ce token est éphémère (1 utilisation, expire en 15 min).
 */
export const fetchConnectionToken = createServerFn({ method: "POST" }).handler(
  async () => {
    const stripe = getStripe();
    const token = await stripe.terminal.connectionTokens.create();
    return { secret: token.secret };
  },
);

/**
 * Crée un PaymentIntent pour le montant donné (en cents CAD).
 * Supporte Interac Débit + toutes les cartes.
 * Note : pas de .validator() pour rester compatible avec toutes les versions
 * de @tanstack/start-client-core (méthode renommée entre 1.167 et 1.170).
 */
export const createPaymentIntent = createServerFn({ method: "POST" }).handler(
  async (ctx) => {
    const { amountCents } = (ctx as { data: { amountCents: number } }).data;
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      // Interac + toutes les cartes physiques (NFC, puce, bande)
      payment_method_types: ["card_present", "interac_present"],
      capture_method: "automatic",
    });
    return {
      clientSecret: intent.client_secret!,
      id: intent.id,
    };
  },
);
