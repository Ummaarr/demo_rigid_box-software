import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Lightweight styled native <select> — matches the Input look without pulling in
// a portal/listbox dependency. Good enough for an internal tool's dropdowns.
// appearance-none + our own chevron so it doesn't render the dated OS arrow.
function NativeSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <select
        data-slot="native-select"
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pl-2.5 pr-8 text-sm transition-colors outline-none hover:border-ring/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export { NativeSelect };
