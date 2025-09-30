import * as React from "react";

export default function ResetPassword({ url }: { url: string }) {
  return (
    <html>
      <body style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px' }}>
                <table width="100%" style={{ maxWidth: 560, border: '1px solid #e5e7eb', borderRadius: 8 }} role="presentation" cellPadding={0} cellSpacing={0}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '24px' }}>
                        <h1 style={{ margin: 0, fontSize: 20 }}>Reset your password</h1>
                        <p style={{ color: '#4b5563', fontSize: 14, lineHeight: '20px' }}>
                          You recently requested to reset your password. Click the button below to set a new one. This link will expire shortly for security reasons.
                        </p>
                        <p>
                          <a
                            href={url}
                            style={{
                              display: 'inline-block',
                              backgroundColor: '#111827',
                              color: '#fff',
                              textDecoration: 'none',
                              padding: '10px 16px',
                              borderRadius: 6,
                              fontSize: 14,
                            }}
                          >
                            Reset Password
                          </a>
                        </p>
                        <p style={{ color: '#6b7280', fontSize: 12 }}>
                          If the button doesn’t work, copy and paste this URL into your browser:
                          <br />
                          <a href={url} style={{ color: '#2563eb' }}>{url}</a>
                        </p>
                        <p style={{ color: '#9ca3af', fontSize: 12 }}>If you didn’t request this, you can safely ignore this email.</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

