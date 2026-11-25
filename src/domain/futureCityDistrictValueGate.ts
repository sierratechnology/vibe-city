type ReviewedGateState = 'reviewed_working' | 'blocked_missing_reviewed_evidence';
type AccountingGateState = 'blocked_pending_human_decisions';

type FutureCityExpansionGateEvidence = Readonly<{
  firstSkyscraper: ReviewedGateState;
  tenancy: ReviewedGateState;
  hostedAgents: ReviewedGateState;
  durableRecords: ReviewedGateState;
  authorityControls: ReviewedGateState;
  accessibility: ReviewedGateState;
  performance: ReviewedGateState;
  accounting: AccountingGateState;
  generatedAt: string;
}>;

export type FutureCityExpansionReadiness = Readonly<{
  schemaVersion: 'future-city-expansion-readiness/1';
  status: 'blocked';
  blockers: readonly string[];
  generatedAt: string;
  privacy: 'private';
  activationState: 'dormant';
}>;

type DistrictPurpose = 'training' | 'collaboration' | 'convention' | 'service_access';
type PlatformValueEvidence = 'not_provided' | 'reviewed_value';

type FutureCityDistrictProposalEvidence = Readonly<{
  proposalId: string;
  generatedAt: string;
  purpose: DistrictPurpose;
  platformValueEvidence: PlatformValueEvidence;
  sensitivity: 'private';
  activationState: 'dormant';
}>;

export type FutureCityDistrictValueGate = Readonly<{
  proposalId: string;
  status: 'blocked';
  sensitivity: 'private';
  activationState: 'dormant';
  generatedAt: string;
  reasonCodes: readonly ('entry_gate_blocked' | 'value_evidence_missing')[];
}>;

type FutureCityDistrictReviewEvidence = Readonly<{
  proposalId: string;
  generatedAt: string;
  reviewState: 'pending_human_decision';
  sensitivity: 'private';
  activationState: 'dormant';
}>;

export type FutureCityDistrictReviewReadiness = Readonly<{
  proposalId: string;
  status: 'blocked';
  reviewState: 'pending_human_decision';
  sensitivity: 'private';
  activationState: 'dormant';
  generatedAt: string;
  reasonCodes: readonly (
    'entry_gate_blocked' | 'value_evidence_missing' | 'human_review_required'
  )[];
}>;

export type FutureCityMilestoneAssessment = Readonly<{
  schemaVersion: 'future-city-milestone-assessment/1';
  roadmapMilestone: 11;
  proposalId: string;
  status: 'blocked';
  districtCreationState: 'prohibited';
  sensitivity: 'private';
  activationState: 'dormant';
  generatedAt: string;
  reasonCodes: readonly (
    'entry_gate_blocked'
    | 'value_evidence_missing'
    | 'human_review_required'
    | 'future_city_expansion_blocked'
  )[];
}>;

const readinessBrand = new WeakSet<object>();
const expansionEvidenceBrand = new WeakSet<object>();
const evidenceBrand = new WeakSet<object>();
const districtValueGateBrand = new WeakSet<object>();
const districtReviewEvidenceBrand = new WeakSet<object>();
const districtReviewReadinessBrand = new WeakSet<object>();
const districtReviewValueGate = new WeakMap<object, FutureCityDistrictValueGate>();
const DateIntrinsic = Date;
const TypeErrorIntrinsic = TypeError;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const numberIsFinite = Number.isFinite;
const dateGetTime = Function.call.bind(Date.prototype.getTime) as (value: Date) => number;
const dateToISOString = Function.call.bind(Date.prototype.toISOString) as (value: Date) => string;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (
  pattern: RegExp, value: string,
) => boolean;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const proposalIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVALID_INPUT = 'Invalid Future City district value gate input';
const weakSetAdd = Function.call.bind(WeakSet.prototype.add) as (
  target: WeakSet<object>, value: object,
) => WeakSet<object>;
const weakSetHas = Function.call.bind(WeakSet.prototype.has) as (
  target: WeakSet<object>, value: object,
) => boolean;
const weakMapSet = Function.call.bind(WeakMap.prototype.set) as (
  target: WeakMap<object, FutureCityDistrictValueGate>,
  key: object,
  value: FutureCityDistrictValueGate,
) => WeakMap<object, FutureCityDistrictValueGate>;
const weakMapGet = Function.call.bind(WeakMap.prototype.get) as (
  target: WeakMap<object, FutureCityDistrictValueGate>, key: object,
) => FutureCityDistrictValueGate | undefined;

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !regexpTest(timestampPattern, value)) return false;
  const date = new DateIntrinsic(value);
  return numberIsFinite(dateGetTime(date)) && dateToISOString(date) === value;
}

