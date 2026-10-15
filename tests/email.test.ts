import { strict as assert } from "node:assert";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { messageFor, rfc5322Date } from "../src/email.ts";
import { renderReport } from "../src/report.ts";
import { everyKind } from "./report-fixture.ts";

test("the Date header is local time with its offset", () => {
  const d = new Date("2026-10-15T15:00:00Z");
  const formatted = rfc5322Date(d);
  assert.match(formatted, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/);
  // Reading it back gives the same instant, whatever the machine's zone is.
  assert.equal(new Date(formatted).getTime(), d.getTime());
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hhmm = `${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  assert.ok(formatted.endsWith(` ${sign}${hhmm}`), formatted);
});

test("the message is multipart/alternative with text and HTML, dated in local time", async () => {
  const report = renderReport(everyKind());
  assert.ok(report !== null);
  const date = new Date("2026-10-15T15:00:00Z");
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await transport.sendMail(messageFor("sender@example.com", "to@example.com", "Subject", date, report));
  const raw = (info.message as Buffer).toString("utf8");
  assert.match(raw, /^Content-Type: multipart\/alternative;/m);
  assert.match(raw, /^Content-Type: text\/plain; charset=utf-8/m);
  assert.match(raw, /^Content-Type: text\/html; charset=utf-8/m);
  // Plain text comes first, so clients that show HTML pick the last part.
  assert.ok(raw.indexOf("text/plain") < raw.indexOf("text/html"));
  const dateHeader = /^Date: (.+)$/m.exec(raw)?.[1];
  assert.equal(dateHeader, rfc5322Date(date));
});
