import { useEffect, useState } from "react";
import { X, ShieldCheck } from "lucide-react";

const KEY = "cs.privacyBannerDismissed";

export function PrivacyBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShow(localStorage.getItem(KEY) !== "1");
  }, []);

  if (!show) return null;

  return (
    <div className="border-b border-border bg-primary-light">
      <div className="mx-auto flex max-w-4xl items-start gap-3 px-4 py-2.5 text-sm text-primary-dark">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p className="flex-1">
          Clean Start does not sell your data, track you across the web, or recommend specific
          vendors. Your conversation is private.
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            localStorage.setItem(KEY, "1");
            setShow(false);
          }}
          className="rounded p-1 text-primary-dark/70 hover:bg-white/40 hover:text-primary-dark"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
