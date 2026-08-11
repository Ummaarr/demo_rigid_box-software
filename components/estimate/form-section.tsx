"use client";

// Numbered form section for the estimate form. The estimate is entered in the
// same order the factory costs a job, so the numbers carry real sequence
// information (they mirror the flow of the client's costing doc), and each
// section is an anchor target for the step rail.

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SectionDef {
  id: string;
  step: number;
  title: string;
  icon: LucideIcon;
}

export function FormSection({
  def,
  description,
  children,
  className,
}: {
  def: SectionDef;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = def.icon;
  return (
    <section
      id={def.id}
      data-section={def.id}
      // scroll-mt keeps the heading visible below the sticky app header when
      // the step rail jumps here.
      className={cn("scroll-mt-24 border-b py-6 first:pt-0 last:border-b-0", className)}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
          {def.step}
        </span>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {def.title}
        </h2>
      </div>
      {description && (
        <p className="-mt-2 mb-4 pl-10 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="flex flex-col gap-4 sm:pl-10">{children}</div>
    </section>
  );
}
