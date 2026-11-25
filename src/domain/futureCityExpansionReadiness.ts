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

const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const DateIntrinsic = Date;
const TypeErrorIntrinsic = TypeError;
const dateGetTime = Function.call.bind(Date.prototype.getTime) as (value: Date) => number;
const dateToISOString = Function.call.bind(Date.prototype.toISOString) as (value: Date) => string;
const numberIsFinite = Number.isFinite;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (
  pattern: RegExp, value: string,
) => boolean;
const evidenceBrand = new WeakSet<object>();
const weakSetAdd = Function.call.bind(WeakSet.prototype.add) as (
  target: WeakSet<object>, value: object,
) => WeakSet<object>;
const weakSetHas = Function.call.bind(WeakSet.prototype.has) as (
  target: WeakSet<object>, value: object,
) => boolean;
const INVALID_INPUT = 'Invalid Future City expansion readiness input';

export type FutureCityExpansionReadiness = Readonly<{
  schemaVersion: 'future-city-expansion-readiness/1';
  status: 'blocked';
  blockers: readonly string[];
  generatedAt: string;
  privacy: 'private';
  activationState: 'dormant';
}>;

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
        || typeof generatedAt !== 'string'
        || !regexpTest(timestampPattern, generatedAt)) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
    const generatedDate = new DateIntrinsic(generatedAt);
    if (!numberIsFinite(dateGetTime(generatedDate))
        || dateToISOString(generatedDate) !== generatedAt) {
      throw new TypeErrorIntrinsic(INVALID_INPUT);
    }
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
    weakSetAdd(evidenceBrand, evidence);
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
        || (typeof evidenceInput !== 'object' || evidenceInput === null)
        || !weakSetHas(evidenceBrand, evidenceInput)) {
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
    if (evidence.durableRecords !== 'reviewed_working') {
      addBlocker('durable_records_gate_blocked');
    }
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
    return objectFreeze(result) as FutureCityExpansionReadiness;
  } catch {
    throw new TypeErrorIntrinsic(INVALID_INPUT);
  }
}
