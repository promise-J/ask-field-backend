const axios = require("axios");

const sendEmail = async ({ to, subject = "New Mail", html }: {to: string; subject: string; html: string}) => {
  try {
    console.log("📧 Attempting to send email...");

    if (!to || !subject || !html) {
      console.error({
        success: false,
        message: "Please provide all email fields: to, subject, html",
      });
      return false;
    }
    
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          email: process.env.EMAIL_FROM,
          name: process.env.APP_NAME || "My App",
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Email sent via Brevo:", response.data.messageId || "No ID returned");
    return true;
  } catch (error: any) {
    console.error(
      "❌ Brevo email error:",
      error.response?.data || error.message
    );
    return false;
  }
};

module.exports = sendEmail;