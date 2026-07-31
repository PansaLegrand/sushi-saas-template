"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { signOut } from "@admin/lib/auth-client";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOutButton({
  className,
  ...props
}: Omit<ButtonProps, "onClick" | "disabled" | "type" | "variant" | "asChild">) {
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
    <Button
      type="button"
      variant="ghost"
      onClick={handleClick}
      className={cn("gap-2 text-muted-foreground", className)}
      disabled={isLoading}
      {...props}
    >
      <LogOut aria-hidden className="size-4" />
      {isLoading ? "Signing out..." : "Sign out"}
    </Button>
  );
}
