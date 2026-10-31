import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// `hasEnvVars` used to live here. It reads process.env at module scope, and
// every ui/* component imports cn() from this file, so the Supabase probe rode
// into anything that bundled a button -- throwing "process is not defined" the
// moment a component was rendered outside Next.js. It now sits in
// lib/supabase/proxy.ts, its only consumer, and this module is pure styling.
