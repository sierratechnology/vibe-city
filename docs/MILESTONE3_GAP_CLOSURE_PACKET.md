# Milestone 3 Gap-Closure Packet

**Status:** Documentation and acceptance contract only

**Candidate inspected:** commit `6d71abf314d069c1de4bf9f37a9aaa08a2842dae`, tree `88b6e5dd32df921d73d4ea164469950f1dc7e67c`

**Milestone authority:** `VIBE_CITY_ROADMAP.md` lines 149–173 and its cross-cutting gates

**Design authority:** `VIBE_CITY_MASTER_DESIGN.md`, Version 0, with `STG_TOWER_OPERATIONS.md` and `VIBE_CITY_GAMEPLAY.md` as companions

**Boundary:** This packet does not change implementation, activate a provider, publish data, migrate a database, deploy, or begin Milestone 4.

The task brief referred to `DESIGN_BIBLE.md`; that path does not exist in the authoritative project directory. The roadmap itself names `VIBE_CITY_MASTER_DESIGN.md` as the design authority, and that file identifies itself as Design Bible Version 0. This packet uses that verified authority rather than inventing or replacing a file.

## 1. Milestone claim

The integrated candidate is a verified **local authenticated work-event prototype**. It proves a useful privacy-safe ingestion, persistence, read, and Records Terminal path on one loopback host. It does **not** complete Milestone 3, because it has no authenticated tenant identity, tenant-isolated read model, full work-record schema, backend tenant authorization, material audit trail, historical continuity model, or complete direction-to-outcome trace.

The candidate may be released and described as a local foundation. It must not be labeled “Milestone 3 complete.”

## 2. Exact candidate inventory

### 2.1 What the exact candidate proves

| Proven candidate behavior | Exact evidence in the inspected tree | Limit on the claim |
|---|---|---|
| Authenticated local ingestion | `server/workRecordsApi.mjs` checks one bearer token before parsing POST bodies; `server/workRecords.mjs` compares tokens with `timingSafeEqual`. | This authenticates possession of one local secret, not a human, service principal, tenant membership, role, or delegated authority. |
| Loopback-only prototype boundary | `server/index.mjs` permits only loopback binding; the API rejects non-loopback Host headers; `scripts/ingest-current-kanban-event.mjs` refuses non-loopback, credential-bearing, query-bearing, fragment-bearing, HTTPS, or alternate-path endpoints. | This is local attack-surface reduction, not hosted network or tenant isolation. |
| Durable local persistence | `WorkRecordStore` uses SQLite, owner-only file mode, WAL, strict schema version 1, duplicate-event rejection, and survives reopen. | The store is one local database with no `tenant_id`, row policy, migration path, backup contract, or hosted durability evidence. `node:sqlite` is experimental in the candidate runtime. |
| Closed, privacy-reducing event contract | Version `1.0` accepts exact keys, opaque event IDs, hashed work references, two allowlisted profile IDs, six event kinds, four statuses, canonical timestamps, valid chronology, and five closed summaries. Unknown fields and unsafe summaries fail closed. | It intentionally cannot represent owner, assignee, tenant, authorization, block reason, evidence, sensitivity, source lineage beyond one source type, decisions, or outcomes. |
| Idempotency by event ID | Duplicate event IDs return `409` without replacing the first durable row. | No source sequence, optimistic concurrency, correction event, or cross-source deduplication contract exists. |
| Bounded local read projection | GET returns at most 50 validated events, count, newest timestamps, generated time, and `recent`, `stale`, or `empty`; invalid persisted content fails closed. | GET is unauthenticated on loopback and returns the single shared store. It is not a tenant-isolated private read model. |
| Explicit freshness and failure semantics | Server and client validate chronology and freshness; UI represents recent, stale, empty, offline, source-error, and invalid-record states. | `recent` and `stale` describe source observation age, not the roadmap’s complete live/recent/historical record semantics. |
| World and accessible Records interface integration | The STG Headquarters Records Terminal loads the local projection only on open or refresh, preserves the existing public repository record, uses `textContent`, and exposes live-region status. | It is one local interface. No authenticated private session, tenant context, record detail, evidence traversal, authorization-aware alternative view, or Pi target-device verification is provided by this candidate. |
| Automated local verification | On the inspected tree after `npm ci`, `npm run test` passed 62/62 tests and `npm run build` completed. Candidate-focused tests are `tests/work-records-server.test.mjs`, `tests/work-records-api.test.mjs`, and `tests/work-records-ui.test.mjs`. | Local tests and build are candidate evidence, not deployment or public behavioral evidence. The build reports an existing chunk-size warning. |
| No private task-body publication in the accepted contract | Exact-key validation, closed summaries, hashed work references, client revalidation, and fail-closed persisted-row validation prevent the accepted event shape from carrying task bodies, prompts, logs, paths, emails, or arbitrary evidence links. | This does not prove that a future expanded schema is safe. The canonical expanded record must remain private unless a separate projection is explicitly approved. |

