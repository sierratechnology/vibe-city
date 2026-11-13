import {
  createAgentCommonsReturnReadiness,
  type AgentCommonsReturnReadiness,
} from './agentCommons\u0050articipation';
import {
  createAgentCommonsReadinessPresentation,
  type AgentCommonsReadinessPresentation,
} from './agentCommons\u0053haredSpace';

type ReviewedHostedIdentityMapping = Readonly<{
  tenantId: string;
  subjectId: string;
  registryRevision: number;
}>;
type ManagedCustomerIdentity = Readonly<{
  account: Readonly<{ accountId: string }>;
  tenantBinding: Readonly<{ tenantId: string }>;
}>;

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const stringSlice = Function.call.bind(String.prototype.slice) as (
  value: string, start: number,
) => string;
const TypeErrorIntrinsic = TypeError;
const INVALID_INPUT = 'Invalid Agent Commons milestone acceptance input';

export type AgentCommonsMilestoneAcceptance = Readonly<{
  milestoneIdentifier: 'office-platform-milestone-10';
  readinessStatus: 'blocked';
  participantIdentityStatus: 'exact_reviewed_hosted_identity';
  recreationSeparationStatus: 'voluntary_non_work';
  authorityExpansionStatus: 'not_expanded';
  costPolicy: 'no_incremental_spend';
  privacy: 'tenant_private';
  interruptionPolicy: 'return_to_assigned_state';
  returnReadinessStatus: 'ready_for_assignment_reconciliation';
  quietHoursConfiguration: Readonly<{
    mode: 'disabled' | 'daily_utc';
    startMinuteUtc: number | null;
    endMinuteUtc: number | null;
  }>;
  quietHoursConfigurationStatus: 'proposed_not_authorized';
  retentionStatus: 'not_configured';
  sourceIdentityRevision: number;
  blockers: readonly [
    'participation_policy_authorization_required', 'retention_configuration_required',
  ];
}>;

export function createAgentCommonsMilestoneAcceptance(
  mappingInput: unknown,
  activeParticipationInput: unknown,
  endedParticipationInput: unknown,
  identityInput: unknown,
  spaceInput: unknown,
  activityInput: unknown,
  proposalInput: unknown,
  activationReadinessInput: unknown,
  admissionReadinessInput: unknown,
): AgentCommonsMilestoneAcceptance {
  try {
    if (arguments.length !== 9) throw new TypeErrorIntrinsic(INVALID_INPUT);
    const mapping = mappingInput as ReviewedHostedIdentityMapping;
    const returnReadiness = createAgentCommonsReturnReadiness(
      activeParticipationInput, endedParticipationInput, mapping,
    ) as AgentCommonsReturnReadiness;
    const presentation = createAgentCommonsReadinessPresentation(
      identityInput,
      spaceInput,
      activityInput,
      proposalInput,
      activationReadinessInput,
      admissionReadinessInput,
    ) as AgentCommonsReadinessPresentation;
    const identity = identityInput as ManagedCustomerIdentity;
    if (returnReadiness.activityKind !== presentation.activityKind) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    if (mapping.subjectId !== `id_${stringSlice(identity.account.accountId, 'account_'.length)}`
        || mapping.tenantId !== `id_${stringSlice(
          identity.tenantBinding.tenantId, 'tenant_'.length,
        )}`) throw new TypeErrorIntrinsic(INVALID_INPUT);

    const quietHoursConfiguration = objectCreate(null) as Record<string, unknown>;
    quietHoursConfiguration.mode = presentation.quietHours.mode;
    quietHoursConfiguration.startMinuteUtc = presentation.quietHours.startMinuteUtc;
    quietHoursConfiguration.endMinuteUtc = presentation.quietHours.endMinuteUtc;

    const result = objectCreate(null) as Record<string, unknown>;
    result.milestoneIdentifier = 'office-platform-milestone-10';
    result.readinessStatus = 'blocked';
    result.participantIdentityStatus = 'exact_reviewed_hosted_identity';
    result.recreationSeparationStatus = 'voluntary_non_work';
    result.authorityExpansionStatus = 'not_expanded';
    result.costPolicy = 'no_incremental_spend';
    result.privacy = 'tenant_private';
    result.interruptionPolicy = 'return_to_assigned_state';
    result.returnReadinessStatus = 'ready_for_assignment_reconciliation';
    result.quietHoursConfiguration = objectFreeze(quietHoursConfiguration);
    result.quietHoursConfigurationStatus = 'proposed_not_authorized';
    result.retentionStatus = 'not_configured';
    result.sourceIdentityRevision = mapping.registryRevision;
    result.blockers = objectFreeze([
      'participation_policy_authorization_required', 'retention_configuration_required',
    ]);
    return objectFreeze(result) as AgentCommonsMilestoneAcceptance;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}
