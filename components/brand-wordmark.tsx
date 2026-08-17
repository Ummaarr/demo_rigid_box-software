// Brand lockup placeholder. No client logo has been supplied yet, so this
// renders a typographic stand-in ("Logo") instead of an image — swap in a
// real <Image> pointed at /public/brand/logo.png (see lib/brand.ts) once
// branding is finalized. The PDF documents (components/pdf/*) still read the
// real logo.png file directly for the customer-facing quotation, since a
// generated PDF needs a real mark regardless of what the app chrome shows.

import { cn } from "@/lib/utils";

export function BrandWordmark({
  className,
  width = 200,
}: {
  className?: string;
  width?: number;
}) {
  // Scales with the same `width` prop callers already pass for the image, so
  // every existing placement (sidebar, login) sizes itself the same way.
  const fontSize = Math.round(width * 0.16);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.2em] font-heading leading-none font-bold tracking-tight text-foreground",
        className,
      )}
      style={{ fontSize }}
    >
      Logo
      <span
        aria-hidden
        className="mb-[0.65em] size-[0.14em] shrink-0 rounded-full bg-clay"
      />
    </span>
  );
}
