import { Request } from "express";
import { serviceResponse } from "../../../utils/apiResponse";
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export class PaymentService {
  async acceptPayment(req: Request) {
    const amountInEuro = req.body.amount || 1000
    const userEmail = req.body.email || 'chiemelapromise30@gmail.com'

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card", "sepa_debit"], // European local favorites
        mode: "payment",
        currency: "eur",
        customer_email: userEmail,
        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: `Payment for Study (JoinStudy)`,
              },
              unit_amount: amountInEuro * 100, // Stripe expects amounts in cents (€10 = 1000)
            },
            quantity: 1,
          },
        ],
        // CRITICAL: Save beneficiary details here. They return to you in the webhook.
        metadata: {
          amount: amountInEuro,
          userId: req.user ? req.user.id : "",
        },
        success_url: "https://www.joinstudy.io",
        cancel_url: "https://www.joinstudy.io/cancel",
      });

      // Send the checkout URL back to your frontend
      console.log(session.url)
      return serviceResponse(true, 'Payment intent successful', {url: session.url})
    } catch (error: any) {
      return serviceResponse(false, 'Failed payment intent', error.message)
    }
  }
}
