import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectProps extends React.ComponentProps<"select"> {
  /** Comfortable is the application default; compact is reserved for dense toolbars. */
  density?: "comfortable" | "compact";
}

/**
 * A styled native `<select>`, not a Radix listbox.
 *
 * Deliberate: the native control gets the platform picker on mobile, needs no
 * JavaScript to open, and is keyboard- and screen-reader-correct for free. Reach
 * for `@radix-ui/react-select` only when a design genuinely needs rich option
 * markup — and add it as a separate `combobox` primitive so this one stays cheap.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, density = "comfortable", ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex w-full appearance-none rounded-md border border-input bg-background shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
          density === "compact"
            ? "h-8 py-1 pl-2.5 pr-8 text-sm"
            : "h-10 py-2 pl-3 pr-9 text-base",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
          density === "compact" ? "right-2.5" : "right-3",
        )}
      />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
