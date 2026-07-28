const LATEST_COMMIT_ENDPOINT = "https://api.github.com/repos/sierratechnology/vibe-city/commits?per_page=1";
const COMMIT_URL_PREFIX = "https://github.com/sierratechnology/vibe-city/commit/";
const CACHE_TTL_MS = 60_000;

export type PublicProjectRecord = {
  status: "available";
  freshness: "fresh" | "stale";
  title: string;
  source: "GitHub public repository";
  sourceId: string;
  sourceUpdatedAt: string;
  observedAt: string;
  checkedAt: string;
  url: string;
  staleReason?: PublicProjectRecordUnavailable["reason"];
};

export type PublicProjectRecordUnavailable = {
  status: "unavailable";
  freshness: "unavailable";
  reason: "network" | "rate_limited" | "source_error" | "invalid_record";
  checkedAt: string;
};

export type PublicProjectRecordState = PublicProjectRecord | PublicProjectRecordUnavailable;

type GitHubCommitPayload = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    committer: { date: string } | null;
  };
};

type LoadOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  force?: boolean;
};

let cachedRecord: PublicProjectRecord | null = null;
let pendingLoad: Promise<PublicProjectRecordState> | null = null;

function isGitHubCommitPayload(value: unknown): value is GitHubCommitPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GitHubCommitPayload>;
  return (
    typeof candidate.sha === "string" &&
    /^[a-f0-9]{40}$/i.test(candidate.sha) &&
    typeof candidate.html_url === "string" &&
    candidate.html_url === `${COMMIT_URL_PREFIX}${candidate.sha}` &&
    typeof candidate.commit?.message === "string" &&
    typeof candidate.commit.committer?.date === "string" &&
    Number.isFinite(Date.parse(candidate.commit.committer.date))
  );
}

function safeTitle(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0].replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (firstLine || "Untitled commit").slice(0, 160);
}

function unavailable(reason: PublicProjectRecordUnavailable["reason"], checkedAt: string): PublicProjectRecordState {
  if (cachedRecord) {
    cachedRecord = { ...cachedRecord, freshness: "stale", staleReason: reason, checkedAt };
    return cachedRecord;
  }
  return { status: "unavailable", freshness: "unavailable", reason, checkedAt };
}

async function performLoad(options: LoadOptions): Promise<PublicProjectRecordState> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();

  if (!options.force && cachedRecord && now() - Date.parse(cachedRecord.checkedAt) < CACHE_TTL_MS) {
    return cachedRecord;
  }

  let response: Response;
  try {
    response = await fetcher(LATEST_COMMIT_ENDPOINT, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    return unavailable("network", checkedAt);
  }

  if (response.status === 403 || response.status === 429) return unavailable("rate_limited", checkedAt);
  if (!response.ok) return unavailable("source_error", checkedAt);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailable("invalid_record", checkedAt);
  }

  const candidate = Array.isArray(payload) ? payload[0] : null;
  if (!isGitHubCommitPayload(candidate)) return unavailable("invalid_record", checkedAt);

  cachedRecord = {
    status: "available",
    freshness: "fresh",
    title: safeTitle(candidate.commit.message),
    source: "GitHub public repository",
    sourceId: candidate.sha,
    sourceUpdatedAt: new Date(candidate.commit.committer!.date).toISOString(),
    observedAt: checkedAt,
    checkedAt,
    url: candidate.html_url
  };
  return cachedRecord;
}

export function loadLatestPublicProjectRecord(options: LoadOptions = {}): Promise<PublicProjectRecordState> {
  if (pendingLoad) return pendingLoad;
  pendingLoad = performLoad(options).finally(() => {
    pendingLoad = null;
  });
  return pendingLoad;
}
