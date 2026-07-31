import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  /** Comfortable is the application default; compact is reserved for dense toolbars. */
  density?: "comfortable" | "compact";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, density = "comfortable", type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex w-full rounded-md border border-input bg-background shadow-sm transition-colors",
        "placeholder:text-muted-foreground",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
        density === "compact"
          ? "h-8 px-2.5 py-1 text-sm"
          : "h-10 px-3 py-2 text-base",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
