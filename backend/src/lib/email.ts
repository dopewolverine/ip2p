import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = env.smtp
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    })
  : null;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!transporter) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${text}`);
    return;
  }

  try {
    await transporter.sendMail({ from: env.smtp!.from, to, subject, text });
  } catch (err) {
    console.error('sendEmail failed', err);
  }
}
