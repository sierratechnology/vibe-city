import { SupabaseClient, createClient } from "@supabase/supabase-js";

export type SupabaseRealtimeConfig = {
  configured: boolean;
  url?: string;
  anonKey?: string;
};

let warnedAboutMissingEnv = false;

export function getSupabaseRealtimeConfig(): SupabaseRealtimeConfig {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const configured = Boolean(url && anonKey);

  if (!configured && !warnedAboutMissingEnv) {
    warnedAboutMissingEnv = true;
    console.warn("Vibe City multiplayer offline: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
  }

  return { configured, url, anonKey };
}

export function createSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseRealtimeConfig();
  if (!config.configured || !config.url || !config.anonKey) return null;
  return createClient(config.url, config.anonKey, {
    realtime: {
      params: {
        eventsPerSecond: 12
      }
    }
  });
}