### 2.2 What remains for Milestone 3

The following roadmap requirements remain unproven:

1. authenticated tenant identity and tenant membership;
2. backend-enforced action authorization distinct from authentication;
3. tenant-scoped writes, reads, search, count, export, evidence, history, and realtime/subscription paths;
4. a transport-neutral work-record schema containing tenant, owner, assignee, state, block reason, evidence, source, sensitivity, and complete timestamps;
5. durable authorization records and append-only material audit history;
6. explicit live, recent, and historical semantics that do not confuse lifecycle state with freshness;
7. truthful rename, archive, delete, reassignment, and source-loss continuity;
8. a complete trace from direction through authorization, assignment, activity, evidence, and outcome;
9. authorization-aware private Records interfaces and a meaning-equivalent non-spatial view;
10. direct-ID and alternative-route cross-tenant attack resistance at the backend;
11. approved hosted persistence, identity, credential rotation, backup, restore, migration, deployment, and rollback evidence;
12. target-device and production behavioral verification required by the roadmap’s cross-cutting gates.

## 3. Transport-neutral private schema contract

This is a logical contract, not a SQL, HTTP, Supabase, or provider selection. Opaque IDs are stable identifiers; display names are mutable labels. All timestamps are canonical UTC instants. Unknown enum values fail closed until a reviewed contract version supports them.

### 3.1 `TenantIdentity`

| Field | Contract |
|---|---|
| `tenantId` | Immutable opaque tenant identifier. Never derived from a display name or client-controlled route label. |
| `displayName` | Current human-readable name. A rename never changes `tenantId`. |
| `lifecycle` | `active`, `archived`, or `deleted_tombstone`. |
| `createdAt`, `updatedAt`, `archivedAt`, `deletedAt` | UTC timestamps; nullable lifecycle timestamps are set only when applicable. |

Tenant membership, role, permission, and authority grants belong to an authorization model, not to the display object and not to a client assertion.

### 3.2 `WorkRecord`

