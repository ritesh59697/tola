/**
 * A calendar file that reminds a customer each time their next instalment opens.
 * Built in the browser from the plan's own numbers; nothing is sent anywhere.
 */
export function instalmentReminder(opts: {
  shopName: string;
  firstOpen: number; // unix seconds when the next instalment opens
  periodSeconds: number;
  graceSeconds: number;
  remaining: number;
  url: string;
}): string {
  const stamp = (unix: number) => new Date(unix * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const days = opts.periodSeconds / 86400;
  const graceDays = Math.round(opts.graceSeconds / 86400);
  // Calendar text must escape commas, semicolons and backslashes.
  const text = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tola//Instalment reminder//EN",
    "BEGIN:VEVENT",
    `UID:${opts.firstOpen}-${opts.url.length}@tola`,
    `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(opts.firstOpen)}`,
    `DTEND:${stamp(opts.firstOpen + 3600)}`,
    `RRULE:FREQ=DAILY;INTERVAL=${days};COUNT=${opts.remaining}`,
    `SUMMARY:${text(`Pay your Tola instalment: ${opts.shopName}`)}`,
    `DESCRIPTION:${text(`Your next instalment is open for ${graceDays} days. Open your passbook: ${opts.url}`)}`,
    `URL:${opts.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Only plans counted in whole days get a reminder; demo plans with minute-long months do not. */
export const remindable = (periodSeconds: number) => periodSeconds >= 86400 && periodSeconds % 86400 === 0;
