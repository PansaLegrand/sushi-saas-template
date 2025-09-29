function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function formatDateUTC(dt: Date): string {
  return (
    dt.getUTCFullYear().toString() +
    pad2(dt.getUTCMonth() + 1) +
    pad2(dt.getUTCDate()) +
    'T' +
    pad2(dt.getUTCHours()) +
    pad2(dt.getUTCMinutes()) +
    pad2(dt.getUTCSeconds()) +
    'Z'
  );
}

export function buildGoogleCalendarUrl(params: {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  timeZone?: string; // ctz
}): string {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const dates = `${formatDateUTC(params.start)}/${formatDateUTC(params.end)}`;
  const q = new URLSearchParams();
  q.set('text', params.title);
  q.set('dates', dates);
  if (params.description) q.set('details', params.description);
  if (params.location) q.set('location', params.location);
  if (params.timeZone) q.set('ctz', params.timeZone);
  return `${base}&${q.toString()}`;
}

