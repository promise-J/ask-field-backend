import { Request } from "express";
import { serviceResponse } from "../../../utils/apiResponse";
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export class PaymentService {
  async acceptPayment(req: Request) {
    // try {
    //     const session = await stripe.checkout.sessions.create({
    //         payment_method_types: ["card"],
    //         line_items: [
    //           {
    //             price_data: {
    //               currency: "usd",
    //               product_data: {
    //                 name: "Test Product",
    //               },
    //               unit_amount: 5000,
    //             },
    //             quantity: 1,
    //           },
    //         ],
    //         mode: "payment",
    //         success_url: "http://localhost:3000/success",
    //         cancel_url: "http://localhost:3000/cancel",
    //       });

    //       return serviceResponse(true, "Payment session created successfully", { url: session.url });

    //   } catch (err) {
    //     return serviceResponse(false, "Payment failed", err);
    //   }

    // const { amountInEuro, recipientAccount, recipientBank, recipientName } =
    //   req.body;
    const amountInEuro = req.body.amount || 1000

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card", "sepa_debit"], // European local favorites
        mode: "payment",
        currency: "eur",
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
          amount: amountInEuro
        },
        success_url: "http://localhost:3000/success.html",
        cancel_url: "http://localhost:3000/cancel.html",
      });

      // Send the checkout URL back to your frontend
      return serviceResponse(true, 'Payment intent successful', {url: session.url})
    } catch (error: any) {
      return serviceResponse(false, 'Failed payment intent', error.message)
    }
  }
}
