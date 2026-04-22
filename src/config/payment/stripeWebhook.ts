const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const stripeWebhookHandler = (stripe: any) => (
  req: any,
  res: any
) =>{
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
    } catch (err: unknown) {
      console.log("Webhook signature verification failed.", err);
      return res.sendStatus(400);
    }

    // Handle events
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log("Payment successful:", paymentIntent.id);
        break;

      case "payment_intent.payment_failed":
        console.log("Payment failed");
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.sendStatus(200);
  }