import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncate(text: string, max = 80) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function pluralize(count: number, singular: string, plural = singular + "s") {
  return `${count} ${count === 1 ? singular : plural}`;
}