| Field | Contract |
|---|---|
| `schemaVersion` | Explicit version of this logical contract. |
| `recordId` | Immutable opaque identifier unique within the durable system. |
| `tenantId` | Immutable owning tenant. A record cannot be moved between tenants; a legitimate transfer creates a new tenant-owned record plus a cross-reference authorized under a future approved policy. |
| `recordType` | Closed vocabulary such as assignment, decision, work item, blocker, or outcome. Initial implementation must authorize only types required by its vertical slice. |
| `title` | Private tenant data by default; bounded and rendered only as data. |
| `ownerSubjectId` | Stable accountable human, agent, team, or service identity reference. Ownership is not the same as assignment or authorization. |
| `assigneeSubjectIds` | Ordered, deduplicated stable subject references. Empty is valid when work is unassigned. |
| `state` | Closed lifecycle vocabulary: `proposed`, `authorized`, `ready`, `active`, `blocked`, `review`, `completed`, `archived`, or `deleted_tombstone`. State changes require valid transitions and material audit events. |
| `blockReason` | Nullable structured object with `category`, private bounded `summary`, `resolutionAuthoritySubjectId` when known, and `blockedAt`. It must be present only for `blocked`; clearing it creates an audit event rather than erasing the prior reason. |
| `evidenceLinks` | Ordered references to `EvidenceLink`; evidence is not copied into a public projection by default. |
| `source` | Structured `SourceReference`: source system identity, stable source record reference, source event/reference when available, source occurrence time, observation time, and source contract version. Raw credentials and unbounded source payloads are prohibited. |
| `sensitivity` | Closed policy label: `tenant_private`, `tenant_restricted`, or `public_approved`. Default is `tenant_private`. `public_approved` is necessary but not sufficient for publication. |
| `createdAt`, `updatedAt` | Durable system timestamps. `updatedAt` changes only with accepted material or explicitly defined non-material updates. |
| `stateChangedAt`, `completedAt`, `archivedAt`, `deletedAt` | Nullable lifecycle timestamps constrained by state and chronology. |
| `sourceOccurredAt`, `sourceObservedAt` | Preserve event time separately from ingestion/recording time. |
| `revision` | Monotonic concurrency token. Writes with a stale expected revision fail rather than overwrite concurrent truth. |
| `supersedesRecordId` | Optional same-tenant link used for explicit corrections or replacements; it never mutates the superseded record’s history. |

### 3.3 `EvidenceLink`

| Field | Contract |
|---|---|
| `evidenceId` | Immutable opaque ID. |
| `tenantId` | Must equal the owning record’s tenant. Cross-tenant evidence resolution is denied unless a later explicit collaboration policy exists. |
| `relation` | Closed relation such as `supports`, `result`, `review`, `decision`, or `source`. |
| `locator` | Internal object reference or allowlisted external URI. Resolution is always authorized again; possession of a URL is not authorization. |
| `label` | Bounded private display label. |
| `sensitivity` | Same closed policy labels; effective sensitivity is the stricter of record and evidence policy. |
| `integrity` | Optional immutable digest and algorithm when the source can provide stable bytes. A digest proves byte identity, not truthfulness. |
| `sourceOccurredAt`, `observedAt`, `createdAt` | Separate source, observation, and durable creation times. |
| `availability` | `available`, `stale`, `unavailable`, `withdrawn`, or `deleted_tombstone`; loss does not remove the historical fact that it was cited. |

### 3.4 `MaterialAuditEvent`

Material audit history is append-only and server-authored.

| Field | Contract |
|---|---|
| `auditEventId` | Immutable, idempotent event ID. |
| `tenantId`, `recordId` | Mandatory scope; both must match the affected record. |
| `eventKind` | Closed kind: creation, authorization, assignment, reassignment, state transition, block, unblock, evidence attach/detach, sensitivity change, rename, archive, delete/tombstone, correction, or outcome acceptance. |
| `actorSubjectId` | Authenticated subject responsible for the request, or an identified service principal for automated source ingestion. |
| `onBehalfOfSubjectId` | Optional accountable delegator; it never replaces the actual actor. |
| `authorizationRef` | Stable reference to the policy/grant/approval used for the action, including policy revision. |
| `occurredAt`, `recordedAt` | Source action time and durable append time. Backdating does not alter append order. |
| `priorRevision`, `newRevision` | Exact concurrency boundary. |
| `changedFields` | Field names and policy-safe before/after values or digests. Secrets, credentials, raw private source payloads, and executable content are prohibited. |
| `reasonRef` | Optional stable direction, decision, or approval reference explaining why the change was authorized. |
| `source` | Structured source identity and event reference. |

Failed authorization attempts are recorded in a separate security audit stream with principal, tenant context when safely known, route class, action, timestamp, and denial reason code. That stream must not leak whether a hidden record exists.

