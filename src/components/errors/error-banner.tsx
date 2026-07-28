import type { ReactNode } from "react";

// Displays a styled error box so pages can surface issues consistently.
interface ErrorBannerProps {
  title?: string;
  message: string;
  details?: string[];
  /**
   * Where the user goes next: a top-up link, a retry button, a support link.
   *
   * Optional, but the reason this component exists in more than one shape. A
   * banner that only states the problem leaves a user who is out of credits
   * with nothing to click, which is the most expensive dead end in the app.
   */
  action?: ReactNode;
}

export function ErrorBanner({
  title = "Something went wrong",
  message,
  details,
  action,
}: ErrorBannerProps) {
  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="font-medium">
        {title}
      </div>
      <div className="mt-1 text-destructive/90">
        {message}
      </div>
      {details && details.length > 0 ? (
        <ul className="mt-3 space-y-1 text-destructive/80">
          {details.map((item) => (
            <li key={item} className="list-inside list-disc">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
