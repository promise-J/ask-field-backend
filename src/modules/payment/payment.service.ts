import { Request } from "express";
import { serviceResponse } from "../../utils/apiResponse";
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export class PaymentService{
    async acceptPaymentIntent(req: Request){
        try {
            // const { amount, currency } = req.body;
        
            // const paymentIntent = await stripe.paymentIntents.create({
            //   amount: amount, // in kobo/cent (e.g. 5000 = ₦50 or $50 depending on currency)
            //   currency: currency || "usd",
            //   automatic_payment_methods: { enabled: true },
            // });
        
            // res.send({
            //   clientSecret: paymentIntent.client_secret,
            // });
        
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                line_items: [
                  {
                    price_data: {
                      currency: "usd",
                      product_data: {
                        name: "Test Product",
                      },
                      unit_amount: 5000,
                    },
                    quantity: 1,
                  },
                ],
                mode: "payment",
                success_url: "http://localhost:3000/success",
                cancel_url: "http://localhost:3000/cancel",
              });
            
              return serviceResponse(true, "Payment session created successfully", { url: session.url });
              
          } catch (err) {
            return serviceResponse(false, "Payment failed", err);
          }
    }
}