export function createFutureCityExpansionGateEvidence(
  firstSkyscraper: ReviewedGateState,
  tenancy: ReviewedGateState,
  hostedAgents: ReviewedGateState,
  durableRecords: ReviewedGateState,
  authorityControls: ReviewedGateState,
  accessibility: ReviewedGateState,
  performance: ReviewedGateState,
  accounting: AccountingGateState,
  generatedAt: string,
): FutureCityExpansionGateEvidence {
  try {
    const isReviewedGate = (value: unknown): value is ReviewedGateState => (
      value === 'reviewed_working' || value === 'blocked_missing_reviewed_evidence'
    );
    if (arguments.length !== 9
        || !isReviewedGate(firstSkyscraper)
        || !isReviewedGate(tenancy)
        || !isReviewedGate(hostedAgents)
        || !isReviewedGate(durableRecords)
        || !isReviewedGate(authorityControls)
        || !isReviewedGate(accessibility)
        || !isReviewedGate(performance)
        || accounting !== 'blocked_pending_human_decisions'
        || !isCanonicalTimestamp(generatedAt)) throw new TypeErrorIntrinsic(INVALID_INPUT);
    const evidence = objectCreate(null) as Record<string, unknown>;
    evidence.firstSkyscraper = firstSkyscraper;
    evidence.tenancy = tenancy;
    evidence.hostedAgents = hostedAgents;
    evidence.durableRecords = durableRecords;
    evidence.authorityControls = authorityControls;
    evidence.accessibility = accessibility;
    evidence.performance = performance;
    evidence.accounting = accounting;
    evidence.generatedAt = generatedAt;
    objectFreeze(evidence);
    weakSetAdd(expansionEvidenceBrand, evidence);
    return evidence as FutureCityExpansionGateEvidence;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}

export function evaluateFutureCityExpansionReadiness(
  evidenceInput: unknown,
): FutureCityExpansionReadiness {
  try {
    if (arguments.length !== 1
        || typeof evidenceInput !== 'object' || evidenceInput === null
        || !weakSetHas(expansionEvidenceBrand, evidenceInput)) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    const evidence = evidenceInput as FutureCityExpansionGateEvidence;
    const blockers: string[] = [];
    const addBlocker = (blocker: string): void => {
      objectDefineProperty(blockers, blockers.length, {
        configurable: true, enumerable: true, value: blocker, writable: true,
      });
    };
    if (evidence.firstSkyscraper !== 'reviewed_working') {
      addBlocker('first_skyscraper_gate_blocked');
    }
    if (evidence.tenancy !== 'reviewed_working') addBlocker('tenancy_gate_blocked');
    if (evidence.hostedAgents !== 'reviewed_working') addBlocker('hosted_agents_gate_blocked');
    if (evidence.durableRecords !== 'reviewed_working') addBlocker('durable_records_gate_blocked');
    if (evidence.authorityControls !== 'reviewed_working') {
      addBlocker('authority_controls_gate_blocked');
    }
    if (evidence.accessibility !== 'reviewed_working') addBlocker('accessibility_gate_blocked');
    if (evidence.performance !== 'reviewed_working') addBlocker('performance_gate_blocked');
    addBlocker('accounting_gate_blocked');
    const result = objectCreate(null) as Record<string, unknown>;
    result.schemaVersion = 'future-city-expansion-readiness/1';
    result.status = 'blocked';
    result.blockers = objectFreeze(blockers);
    result.generatedAt = evidence.generatedAt;
    result.privacy = 'private';
    result.activationState = 'dormant';
    objectFreeze(result);
    weakSetAdd(readinessBrand, result);
    return result as FutureCityExpansionReadiness;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}

export function createFutureCityDistrictProposalEvidence(
  proposalId: string,
  generatedAt: string,
  purpose: DistrictPurpose,
  platformValueEvidence: PlatformValueEvidence,
  sensitivity: 'private',
  activationState: 'dormant',
): FutureCityDistrictProposalEvidence {
  try {
    if (arguments.length !== 6
        || typeof proposalId !== 'string'
        || proposalId.length < 1
        || proposalId.length > 64
        || !regexpTest(proposalIdPattern, proposalId)
        || !isCanonicalTimestamp(generatedAt)
        || (purpose !== 'training' && purpose !== 'collaboration'
          && purpose !== 'convention' && purpose !== 'service_access')
        || (platformValueEvidence !== 'not_provided'
          && platformValueEvidence !== 'reviewed_value')
        || sensitivity !== 'private'
        || activationState !== 'dormant') throw new TypeErrorIntrinsic(INVALID_INPUT);
    const evidence = objectCreate(null) as Record<string, unknown>;
    evidence.proposalId = proposalId;
    evidence.generatedAt = generatedAt;
    evidence.purpose = purpose;
    evidence.platformValueEvidence = platformValueEvidence;
    evidence.sensitivity = sensitivity;
    evidence.activationState = activationState;
    objectFreeze(evidence);
    weakSetAdd(evidenceBrand, evidence);
    return evidence as FutureCityDistrictProposalEvidence;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}

export function evaluateFutureCityDistrictValueGate(
  readinessInput: unknown,
  evidenceInput: unknown,
): FutureCityDistrictValueGate {
  try {
    if (arguments.length !== 2
        || typeof readinessInput !== 'object' || readinessInput === null
        || typeof evidenceInput !== 'object' || evidenceInput === null
        || !weakSetHas(readinessBrand, readinessInput)
        || !weakSetHas(evidenceBrand, evidenceInput)) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    const evidence = evidenceInput as FutureCityDistrictProposalEvidence;
    const reasonCodes = objectFreeze(evidence.platformValueEvidence === 'not_provided'
      ? ['entry_gate_blocked', 'value_evidence_missing'] as const
      : ['entry_gate_blocked'] as const);
    const result = objectCreate(null) as Record<string, unknown>;
    result.proposalId = evidence.proposalId;
    result.status = 'blocked';
    result.sensitivity = 'private';
    result.activationState = 'dormant';
    result.generatedAt = evidence.generatedAt;
    result.reasonCodes = reasonCodes;
    objectFreeze(result);
    weakSetAdd(districtValueGateBrand, result);
    return result as FutureCityDistrictValueGate;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}

export function createFutureCityDistrictReviewEvidence(
  valueGateInput: unknown,
  proposalId: string,
  generatedAt: string,
  reviewState: 'pending_human_decision',
  sensitivity: 'private',
  activationState: 'dormant',
): FutureCityDistrictReviewEvidence {
  try {
    if (arguments.length !== 6
        || typeof valueGateInput !== 'object' || valueGateInput === null
        || !weakSetHas(districtValueGateBrand, valueGateInput)
        || typeof proposalId !== 'string'
        || proposalId !== (valueGateInput as FutureCityDistrictValueGate).proposalId
        || !isCanonicalTimestamp(generatedAt)
        || reviewState !== 'pending_human_decision'
        || sensitivity !== 'private'
        || activationState !== 'dormant') {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    const evidence = objectCreate(null) as Record<string, unknown>;
    evidence.proposalId = proposalId;
    evidence.generatedAt = generatedAt;
    evidence.reviewState = reviewState;
    evidence.sensitivity = sensitivity;
    evidence.activationState = activationState;
    objectFreeze(evidence);
    weakSetAdd(districtReviewEvidenceBrand, evidence);
    weakMapSet(
      districtReviewValueGate,
      evidence,
      valueGateInput as FutureCityDistrictValueGate,
    );
    return evidence as FutureCityDistrictReviewEvidence;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}

export function evaluateFutureCityDistrictReviewReadiness(
  valueGateInput: unknown,
  evidenceInput: unknown,
): FutureCityDistrictReviewReadiness {
  try {
    if (arguments.length !== 2
        || typeof valueGateInput !== 'object' || valueGateInput === null
        || typeof evidenceInput !== 'object' || evidenceInput === null
        || !weakSetHas(districtValueGateBrand, valueGateInput)
        || !weakSetHas(districtReviewEvidenceBrand, evidenceInput)
        || weakMapGet(districtReviewValueGate, evidenceInput) !== valueGateInput
        || (evidenceInput as FutureCityDistrictReviewEvidence).generatedAt
          < (valueGateInput as FutureCityDistrictValueGate).generatedAt) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    const valueGate = valueGateInput as FutureCityDistrictValueGate;
    const evidence = evidenceInput as FutureCityDistrictReviewEvidence;
    const reasonCodes = objectFreeze(valueGate.reasonCodes.length === 2
      ? ['entry_gate_blocked', 'value_evidence_missing', 'human_review_required'] as const
      : ['entry_gate_blocked', 'human_review_required'] as const);
    const result = objectCreate(null) as Record<string, unknown>;
    result.proposalId = evidence.proposalId;
    result.status = 'blocked';
    result.reviewState = 'pending_human_decision';
    result.sensitivity = 'private';
    result.activationState = 'dormant';
    result.generatedAt = evidence.generatedAt;
    result.reasonCodes = reasonCodes;
    objectFreeze(result);
    weakSetAdd(districtReviewReadinessBrand, result);
    return result as FutureCityDistrictReviewReadiness;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}

export function evaluateFutureCityMilestoneAssessment(
  reviewReadinessInput: unknown,
): FutureCityMilestoneAssessment {
  try {
    if (arguments.length !== 1
        || typeof reviewReadinessInput !== 'object' || reviewReadinessInput === null
        || !weakSetHas(districtReviewReadinessBrand, reviewReadinessInput)) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    const reviewReadiness = reviewReadinessInput as FutureCityDistrictReviewReadiness;
    const reasonCodes = objectFreeze(reviewReadiness.reasonCodes.length === 3
      ? [
        'entry_gate_blocked',
        'value_evidence_missing',
        'human_review_required',
        'future_city_expansion_blocked',
      ] as const
      : [
        'entry_gate_blocked',
        'human_review_required',
        'future_city_expansion_blocked',
      ] as const);
    const result = objectCreate(null) as Record<string, unknown>;
    result.schemaVersion = 'future-city-milestone-assessment/1';
    result.roadmapMilestone = 11;
    result.proposalId = reviewReadiness.proposalId;
    result.status = 'blocked';
    result.districtCreationState = 'prohibited';
    result.sensitivity = 'private';
    result.activationState = 'dormant';
    result.generatedAt = reviewReadiness.generatedAt;
    result.reasonCodes = reasonCodes;
    return objectFreeze(result) as FutureCityMilestoneAssessment;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}
