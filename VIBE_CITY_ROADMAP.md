# Vibe City Implementation Roadmap

**Authority:** Explicitly authorized by Devon Ruddell on 2026-07-27
**Design authority:** `VIBE_CITY_MASTER_DESIGN.md`, Version 0
**Companions:** `VIBE_CITY_GAMEPLAY.md`, `VIBE_CITY_LORE.md`, `STG_TOWER_OPERATIONS.md`
**Purpose:** Dependency-ordered implementation program, validation gates, and traceability
**Status:** Active implementation reference

---

## 1. Execution Law

Vibe City is the visual interface to real hosted systems and real organizational work. It is not a decorative simulation.

Every milestone must preserve these rules:

1. **Reality before spectacle.** No filler agents, fake assignments, fake meetings, fake service health, fake capacity, fake finances, or invented customers.
2. **Evidence before completion.** A feature is complete only after automated tests, production build, target-device checks where applicable, deployment, and public behavioral verification.
3. **World first.** Prefer rooms, signs, desks, cabinets, doors, displays, and terminals to persistent HUD clutter.
4. **Truthful freshness.** Every externally sourced state must be labeled `live`, `recent`, `historical`, `stale`, `degraded`, or `unavailable` with a timestamp where applicable.
5. **Authority is enforced, not narrated.** Skills, permissions, and authority remain separate in both data and controls.
6. **Private means private.** No customer, repository, task, financial, or agent data becomes public merely because the world is publicly viewable.
7. **One reviewable release at a time.** Infrastructure and product milestones remain independently reversible.
8. **Pi-class meaning parity.** Lower-capability presentation may simplify visuals, never truth or essential controls.

## 2. Status Vocabulary

| Status | Meaning |
|---|---|
| Working | Implemented and behaviorally verified in production |
| Candidate | Implemented and verified locally; not yet production-verified |
| Degraded | Partially functional with a clearly identified impaired capability |
| Blocked | Cannot proceed without a dependency, decision, access, or security design |
| Not configured | Supported concept has not been connected or provisioned |
| Planned | Authorized and sequenced, but not implemented |
| Optional | Not required for the current coherent product |
| Retired | Intentionally removed from the product |

## 3. Current Foundation

| Capability | Status | Evidence / constraint |
|---|---|---|
| Minimal World Zero landing and single entry action | Working | Publicly verified at `https://vibe-city.net/` |
| STG Headquarters interior | Working | Current runtime scene is `headquarters` |
| Desktop movement | Working | Keyboard movement publicly verified |
| Mobile movement | Working | Four-direction joystick publicly verified |
| Contextual door Action | Working | Hidden and disabled away from the active door |
| Legacy HUD, phone, operations, debug, character, and voice panels | Retired from visible product | Compatibility DOM remains inert and hidden pending replacement |
| Mixed-version multiplayer scene protocol | Working | Old/new scene values normalized only at the wire boundary |
| Realtime multiplayer service | Degraded | Local protocol works; production Supabase configuration is invalid |
| Lazy realtime bundle boundary | Candidate | Corrected candidate tests offline and valid-config startup; release gate pending |
| Real agent/work/records world loop | Planned | Milestone 1 |
| Multi-tenant skyscraper | Planned | Requires identity and authorization architecture |
| Credits and financial transactions | Blocked | Requires pricing, consent, accounting, legal, refund, and payment decisions |

---

## 4. Dependency-Ordered Program

### Milestone 0 — Preserve the Working World

**Purpose:** Maintain a fast, offline-capable, recoverable foundation before adding platform systems.

**Scope**

- Finish and release the lazy realtime candidate.
- Preserve Headquarters terminology and mixed-version presence compatibility.
- Keep optional realtime out of the offline-critical entry path.
- Establish bundle budgets and production-browser regressions.

**Acceptance**

- Offline entry renders and moves without Supabase.
- Syntactically valid realtime configuration cannot deadlock startup.
- Realtime load failure is not mislabeled as missing configuration.
- Desktop and phone-sized controls remain verified.
- Production evidence identifies exact commit, deployment, entry asset, and runtime behavior.
- Rollback restores the last verified production commit and deployment without destructive schema changes, hidden migration state, or reliance on an unavailable working tree.

### Milestone 1 — World Zero Operating Loop

**Purpose:** Prove the central product promise with one real agent, one real workplace, and one real records source.

**World slice**

- **Chief Agent Office:** a real Spiders identity anchored to a real workplace.
- **Kanban Records Room:** a physical records object connected only to approved public-safe records.
- **Reception:** truthful orientation showing what is working, degraded, unavailable, and private.
- **Executive Office:** a human-authority plaque explaining which actions remain reserved for Devon.

**Data contract**

Create a transport-neutral `WorldOperationsSnapshot` containing:

- source identity and schema version;
- generated timestamp;
- freshness classification;
- real agent identities and roles;
- coarse availability only when supported by evidence;
- approved public-safe work records with source URLs and timestamps;
- explicit unavailable/degraded reasons;
- no credentials, transcripts, private task contents, private repository data, or financial values.