### 3.5 Invariants and time semantics

- The canonical record is private unless a separate projection proves otherwise.
- `tenantId`, `recordId`, audit IDs, and subject IDs are immutable.
- Every material mutation and accepted state transition appends one audit event in the same transaction.
- Lifecycle state and freshness are separate. `active` can be stale; `completed` can be recent.
- **Live** means backed by an active source/session whose contract defines a current health window. It is never inferred from animation or mere network reachability.
- **Recent** means the newest validated source observation falls within a versioned, displayed threshold.
- **Historical** means the record is retained as past truth, including completed, archived, superseded, or tombstoned records. Historical does not mean invalid.
- **Stale**, **degraded**, and **unavailable** remain explicit source-quality states. Stale data is not silently relabeled live.
- Timestamps obey `sourceOccurredAt <= sourceObservedAt <= recordedAt`; corrections append later events rather than changing prior timestamps.
- Sensitivity can be raised by an authorized action. Lowering it requires explicit publication authority and an audit event; ordinary writers cannot downgrade sensitivity.
- Block reasons, evidence, and audit history inherit the strictest applicable sensitivity.

## 4. Backend tenant isolation and authorization

### 4.1 Decision procedure

Every private operation, regardless of transport or route, must pass the same server-side procedure:

1. Authenticate the principal using a server-validated session or service identity.
2. Resolve active tenant memberships and grants from trusted backend state. Ignore tenant, role, or owner claims supplied only by the client.
3. Derive the requested tenant from the authenticated context and authorized selection. A route tenant ID is an object to verify, never proof of access.
4. Authorize the action (`create`, `read`, `list`, `search`, `update`, `transition`, `attach_evidence`, `read_history`, `archive`, `delete`, or `project_public`) against tenant membership, role, explicit authority, record sensitivity, and current policy revision.
5. Query with tenant scope and object ID together. A lookup by globally unique record ID followed by an application-only tenant check is insufficient.
6. Re-authorize referenced owner, assignee, evidence, parent, source, and superseded records under the same tenant before committing.
7. Apply write plus material audit append atomically with an expected revision.
8. Return a non-enumerating denial (`404` for hidden objects or one consistently approved generic response) and no object-derived metadata.

Database-enforced row policies or equivalent storage constraints are defense in depth and are required for a hosted implementation. They do not replace application authorization, because actions such as state transition, sensitivity downgrade, and publication require finer policy.

### 4.2 Required attack cases

The first hosted/private boundary cannot be accepted until automated tests prove all cases below fail at the backend:

| Attack | Required result |
|---|---|
| Principal changes `/tenants/{authorized}/records/{id}` to another tenant ID. | Generic denial; no record fields, timing-dependent existence signal, cache entry, or audit detail returned. |
| Principal keeps an authorized tenant route but substitutes a direct record ID from another tenant. | Tenant-scoped lookup returns no accessible object. |
| Principal requests `/records/{id}` without a tenant path. | Shared policy derives tenant scope from trusted context and denies the foreign object. |
| Principal supplies a foreign `tenantId` in create/update JSON, GraphQL variables, RPC arguments, form data, headers, or query parameters. | Server ignores or rejects the claim; no cross-tenant row or audit event is written. |
| Principal reaches the same object through search, list filters, count, sort, pagination cursor, recent-items, dashboard summary, export, batch, evidence, history, source, or superseded-record routes. | Every route returns only authorized tenant rows; aggregate counts and cursors reveal nothing about foreign rows. |
| Principal follows or guesses a foreign evidence locator or audit event ID. | Evidence and history are independently authorized; signed URLs are tenant/principal scoped, short-lived, and issued only after authorization. |
| Principal subscribes to a foreign tenant channel or changes a realtime topic after connection. | Server authorizes subscription and each emitted row; no foreign event is delivered. |
| A background job, ingestion service, or support tool omits tenant scope. | Fail closed. Service credentials are least-privilege and tenant/purpose scoped; no global default tenant exists. |
| A cached response produced for one tenant is requested by another. | Private cache key includes tenant, principal/policy scope, sensitivity, and policy revision; shared public caching is disabled. |
| A record changes sensitivity or tenant membership is revoked during a session. | Subsequent reads and subscriptions re-evaluate policy; cached authorization cannot outlive the defined short policy window. |
| A principal can read a record but lacks transition, assignment, archive, deletion, or publication authority. | Read succeeds only for allowed fields; forbidden mutation fails and appends no material record event. |
| Two writers update the same revision. | One succeeds; the stale write fails with no lost update and no misleading audit event. |

