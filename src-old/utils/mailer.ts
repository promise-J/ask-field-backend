import axios from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Last messages sent, kept in memory so tests and local development can read links and codes. */
export const outbox: MailMessage[] = [];

export async function sendMail(message: MailMessage) {
  // Keep the in-memory outbox behavior for your tests/dev environments
  outbox.push(message);
  if (outbox.length > 50) outbox.shift();

  if (!env.BREVO_API_KEY) {
    logger.info(
      { to: message.to, subject: message.subject },
      '✉️  Email (BREVO_API_KEY not configured, not sent)'
    );
    return false;
  }

  try {
    // Brevo requires HTML content. If it isn't provided, we fall back to a safe text format.
    const htmlContent = message.html || `<p style="white-space: pre-line;">${message.text}</p>`;

    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          email: env.MAIL_FROM,
          name: env.APP_NAME || 'joinStudy',
        },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: htmlContent,
        textContent: message.text, // Brevo accepts plain text fallback too
      },
      {
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(
      { to: message.to, messageId: response.data.messageId },
      '✅ Email sent via Brevo'
    );
    return true;
  } catch (err: any) {
    // Retains your design rule: Never crash standard flow if the third-party email provider goes down
    logger.error(
      { 
        err: err.response?.data || err.message, 
        to: message.to, 
        subject: message.subject 
      }, 
      '❌ Brevo email failed to send'
    );
    return false;
  }
}

const wrap = (body: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#120e22;max-width:520px">${body}<p style="color:#7f7a96;font-size:13px">joinStudy · hello@joinstudy.io</p></div>`;

export const emails = {
  verify: (name: string, link: string): Omit<MailMessage, 'to'> => ({
    subject: 'Verify your joinStudy email',
    text: `Hi ${name},\n\nConfirm your email to finish creating your joinStudy account:\n${link}\n\nThis link expires in 24 hours.`,
    html: wrap(`<p>Hi ${name},</p><p>Confirm your email to finish creating your joinStudy account.</p><p><a href="${link}" style="background:#f0c93a;color:#251d00;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Verify my email</a></p><p>This link expires in 24 hours.</p>`),
  }),
  otp: (name: string, code: string): Omit<MailMessage, 'to'> => ({
    subject: `${code} is your joinStudy reset code`,
    text: `Hi ${name},\n\nYour password reset code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
    html: wrap(`<p>Hi ${name},</p><p>Your password reset code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you didn't ask for this, you can ignore this email.</p>`),
  }),
  workEmailCode: (name: string, code: string): Omit<MailMessage, 'to'> => ({
    subject: `${code} is your joinStudy verification code`,
    text: `Hi ${name},\n\nEnter ${code} on joinStudy to confirm this is your work email. It expires in 15 minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
    html: wrap(`<p>Hi ${name},</p><p>Enter this code on joinStudy to confirm this is your work email:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 15 minutes. If you didn't ask for this, you can ignore this email.</p>`),
  }),
};