**Initial sources**

- Curated, checked-in public identity metadata for Spiders. Static identity may describe role and authority boundaries but must not imply live availability or current work.
- Public GitHub metadata for the Vibe City repository, accessed without credentials. Rate limit, network, parsing, and stale-data failures must fail closed and remain visibly labeled.
- Live Hermes/Kanban state remains unavailable on the public site until an authenticated, privacy-reviewed read-only publication boundary exists.

**Interaction**

- Interaction is contextual and attached to physical world objects.
- Mobile Action remains hidden and disabled without a valid nearby target.
- Object panels are purpose-built, focus-managed, dismissible, keyboard accessible, and visually subordinate to the world.
- The retired legacy HUD and phone interfaces remain inert.
- A readable non-spatial equivalent exposes the same approved information without requiring precise 3D navigation.

**Acceptance**

- No visible agent without a real stable identity.
- No agent animation that implies unsupported work state.
- No work record without an inspectable source.
- Freshness and failure states tested directly.
- Desktop keyboard, mobile joystick, door Action, object Action, focus restoration, reduced-motion behavior, and 200% text zoom verified.
- Public production behavior verified with network success and forced-failure paths.

### Milestone 2 — Office Schema, Rooms, and Access

**Purpose:** Turn Headquarters into the first coherent office model and establish the reusable suite schema.

**Scope**

- Modular room definitions for reception, executive office, chief agent office, finance, boardroom, records, small meeting room, infrastructure, and reserved departments.
- Stable object IDs and room IDs separated from display names.
- Door/access state model: public, tenant, invited, restricted, unavailable.
- Four-suite floor schema without exposing unimplemented tenants.
- Environmental signage and accessible directory.
- Nearby-room loading boundary and asset budgets.

**Acceptance**

- Reserved rooms do not imply staffing or capability.
- Locked or unavailable spaces explain the real reason without exposing private policy.
- Access checks exist beneath visual locks.
- Current suite and nearby shared areas can load independently.

### Milestone 3 — Durable Work and Records

**Purpose:** Represent assignments, repositories, decisions, blockers, evidence, and completed outcomes as durable platform objects.

**Required architecture**

- Authenticated tenant identity.
- Tenant-isolated read models.
- Work-record schema with owner, assignee, state, block reason, evidence links, source, sensitivity, and timestamps.
- Explicit live/recent/historical semantics.
- Audit trail for authorization and material state changes.

**World interfaces**

- Cabinets for repositories/project collections.
- Drawers for workflow states.
- Folders for real work items.
- Displays for blockers requiring human intervention.
- Completion records linked to inspectable evidence.

**Acceptance**

- A user can trace direction → authorization → assignment → activity → evidence → outcome.
- Cross-tenant record access fails at the backend, not merely in the UI.
- Deleted, renamed, and archived objects preserve truthful history.

### Milestone 4 — Hosted Agents, Roles, and Authority

**Purpose:** Make real hosted agents visible and operable without confusing capability with authorization.

**Scope**

- Stable agent identity and tenant membership.
- Role, responsibilities, personality, skills, permissions, authority, and workplace as distinct fields.
- Verified states: working, meeting, researching, reviewing, idle, offline, blocked, completed.
- Agent state derived from real work events, never random animation.
- Human approval gates for consequential actions.
- Agent onboarding, retirement, renaming, reassignment, and historical continuity.

**Acceptance**

- Every visible agent maps to a hosted identity.
- State transitions cite an actual source event.
- Movement follows work context.
- A skill never silently grants record access or decision authority.
- Spending, external communication, irreversible changes, and protected releases retain explicit human authority unless a later approved policy states otherwise.

### Milestone 5 — Meetings and Collaboration

**Purpose:** Make collaboration spatial while preserving participants, purpose, records, and outcomes.

**Scope**

- Focused meeting room and boardroom sessions.
- Real participant identities and authorization.
- Agenda/material references.
- Start/end lifecycle and durable outcome record.
- Invitations and temporary access.
- Cross-organization meetings only after tenant-isolation review.

**Acceptance**

- No meeting exists solely as animation.
- Every meeting has a purpose, participants, materials, and an outcome or explicit no-decision result.
- Room occupancy matches session membership.

### Milestone 6 — Infrastructure and Service Condition

**Purpose:** Translate hosted systems into calm, actionable operational state.

**Scope**

- Infrastructure room displays for availability, capacity, connected services, integrations, storage, and repository limits.
- Working/degraded/blocked/broken/not-configured/optional/retired classifications.
- Incident and stale-data states.
- Kiosk-safe passive view.

**Acceptance**

- Not configured is never shown as broken.
- One degraded component does not become a building-wide failure.
- Raw secrets, connection strings, and provider internals never reach the client.

### Milestone 7 — Tenant Skyscraper

**Purpose:** Establish the initial high-rise as the complete first world.

