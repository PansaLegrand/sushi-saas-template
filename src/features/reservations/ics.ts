function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatICSDateUTC(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

export function buildReservationICS(params: {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description?: string;
  url?: string;
}): string {
  const dtStart = formatICSDateUTC(params.start);
  const dtEnd = formatICSDateUTC(params.end);
  const now = formatICSDateUTC(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SushiSaaS//Reservations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(params.title)}`,
    params.description ? `DESCRIPTION:${escapeICS(params.description)}` : undefined,
    params.url ? `URL:${escapeICS(params.url)}` : undefined,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean) as string[];
  return lines.join("\r\n");
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

