// Displays a styled error box so pages can surface issues consistently.
interface ErrorBannerProps {
  title?: string;
  message: string;
  details?: string[];
}

export function ErrorBanner({
  title = "Something went wrong",
  message,
  details,
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
    </div>
  );
}
