import { Request, Response, RequestHandler } from "express";
import { Stripe } from "stripe";

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Higher-order function that injects the Stripe instance into the Express Request Handler.
 */
export const stripeWebhookHandler = (stripe: Stripe): RequestHandler => {
  return async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"];

    if (!sig || !endpointSecret) {
      console.error("❌ Missing stripe-signature or STRIPE_WEBHOOK_SECRET configuration.");
      res.sendStatus(400);
      return;
    }
    console.log({body: req.body})

    let event: any;

    try {
      // req.body MUST be the raw binary buffer (e.g., using express.raw())
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
      console.log({event}, 'inside event')
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`❌ Webhook Signature Verification Failed:`, errorMessage);
      res.sendStatus(400);
      return;
    }
    console.log({event},'outside event')

    // Handle events with strict TypeScript discrimination
    switch (event.type) {
      case "payment_intent.succeeded": {
        // TypeScript automatically refines event.data.object to Stripe.PaymentIntent
        const paymentIntent = event.data.object;
        console.log("Payment successful:", paymentIntent.id);
        break;
      }

      case "checkout.session.completed": {
        // TypeScript automatically refines event.data.object to Stripe.Checkout.Session
        const session = event.data.object;
        console.log("Checkout successful:", session.id);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntentFailed = event.data.object;
        console.log("Payment failed:", paymentIntentFailed.id);
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.sendStatus(200);
  };
};