Host-header checks, hidden buttons, door locks, route guards, client filtering, opaque IDs, and hashed references are not tenant isolation. They may supplement but never satisfy this gate.

## 5. Historical continuity

1. **Rename:** Update only the current display label. Append a rename audit event containing the prior and new bounded labels. Historical events retain the label snapshot that was true when recorded plus the stable ID.
2. **Reassignment or ownership change:** Append a material event; never rewrite earlier owner or assignee snapshots. The trace shows who was accountable at each revision.
3. **Archive:** Make the object non-active and read-only except for explicitly authorized restore or retention actions. Archive time, actor, authority, source, and reason remain inspectable. Archive is not deletion.
4. **Delete:** Prefer a tombstone. Remove the object from active views while preserving immutable ID, tenant scope, object type, deletion time, actor/authority reference, prior revision digest, and non-sensitive relationship facts required for truthful history.
5. **Sensitive-content purge:** If an approved retention or erasure policy requires payload removal, append a purge event and retain only the minimum permitted tombstone and integrity metadata. Never claim the purged content remains inspectable.
6. **No destructive cascades:** Deleting a tenant, subject, source, parent, or evidence object must not silently erase work/audit history. References resolve to a labeled tombstone or explicit unavailable state.
7. **Source rename or disappearance:** Keep the stable source reference and last validated observation as historical/stale. Mark current availability unavailable or withdrawn; do not rewrite the old record as though the source never existed.
8. **Correction:** Append a correction/supersession event linked to the prior record. Never edit prior audit events to make the earlier claim disappear.
9. **Tenant rename/archive:** Stable tenant IDs remain in all records. Archived or deleted tenants cannot authenticate or create work, but authorized retention review can still reconstruct permitted history.
10. **Restore:** Restore is a new audited transition. It does not erase the archive or deletion interval.

Retention length, legal erasure rules, and emergency preservation are human policy decisions listed in Section 9; this packet does not invent them.

## 6. Required traceability chain

The trace is a typed, authorized chain, not a single mutable status row:

```text
Direction
  -> Authorization
  -> Assignment
  -> Activity
  -> Evidence
  -> Outcome
```

| Link | Minimum durable proof | Failure rule |
|---|---|---|
| Direction | Stable direction/decision reference, accountable directing subject, tenant, source, occurrence time, sensitivity. | No direction content is made public merely because a work item exists. |
| Authorization | Authorized action/scope, grant or approval reference, authorizer, beneficiary, constraints, policy revision, effective time. | Skill, assignment, access, or successful execution never substitutes for authority. |
| Assignment | Work record, owner, assignee(s), accepted revision, assignment event, source, time. | An assignee outside the tenant or without required access is rejected. |
| Activity | Append-only, bounded activity events tied to the record and actor/service source. | Animation, presence, or generic “working” copy is not proof of activity. |
| Evidence | Authorized evidence references, relation, source time, observation time, sensitivity, availability, and integrity metadata when available. | A dead or withdrawn link remains labeled; inaccessible evidence is not called inspectable. |
| Outcome | Explicit outcome record, completion/acceptance actor, acceptance authority, evidence set, state transition, and time. | `completed` without required evidence or outcome acceptance fails the transition. |

