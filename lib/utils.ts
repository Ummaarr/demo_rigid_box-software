import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Local "YYYY-MM-DD" for a timestamp, or "" when absent/unparseable — the
 * format the native date input uses, so filter ranges compare as plain strings.
 * Local rather than UTC so a range matches the date the UI actually displays
 * (every table formats with toLocaleDateString); a UTC key would drop rows
 * created late in the day here.
 */
export function localDateKey(value: unknown): string {
  if (!value || typeof value !== "string") return ""
  const d = new Date(value)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** True when `key` (from localDateKey) sits inside an inclusive from–to range. */
export function inDateRange(key: string, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!key) return false
  if (from && key < from) return false
  if (to && key > to) return false
  return true
}
