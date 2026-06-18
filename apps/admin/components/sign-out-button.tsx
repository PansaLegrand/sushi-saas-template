"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@admin/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [isLoading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            router.replace("/login");
            router.refresh();
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
      onClick={handleClick}
      className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isLoading}
    >
      {isLoading ? "Signing out..." : "Sign out"}
    </button>
  );
}
