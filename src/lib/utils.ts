import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** For a snapshot that only tells the browser from the server, so has nothing to watch. */
export function subscribeNever(): () => void {
  return () => undefined
}
