"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { signOut } from "@/lib/auth-client";
import { AUTH_ROUTES, withLocale } from "@/data/auth";

export default function LogoutButton() {
  const t = useTranslations("auth");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale;
  const router = useRouter();
  const [isLoading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    try {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            router.replace(withLocale(locale, AUTH_ROUTES.defaultCallback));
          },
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring focus-visible:ring-destructive/60 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isLoading}
    >
      {isLoading ? t("pleaseWait") : t("logout")}
    </button>
  );
}

