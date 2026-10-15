// SMTP delivery. Credentials come only from the environment and are never
// printed; errors are reported without them.
import nodemailer from "nodemailer";

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
}

const REQUIRED = ["EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT"] as const;

export function smtpFromEnv(env: NodeJS.ProcessEnv): SmtpSettings {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`--email needs these environment variables: ${missing.join(", ")}`);
  const port = Number(env.EMAIL_SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error("EMAIL_SMTP_PORT must be a port number");
  return {
    host: env.EMAIL_SMTP_HOST as string,
    port,
    user: env.EMAIL_ADDRESS as string,
    pass: env.EMAIL_PASSWORD as string,
  };
}

export function subjectFor(date: Date): string {
  return `Bluesky changes, ${date.toISOString().slice(0, 10)}`;
}

export async function sendReport(smtp: SmtpSettings, to: string, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // Port 465 is implicit TLS; anything else (587) must upgrade with STARTTLS.
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  try {
    await transport.sendMail({ from: smtp.user, to, subject, text });
  } catch (err) {
    // nodemailer errors carry the server response, not the password; keep
    // only the message to be sure nothing else leaks.
    throw new Error(`sending email failed: ${(err as Error).message}`);
  } finally {
    transport.close();
  }
}
