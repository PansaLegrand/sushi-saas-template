import * as React from "react";

function formatDateTime(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

export default function ReservationConfirmed(props: {
  reservationNo: string;
  serviceTitle?: string;
  startsAt?: string; // ISO
  timezone?: string;
  googleCalendarUrl?: string;
}) {
  const when = formatDateTime(props.startsAt);
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif", lineHeight: 1.5 }}>
      <h2 style={{ margin: "0 0 12px" }}>Reservation Confirmed</h2>
      <p style={{ margin: 0 }}>Reservation #: <strong>{props.reservationNo}</strong></p>
      {props.serviceTitle ? (
        <p style={{ margin: 0 }}>Service: <strong>{props.serviceTitle}</strong></p>
      ) : null}
      {props.startsAt ? (
        <p style={{ margin: 0 }}>When: <strong>{when}</strong>{props.timezone ? ` (${props.timezone})` : ""}</p>
      ) : null}
      <p style={{ marginTop: 16 }}>We look forward to seeing you. If you need to reschedule, please reply to this email.</p>
      {props.googleCalendarUrl ? (
        <p style={{ marginTop: 12 }}>
          <a href={props.googleCalendarUrl} style={{ color: '#0b57d0', textDecoration: 'underline' }}>Add to Google Calendar</a>
        </p>
      ) : null}
    </div>
  );
}
