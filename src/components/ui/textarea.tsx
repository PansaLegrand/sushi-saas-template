import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  /** Comfortable is the application default; compact is reserved for dense toolbars. */
  density?: "comfortable" | "compact";
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, density = "comfortable", ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex w-full resize-y rounded-md border border-input bg-background shadow-sm transition-colors",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
        density === "compact"
          ? "min-h-20 px-2.5 py-1.5 text-sm"
          : "min-h-24 px-3 py-2.5 text-base",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
