import * as React from "react";

export default function WelcomeEmail({ name }: { name?: string }) {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', lineHeight: 1.6, color: '#0f172a' }}>
      <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>
        Welcome{ name ? `, ${name}` : '' }!
      </h1>
      <p style={{ margin: '0 0 12px' }}>
        Thanks for signing up — we’re excited to have you on board.
      </p>
      <p style={{ margin: 0 }}>
        You can reply to this email if you have any questions.
      </p>
    </div>
  );
}

