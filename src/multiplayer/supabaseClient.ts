import { SupabaseClient, createClient } from "@supabase/supabase-js";

export type SupabaseRealtimeConfig = {
  configured: boolean;
  urlConfigured: boolean;
  anonKeyConfigured: boolean;
  validationError: string | null;
  url?: string;
  anonKey?: string;
};

let warnedAboutMissingEnv = false;

function cleanEnvValue(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed === "\"\"" || trimmed === "''") return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function getSupabaseRealtimeConfig(): SupabaseRealtimeConfig {
  const url = cleanEnvValue(import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const anonKey = cleanEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
  const urlConfigured = Boolean(url);
  const anonKeyConfigured = Boolean(anonKey);
  const urlValid = urlConfigured && isValidSupabaseUrl(url);
  const anonKeyLooksValid = anonKeyConfigured && anonKey.split(".").length === 3;
  const validationError = !urlConfigured
    ? "Missing VITE_SUPABASE_URL"
    : !urlValid
      ? "VITE_SUPABASE_URL must be a valid https://*.supabase.co URL"
      : !anonKeyConfigured
        ? "Missing VITE_SUPABASE_ANON_KEY"
        : !anonKeyLooksValid
          ? "VITE_SUPABASE_ANON_KEY does not look like a Supabase anon JWT"
          : null;
  const configured = !validationError;

  if (!configured && !warnedAboutMissingEnv) {
    warnedAboutMissingEnv = true;
    console.warn("STG World Zero multiplayer offline: Supabase env is missing or invalid.", { validationError });
  }
  console.info("STG World Zero multiplayer env detected", {
    supabaseUrlConfigured: urlConfigured,
    supabaseAnonKeyConfigured: anonKeyConfigured,
    supabaseUrlValid: urlValid,
    supabaseAnonKeyLooksValid: anonKeyLooksValid,
    configured,
    validationError
  });

  return { configured, urlConfigured, anonKeyConfigured, validationError, url, anonKey };
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
  console.info("STG World Zero Supabase client created", { realtimeConfigured: true });
  return client;
}
