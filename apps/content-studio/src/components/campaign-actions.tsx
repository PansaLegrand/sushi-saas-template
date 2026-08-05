"use client";

import { useState } from "react";
import { Button, toast, useDocumentInfo } from "@payloadcms/ui";

type CampaignMetrics = {
  status?: string;
  recipients?: number;
  limit?: number;
  overLimit?: boolean;
  processed?: number;
  counts?: Record<string, number>;
};

async function action(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = result.error as { message?: unknown } | undefined;
    throw new Error(
      typeof error?.message === "string" ? error.message : `Request failed with HTTP ${response.status}.`
    );
  }
  return result;
}

export default function CampaignActions() {
  const { id } = useDocumentInfo();
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<
    "validate" | "test" | "launch" | "status" | "cancel" | null
  >(null);
  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const base = id ? `/api/marketing/v1/campaigns/${id}` : "";

  async function run(kind: "validate" | "test" | "launch" | "status" | "cancel") {
    if (!id) {
      toast.error("Save the campaign before using preview or delivery actions.");
      return;
    }
    if (kind === "test" && !recipient.trim()) {
      toast.error("Enter a test recipient first.");
      return;
    }
    if (
      kind === "launch" &&
      !window.confirm(
        "Launch this approved, published campaign? The SaaS will resolve the consented audience and queue delivery."
      )
    ) {
      return;
    }
    if (
      kind === "cancel" &&
      !window.confirm(
        "Cancel this campaign? Messages that have already been accepted by the email provider cannot be recalled."
      )
    ) {
      return;
    }

    setBusy(kind);
    try {
      const result = await action(
        `${base}/${kind}`,
        kind === "test" ? { recipient: recipient.trim() } : undefined
      );
      const data =
        result.data && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : result;
      if (kind === "validate") {
        const audience =
          result.audience && typeof result.audience === "object"
            ? (result.audience as Record<string, unknown>)
            : {};
        setMetrics({
          status: audience.overLimit === true ? "audience over limit" : "ready",
          recipients: typeof audience.recipients === "number" ? audience.recipients : undefined,
          limit: typeof audience.limit === "number" ? audience.limit : undefined,
          overLimit: audience.overLimit === true
        });
        if (audience.overLimit === true) {
          toast.error(
            `Campaign content is valid, but the audience exceeds the ${Number(audience.limit).toLocaleString()} recipient safety limit.`
          );
          return;
        }
      } else if (["launch", "status"].includes(kind)) {
        setMetrics(data as CampaignMetrics);
      } else if (kind === "cancel") {
        const campaign =
          data.campaign && typeof data.campaign === "object"
            ? (data.campaign as CampaignMetrics)
            : { status: "canceled" };
        setMetrics(campaign);
      }
      toast.success(
        kind === "validate"
          ? "Campaign and audience are valid."
          : kind === "test"
            ? "Test email queued."
            : kind === "launch"
              ? data.status === "completed"
                ? "Campaign completed; there were no pending recipients."
                : "Campaign delivery queued."
              : kind === "status"
                ? "Delivery status refreshed."
                : "Campaign canceled."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="campaign-actions">
      <div>
        <h3>Preview and delivery</h3>
        <p>
          Preview uses the saved draft. Test and launch go through the SaaS delivery gateway; the
          Studio never receives subscriber addresses.
        </p>
      </div>
      <div className="campaign-actions__row">
        <Button
          buttonStyle="secondary"
          disabled={!id}
          margin={false}
          onClick={() => window.open(`${base}/preview`, "_blank", "noopener,noreferrer")}
          type="button"
        >
          Open preview
        </Button>
        <Button
          buttonStyle="secondary"
          disabled={!id || Boolean(busy)}
          margin={false}
          onClick={() => void run("validate")}
          type="button"
        >
          {busy === "validate" ? "Validating…" : "Validate"}
        </Button>
        <Button
          buttonStyle="secondary"
          disabled={!id || Boolean(busy)}
          margin={false}
          onClick={() => void run("status")}
          type="button"
        >
          {busy === "status" ? "Refreshing…" : "Refresh delivery status"}
        </Button>
      </div>
      {metrics ? (
        <div className="campaign-actions__metrics" aria-live="polite">
          {metrics.status ? <span><strong>Status</strong>{metrics.status}</span> : null}
          {typeof metrics.recipients === "number" ? (
            <span><strong>Audience</strong>{metrics.recipients.toLocaleString()}</span>
          ) : null}
          {typeof metrics.processed === "number" ? (
            <span><strong>Processed</strong>{metrics.processed.toLocaleString()}</span>
          ) : null}
          {metrics.counts?.delivered ? (
            <span><strong>Delivered</strong>{metrics.counts.delivered.toLocaleString()}</span>
          ) : null}
          {metrics.counts?.bounced ? (
            <span><strong>Bounced</strong>{metrics.counts.bounced.toLocaleString()}</span>
          ) : null}
          {metrics.counts?.complained ? (
            <span><strong>Complaints</strong>{metrics.counts.complained.toLocaleString()}</span>
          ) : null}
        </div>
      ) : null}
      <div className="campaign-actions__test">
        <label htmlFor="campaign-test-recipient">Test recipient</label>
        <div className="campaign-actions__row">
          <input
            id="campaign-test-recipient"
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={recipient}
          />
          <Button
            buttonStyle="secondary"
            disabled={!id || Boolean(busy)}
            margin={false}
            onClick={() => void run("test")}
            type="button"
          >
            {busy === "test" ? "Queueing…" : "Send test"}
          </Button>
        </div>
        <small>The address is sent directly to the SaaS and is not saved in Content Studio.</small>
      </div>
      <div className="campaign-actions__row">
        <Button
          buttonStyle="primary"
          disabled={!id || Boolean(busy)}
          margin={false}
          onClick={() => void run("launch")}
          type="button"
        >
          {busy === "launch" ? "Launching…" : "Launch approved campaign"}
        </Button>
        <Button
          buttonStyle="secondary"
          disabled={!id || Boolean(busy)}
          margin={false}
          onClick={() => void run("cancel")}
          type="button"
        >
          {busy === "cancel" ? "Canceling…" : "Cancel pending delivery"}
        </Button>
      </div>
    </section>
  );
}
