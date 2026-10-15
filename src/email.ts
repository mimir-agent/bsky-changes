// SMTP delivery. Credentials come only from the environment and are never
// printed; errors are reported without them.
import nodemailer, { type SendMailOptions } from "nodemailer";
import type { Report } from "./report.ts";

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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An RFC 5322 date in the machine's local time with its UTC offset, like
 * "Thu, 15 Oct 2026 08:00:00 -0700". nodemailer on its own writes UTC as +0000.
 */
export function rfc5322Date(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${DAYS[date.getDay()]}, ${two(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ` +
    `${sign}${two(Math.floor(abs / 60))}${two(abs % 60)}`
  );
}

/** A multipart/alternative message: plain text first, HTML preferred by clients that show it. */
export function messageFor(from: string, to: string, subject: string, date: Date, report: Report): SendMailOptions {
  return { from, to, subject, date: rfc5322Date(date), text: report.text, html: report.html };
}

export async function sendReport(smtp: SmtpSettings, to: string, subject: string, date: Date, report: Report): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // Port 465 is implicit TLS; anything else (587) must upgrade with STARTTLS.
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  try {
    await transport.sendMail(messageFor(smtp.user, to, subject, date, report));
  } catch (err) {
    // nodemailer errors carry the server response, not the password; keep
    // only the message to be sure nothing else leaks.
    throw new Error(`sending email failed: ${(err as Error).message}`);
  } finally {
    transport.close();
  }
}
