import * as React from "react";

/**
 * An invitation to join an organization.
 *
 * Names the inviter and the organization in the body, not only in the subject:
 * a bare "you have been invited" from an unfamiliar product is indistinguishable
 * from phishing, and the recipient has no way to judge whether to click.
 */
export default function OrgInvitation({
  url,
  organizationName,
  inviterName,
  expiresInHours,
}: {
  url: string;
  organizationName: string;
  inviterName?: string;
  expiresInHours?: number;
}) {
  const invitedBy = inviterName ? `${inviterName} invited you` : "You have been invited";

  return (
    <html>
      <body style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
        <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px" }}>
                <table
                  width="100%"
                  style={{ maxWidth: 560, border: "1px solid #e5e7eb", borderRadius: 8 }}
                  role="presentation"
                  cellPadding={0}
                  cellSpacing={0}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: "24px" }}>
                        <h1 style={{ margin: 0, fontSize: 20 }}>
                          Join {organizationName}
                        </h1>
                        <p style={{ color: "#4b5563", fontSize: 14, lineHeight: "20px" }}>
                          {invitedBy} to join <strong>{organizationName}</strong>.
                          Accepting gives you access to that team&rsquo;s workspace
                          and shared allowance.
                        </p>
                        <p>
                          <a
                            href={url}
                            style={{
                              display: "inline-block",
                              backgroundColor: "#111827",
                              color: "#fff",
                              textDecoration: "none",
                              padding: "10px 16px",
                              borderRadius: 6,
                              fontSize: 14,
                            }}
                          >
                            Accept invitation
                          </a>
                        </p>
                        {expiresInHours ? (
                          <p style={{ color: "#6b7280", fontSize: 12 }}>
                            This invitation expires in {expiresInHours} hours.
                          </p>
                        ) : null}
                        <p style={{ color: "#6b7280", fontSize: 12 }}>
                          If the button does not work, copy and paste this URL into your browser:
                          <br />
                          <a href={url} style={{ color: "#2563eb" }}>{url}</a>
                        </p>
                        <p style={{ color: "#9ca3af", fontSize: 12 }}>
                          If you were not expecting this, you can safely ignore this
                          email — nothing happens until you accept.
                        </p>
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
