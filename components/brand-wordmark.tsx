// Brand lockup — the logo (monogram + name + tagline), in /public/brand/logo.png.
// One component so every placement (login, sidebar, future header) stays
// consistent. The identity behind it comes from lib/brand.ts; rebranding means
// replacing that file plus the PNG at this path (and app/icon.png,
// app/apple-icon.png, app/favicon.ico).

import Image from "next/image";

import { BRAND } from "@/lib/brand";

export function BrandWordmark({
  className,
  width = 200,
}: {
  className?: string;
  width?: number;
}) {
  const { width: iw, height: ih } = BRAND.logoIntrinsic;
  const height = Math.round((width * ih) / iw);
  return (
    <Image
      src="/brand/logo.png"
      alt={`${BRAND.name} — ${BRAND.tagline}`}
      width={width}
      height={height}
      priority
      className={className}
    />
  );
}