Acceptance requires an authorized user to traverse this chain in the private non-spatial interface and the Records world interface without gaining access to a link they could not open directly. Missing links remain visibly `unavailable`, `not recorded`, or `not authorized`; the UI must not infer them.

## 7. Private canonical model and public projection boundary

### 7.1 Private by default

The canonical work record, title, owner, assignee, block reason, direction, authorization, activity, evidence, outcome, tenant membership, and material audit history are private tenant data by default. STG records remain private STG records. The public Vibe City site is not an implicit publication channel.

A private read requires authenticated principal, active tenant context, backend authorization, tenant-scoped query, and sensitivity-aware field projection. World objects and the non-spatial equivalent consume the same authorized read model.

### 7.2 Separate public projection

Public output, if later approved, is a separately versioned, allowlisted projection generated server-side from explicitly eligible records. Publication requires all of:

1. record sensitivity `public_approved`;
2. explicit publication authority and audited approval;
3. a projection schema that enumerates every output field;
4. privacy review of source, labels, timestamps, evidence destinations, correlation risk, and revocation behavior;
5. revalidation at projection time; and
6. independent tests proving private fields cannot enter output through nested data, errors, aggregates, caches, or alternate routes.

The projection must not emit private task text, block reasons, owner/assignee identities, tenant membership, authorization grants, audit history, internal evidence URLs, raw source IDs, filesystem paths, prompts, logs, tool arguments, credentials, or private repository/customer data. A public evidence URL must itself be intentionally public and independently validated.

The candidate’s loopback GET is a small closed public-safe projection, but it is not authorization to expose expanded records or STG data on the public site.

### 7.3 Explicit non-goals

- No publication of private STG Kanban or work records.
- No customer tenant, neighboring-office visibility, or cross-company collaboration implementation.
- No hosted-agent identity, movement, or authority implementation from Milestone 4.
- No provider selection, account provisioning, key handling, production database, migration, or deployment in this packet.
- No arbitrary task-body ingestion or generic webhook pass-through.
- No financial, customer, agent-capacity, service-health, or staffing claims.
- No replacement of the existing public repository record.
- No loss of offline entry, STG Headquarters naming, keyboard/touch accessibility, readable non-spatial meaning, or Pi-class meaning parity.

## 8. Test-first, dependency-ordered release slices

Every slice is a vertical RED -> GREEN -> REFACTOR cycle, separately reviewed and independently reversible. Tests must be observed failing for the intended missing behavior before implementation. Test fixtures use generated opaque IDs and synthetic content only inside isolated test storage; they are never product tenants, records, evidence, customers, or public data.

### Slice 1 — Tenant-scoped domain and authorization kernel (recommended next)

**Scope:** Add the transport-neutral schema types, validation, state transitions, policy inputs/decisions, and in-memory contract tests behind no UI, route, provider, or production activation. Keep the current v1.0 local prototype unchanged.

**RED cases:** missing tenant/owner/source/sensitivity/timestamps; client-asserted tenant authority; foreign owner/assignee/evidence references; invalid block-state pairing; sensitivity downgrade without publication authority; stale revision; invalid state transition; material change without audit event; lifecycle/freshness conflation.

**Exact acceptance evidence:** focused test command and full `npm run test`; `npm run build`; a test-name transcript showing each RED failure before implementation and GREEN pass after; `git diff --name-status` proving no route, deployment, credential, migration, public projection, or Milestone 4 file changed.

**Rollback:** remove the isolated module/tests or disable their unused export. No persistent data or runtime behavior changes.

### Slice 2 — Private tenant-scoped repository and backend route

**Dependency:** Slice 1 accepted; a trusted test identity adapter is defined. Production provider credentials are not required for local contract work.

**Scope:** One authenticated private create/read/list vertical path with tenant-scoped storage, defense-in-depth row policy or equivalent, optimistic concurrency, and atomic audit append. No world UI and no public projection.

