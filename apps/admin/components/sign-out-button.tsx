"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { signOut } from "@admin/lib/auth-client";
import { cn } from "@/lib/utils";

export function SignOutButton({
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"button">, "onClick" | "disabled" | "type">) {
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
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition",
        "hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      disabled={isLoading}
      {...props}
    >
      <LogOut aria-hidden className="size-4" />
      {isLoading ? "Signing out..." : "Sign out"}
    </button>
  );
}
