"use client";

import { RefreshRouteOnSave } from "@payloadcms/live-preview-react";
import { useRouter } from "next/navigation";

export function LivePreviewListener() {
  const router = useRouter();
  const serverURL = typeof window === "undefined" ? "" : window.location.origin;
  return <RefreshRouteOnSave refresh={router.refresh} serverURL={serverURL} />;
}