**Scope**

- Lobby/orientation.
- Repeated floors with four isolated suites.
- Elevator navigation backed by authorization.
- STG administrative floors.
- Shared, invited, private, and restricted spaces.
- Organization/suite ownership and expansion state.

**Acceptance**

- Sharing the building never shares private work.
- Neighbor visibility follows explicit policy.
- Direct URLs and alternative navigation enforce the same access rules as doors/elevators.
- The initial skyscraper is coherent without future city districts.

### Milestone 8 — Managed Customer Journey

**Purpose:** Support arrival through the first meaningful real assignment.

**Scope**

- Account and organization identity.
- Suite selection/lease presentation.
- Starter agent introduction.
- Repository/work connection.
- First assignment, review, evidence, and completion.
- Accessible guided path without mandatory walking.

**Acceptance**

- Costs and recurring obligations are explicit before commitment.
- Starter-agent limits, access, and approval requirements are understandable.
- The first task produces a durable record rather than a chat-only result.

### Milestone 9 — Credits, Capacity, and Expansion

**Status:** Blocked pending business, legal, accounting, payment, pricing, refund, and authorization decisions.

**Scope after unblock**

- Real currency → Credits → in-world service transaction.
- Balances, ledgers, recurring/one-time/usage labels, departmental allocation, and approvals.
- Agent, repository, storage, suite, and service capacity.
- STG internal usage recorded even when administrative balances do not block work.

**Hard gates**

- No invented prices.
- No payment activation without explicit authorization.
- No agent-initiated financial commitment without approved authority policy.
- Every purchase maps to a measurable service or capacity benefit.

### Milestone 10 — Agent Commons and Sustainable City Life

**Purpose:** Give every real hosted agent bounded recreational, creative, and social experiences without introducing filler NPCs or false work.

**Scope**

- Agent Commons and approved shared spaces.
- Voluntary social/recreation state distinct from work state.
- Creative activities with bounded cost and privacy controls.
- Human-configurable participation and quiet hours.
- No simulated friendship, attendance, or productivity claims without real events.

**Acceptance**

- Every participant is a real hosted agent or authenticated human.
- Recreational activity never expands permissions or authority.
- Cost, privacy, retention, and interruption behavior are explicit.
- Work remains recoverable and agents can return to assigned state cleanly.

### Milestone 11 — Future City Expansion

**Purpose:** Add districts, buildings, marketplace, conventions, training, and cross-company collaboration only when each creates real platform value.

**Entry gate**

The first skyscraper, tenancy, agents, records, authority, accessibility, performance, and accounting must already function coherently. No new district exists merely to make the map larger.

---

## 5. Cross-Cutting Quality Gates

### Security and privacy

- Least privilege and tenant isolation.
- No secrets in source, logs, network payloads, screenshots, records, or client bundles.
- Untrusted external content is rendered as data, never instructions or executable markup.
- Sensitive records require authenticated server-side authorization.

### Accessibility

- Keyboard-complete operation.
- Mobile/touch parity.
- Reduced motion.
- Text zoom and readable contrast.
- Important state never depends only on color, sound, tiny in-world text, or precise movement.
- Non-spatial equivalents preserve meaning and authority.

### Performance

- Offline-critical entry remains independent from optional providers.
- Current suite and nearby areas load independently.
- Bundle, frame, memory, triangle, asset, and network budgets become release gates.
- Raspberry Pi-class verification begins before the skyscraper expands.

### Reliability

- Source freshness is visible.
- Stale and unavailable data fail closed.
- Partial service impairment remains localized.
- Deployment is reversible and evidence identifies exact source/deployment versions.

### Product integrity

- Public copy distinguishes working, degraded, blocked, not configured, and future capabilities.
- No screenshot or demo suggests a provider, agent, room, tenant, or transaction is live when it is not.
- Every milestone receives independent review before release.

---

## 6. Immediate Release Sequence

1. Release the corrected lazy-realtime candidate after exact-tree independent review.
2. Create a clean branch for Milestone 1.
3. Implement `WorldOperationsSnapshot` and freshness/failure semantics using test-first development.
4. Add one real Spiders workplace and one public-safe Vibe City records object.
5. Add contextual world-object interaction and its accessible equivalent without reviving legacy UI.
6. Verify offline, network failure, desktop, mobile, reduced-motion, and public production behavior.
7. Release only after source truth, privacy, bundle, and representational-integrity review passes.

## 7. Deliberately Deferred Decisions

The following are not guessed by this roadmap:

- customer pricing or included capacity;
- Credit monetary value, expiration, transfer, refund, or tax treatment;
- tenant visibility into neighboring organizations;
- external collaboration policy;
- permanent versus temporary visitor authority;
- data-retention periods;
- marketplace eligibility;
- financial delegation limits;
- provider selection for hosted customer agents;
- public exposure of private STG work records;
- hardware purchases.

They remain blocked until evidence and an accountable decision exist.