**RED cases:** all direct-ID and alternative-route attacks in Section 4.2; list/count/search leakage; create/update body tenant substitution; unauthenticated request; revoked membership; read-only principal mutation; cross-tenant evidence reference; cache cross-contamination; failed write leaving an audit event; successful write missing an audit event.

**Exact acceptance evidence:** route-policy matrix with response status and zero leaked fields; storage-policy tests run under least-privilege application credentials; transaction test proving record and audit append succeed or fail together; clean fresh-database setup/teardown; restart persistence test; full tests/build; diff proving no public route or provider activation.

**Rollback:** disable the private route and application credential, then revert the additive schema only after backup/restore verification confirms no accepted record would be discarded. No destructive automatic down migration.

### Slice 3 — Historical continuity and material audit read

**Dependency:** Slice 2 accepted.

**Scope:** Rename, reassignment, block/unblock, archive, tombstone delete, correction/supersession, restore, and authorized history traversal.

**RED cases:** rename changes stable ID or historical snapshot; archive erases records; delete cascades to audit/evidence; removed subject breaks history; source loss deletes citations; restore erases archive interval; unauthorized history route; cross-tenant audit ID; correction mutates prior event.

**Exact acceptance evidence:** before/after serialized history from isolated test storage; immutable audit append order and revision assertions; tombstone and source-unavailable tests; tenant attack matrix repeated for history/evidence routes; full tests/build; backup/restore rehearsal for the additive schema.

**Rollback:** disable mutation commands while preserving readable existing history. Never roll back by deleting accepted audit events.

### Slice 4 — Direction-to-outcome trace and evidence resolution

**Dependency:** Slice 3 accepted; evidence source classes required for the slice are approved.

**Scope:** One private trace spanning direction, authorization, assignment, activity, evidence, and outcome, including authorized evidence resolution and explicit missing/unavailable states.

**RED cases:** assignment lacks authorization; activity lacks actor/source; completion lacks required outcome/evidence; evidence tenant mismatch; evidence URL bypasses authorization; inaccessible link appears inspectable; missing link is inferred; user can traverse to a link they cannot open directly.

**Exact acceptance evidence:** machine-readable trace fixture created only in isolated tests; policy decision for every traversed edge; unavailable/withdrawn evidence behavior; no raw credentials or source payloads in logs/snapshots; full tests/build.

**Rollback:** disable trace assembly while retaining canonical records and audit history. No source record is rewritten.

### Slice 5 — Private Records interfaces with meaning parity

**Dependency:** Slice 4 accepted and authenticated private session integration approved.

**Scope:** Present the same authorized private read model in the STG Headquarters Records world object and a keyboard/touch-complete non-spatial view. Preserve current public repository and local-prototype behavior until separately retired.

**RED cases:** UI fetches before authenticated open; hidden control is the only access check; unauthorized fields reach client payload; world and non-spatial views disagree; focus is not restored; 200% zoom loses essential controls; touch or keyboard cannot traverse the trace; stale/unavailable/historical states depend only on color; lower-capability mode removes meaning.

**Exact acceptance evidence:** backend authorization tests remain GREEN; browser evidence for keyboard, touch/mobile, focus, reduced motion, 200% zoom, readable contrast, and forced stale/unavailable states; Pi-class target check for meaning and essential controls; offline entry test; production bundle budgets; full tests/build.

**Rollback:** feature flag returns the Records interface to the prior accepted candidate without changing canonical data.

### Slice 6 — Hosted activation and production verification

**Dependency:** Slices 1–5 accepted; human gates in Section 9 resolved; independent security/privacy review complete.

**Scope:** Provision approved identity/storage, rotate and scope credentials, rehearse migration/restore, deploy one private tenant boundary, and verify behavior. This slice does not authorize public work-record publication.

