import { SupabaseClient, createClient } from "@supabase/supabase-js";

export type SupabaseRealtimeConfig = {
  configured: boolean;
  urlConfigured: boolean;
  anonKeyConfigured: boolean;
  url?: string;
  anonKey?: string;
};

let warnedAboutMissingEnv = false;

export function getSupabaseRealtimeConfig(): SupabaseRealtimeConfig {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const urlConfigured = Boolean(url);
  const anonKeyConfigured = Boolean(anonKey);
  const configured = urlConfigured && anonKeyConfigured;

  if (!configured && !warnedAboutMissingEnv) {
    warnedAboutMissingEnv = true;
    console.warn("Vibe City multiplayer offline: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
  }
  console.info("Vibe City multiplayer env detected", {
    supabaseUrlConfigured: urlConfigured,
    supabaseAnonKeyConfigured: anonKeyConfigured,
    configured
  });

  return { configured, urlConfigured, anonKeyConfigured, url, anonKey };
}

export function createSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseRealtimeConfig();
  if (!config.configured || !config.url || !config.anonKey) return null;
  const client = createClient(config.url, config.anonKey, {
    realtime: {
      params: {
        eventsPerSecond: 12
      }
    }
  });
  console.info("Vibe City Supabase client created", { realtimeConfigured: true });
  return client;
}
