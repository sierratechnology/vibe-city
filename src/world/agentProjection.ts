export type AgentRegistryUnavailable = {
  status: "unavailable";
  reason: "not_configured" | "offline" | "error";
};

export type AuthorizedRegistryAgent<Agent> = {
  agent: Agent;
  source: "authorized_registry";
  sourceId: string;
  synchronizedAt: string;
};

export type AgentRegistryReady<Agent> = {
  status: "ready";
  agents: readonly AuthorizedRegistryAgent<Agent>[];
};

export type AgentRegistryState<Agent> = AgentRegistryUnavailable | AgentRegistryReady<Agent>;

export function projectAuthorizedAgents<Agent>(state: AgentRegistryState<Agent> | unknown): Agent[] {
  if (!state || typeof state !== "object") return [];
  const candidate = state as { status?: unknown; agents?: unknown };
  if (candidate.status !== "ready" || !Array.isArray(candidate.agents)) return [];
  return candidate.agents
    .filter((record): record is AuthorizedRegistryAgent<Agent> => {
      if (!record || typeof record !== "object") return false;
      const registryRecord = record as Partial<AuthorizedRegistryAgent<Agent>>;
      return (
        registryRecord.source === "authorized_registry" &&
        typeof registryRecord.sourceId === "string" &&
        registryRecord.sourceId.length > 0 &&
        typeof registryRecord.synchronizedAt === "string" &&
        Number.isFinite(Date.parse(registryRecord.synchronizedAt)) &&
        registryRecord.agent !== null &&
        typeof registryRecord.agent === "object"
      );
    })
    .map((record) => record.agent);
}
