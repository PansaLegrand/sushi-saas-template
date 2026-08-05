import { createHmac } from "node:crypto";

export type RevalidationEvent = {
  collection: "pages" | "posts";
  locale?: string;
  slug: string;
};

export function signRevalidation(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function notifyPublicSite(event: RevalidationEvent): Promise<void> {
  const url = process.env.PUBLIC_SITE_REVALIDATE_URL;
  const secret = process.env.CONTENT_REVALIDATION_SECRET;
  if (!url || !secret) return;

  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-content-timestamp": timestamp,
      "x-content-signature": signRevalidation(body, timestamp, secret)
    },
    body,
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`Public site revalidation returned ${response.status}.`);
  }
}