**RED cases:** missing/expired credential, revoked member, wrong tenant, partial provider outage, stale cache, failed migration, failed restore, rollback, alternate route, realtime subscription, and log/error leakage.

**Exact acceptance evidence:** exact source commit/tree and deployment identifier; redacted provider-policy configuration; migration checksum and dry-run; backup and successful restore; credential rotation/revocation proof without secret values; production direct-ID/alternative-route test report using authorized security fixtures; desktop/mobile/Pi behavior; rollback to prior deployment; independent review sign-off.

**Rollback:** restore the prior application deployment and compatible database state without deleting accepted audit history. Provider credentials created for the failed release are revoked.

A public projection is not automatically Slice 7. It remains absent unless Devon explicitly approves a publication policy and a new independently reviewable release contract.

## 9. Genuine human decisions and gates

These are real approval or activation boundaries. They do not block Slice 1’s local, provider-neutral contract work.

| Decision or gate | Needed before | Why a human is required |
|---|---|---|
| Canonical tenant identity and membership authority, including human, service, and support identities | Hosted private route/activation | Identity trust and organizational authority cannot be inferred from the local token prototype. |
| Policy for STG administrative/support access, emergency intervention, and disclosure | Any privileged cross-role access | The Design Bible leaves these governance questions open; broad operator access must not be invented. |
| Retention, erasure, legal hold, and tombstone minimums for work, evidence, security audit, and tenant deletion | Persistent hosted records and deletion | These are legal/business/privacy decisions, not implementation defaults. |
| Approved state, block-reason, sensitivity, and publication-authority vocabularies | Schema stabilization and any user-visible release | The contract affects accountability and privacy. Engineering may propose but not silently decide policy. |
| Hosted identity, database/storage, secret-management, backup, and deployment providers | Slice 6 | Provisioning creates credentials, cost, security obligations, and operational commitments. |
| Credential issuance, least-privilege grants, rotation owner, and revocation procedure | Any hosted activation | No agent may create or expose production credentials without authorization. |
| Migration window, backup/restore acceptance, production deployment, and rollback authorization | Slice 6 | These actions affect durable/production state and require explicit release authority. |
| Public exposure of any work-record projection, including private STG records | Any public projection | The roadmap explicitly defers this. Default remains no publication. |
| Neighbor visibility, visitors, external collaboration, and cross-company record policy | Any cross-tenant collaboration | The roadmap and Design Bible deliberately leave these product/governance decisions unresolved. |

Not genuine current blockers: customer pricing, Credits, hosted-agent provider selection, Milestone 4 roles/movement, marketplace policy, or hardware purchases. They are outside this gap-closure lane and must not be pulled forward.

## 10. Next single implementation slice

**Recommendation:** After the current candidate PR releases, implement only **Slice 1 — Tenant-scoped domain and authorization kernel**.

This is the smallest dependency-correct step because tenant identity, immutable tenant scope, action authorization, state invariants, sensitivity, revision control, and atomic material-audit requirements must be testable before a hosted route, database migration, UI, provider, or public projection can safely exist. It is independently reversible, requires no credentials or deployment decision, preserves the current local prototype, and produces the contract that Slice 2’s backend tenant-isolation tests can enforce.

Do not start with the Records UI, hosted database, public publication, or Milestone 4 agent state. Each would place presentation or infrastructure ahead of the missing authority boundary.

## 11. Release checklist for this packet

- [x] Candidate commit and tree identified exactly.
- [x] Current source, local prototype documentation, tests, roadmap, master design, and companion documents inspected.
- [x] Candidate proof separated from remaining Milestone 3 work.
- [x] Transport-neutral schema, authorization, continuity, traceability, privacy boundary, slices, RED cases, acceptance evidence, and human gates specified.
- [x] STG Headquarters naming, offline entry, privacy, accessibility, and Pi meaning parity preserved as acceptance constraints.
- [x] No implementation, provider, credential, migration, deployment, public exposure, Pi change, or Milestone 4 work included.
