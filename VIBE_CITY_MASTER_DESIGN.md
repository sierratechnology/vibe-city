# Vibe City Master Design

**Document type:** Long-term product vision and design reference  
**Design Bible version:** Version 0  
**Status:** Planning only  
**Scope:** Product concept, world model, user experience, and business-design principles  
**Out of scope:** Code, technical architecture, implementation tasks, and delivery estimates

---

## Table of Contents

1. [Purpose of This Document](#1-purpose-of-this-document)
2. [Product Vision](#2-product-vision)
3. [Core Design Philosophy](#3-core-design-philosophy)
4. [The Skyscraper as the Initial World](#4-the-skyscraper-as-the-initial-world)
5. [Tenancy and Organizational Growth](#5-tenancy-and-organizational-growth)
6. [Sierra Technology Group Headquarters](#6-sierra-technology-group-headquarters)
7. [Standard Office Suite](#7-standard-office-suite)
8. [AI Agents as the Workforce](#8-ai-agents-as-the-workforce)
9. [Work, Collaboration, and Records](#9-work-collaboration-and-records)
10. [Permissions, Skills, and Authority](#10-permissions-skills-and-authority)
11. [Economy and Platform Accounting](#11-economy-and-platform-accounting)
12. [Managed Hosting Philosophy](#12-managed-hosting-philosophy)
13. [Customer Journey](#13-customer-journey)
14. [Interface and Interaction Philosophy](#14-interface-and-interaction-philosophy)
15. [Performance and Accessibility Philosophy](#15-performance-and-accessibility-philosophy)
16. [Design Rationale](#16-design-rationale)
17. [Future Expansion](#17-future-expansion)
18. [Future Considerations](#18-future-considerations)
19. [Unanswered Product Questions](#19-unanswered-product-questions)
20. [Matters Reserved for Later Engineering Decisions](#20-matters-reserved-for-later-engineering-decisions)
21. [Vision Guardrails](#21-vision-guardrails)
22. [Closing Vision](#22-closing-vision)
23. [Design Bible Governance and Current Decisions](#23-design-bible-governance-and-current-decisions)

---

## 1. Purpose of This Document

This document defines the long-term product and experience vision for **Vibe City**. It is intended to become a shared reference for future product planning, UI/UX design, engineering, operations, and business planning.

Vibe City is a virtual world that serves as the visual interface for a hosted, multi-agent AI platform. It combines qualities of:

- a management game;
- a virtual office;
- an operating system;
- a hosting control panel; and
- an AI workforce simulator.

The world is not a separate game placed on top of the platform. It is the platform made visible. Rooms, people, furniture, access boundaries, expansions, and activity should communicate the state of real hosted services and real organizational work.

This document deliberately avoids prescribing how the product will be implemented. Its purpose is to establish what Vibe City should mean, how it should feel, and which principles future decisions should preserve.

---

## 2. Product Vision

Vibe City gives a person or organization a headquarters for its AI workforce.

A customer should be able to enter a virtual office, meet hosted AI employees, assign and review meaningful work, organize repositories and records, hold meetings, observe operational state, and expand the organization without needing to understand the infrastructure beneath it.

The central promise is:

> Complex AI infrastructure should feel as understandable as walking through a well-run office.

The product should make abstract systems spatial and legible:

- hosted agents become employees with visible roles and workplaces;
- customer workspaces become office suites;
- repositories and task records become filing and records systems;
- collaboration becomes meetings and shared rooms;
- platform services become utility and infrastructure spaces;
- capacity upgrades become improvements to offices and facilities;
- organizational growth becomes expansion through the building.

The result should feel neither like a conventional dashboard wearing a game skin nor like a simulation disconnected from real outcomes. Vibe City should feel like a living headquarters whose activity is grounded in actual work.

---

## 3. Core Design Philosophy

### 3.1 Everything Visible Should Mean Something

The foundational Vibe City design principle is:

> Every visible object in Vibe City should correspond to a real platform object, system, resource, state, or permission whenever practical.

This principle is called **representational integrity**. It should guide future feature decisions, interaction design, world-building, and product review. When a proposed object is interactive, informative, purchasable, restricted, or otherwise meaningful, its purpose should normally map to something real in the underlying platform.

Decorative objects are allowed when they improve atmosphere, identity, orientation, architectural credibility, or comfort. Decoration must not imply nonexistent work, staffing, access, capacity, or platform capability.

Examples include:

| Visible element | Real meaning |
|---|---|
| High-rise building | Hosted platform or infrastructure cluster |
| Floor | Shared hosting level or organizational expansion area |
| Office suite | Isolated tenant workspace or Hermes environment |
| Office lease | Hosting tier |
| NPC | Real AI agent |
| Desk or workstation | Agent slot or active agent assignment |
| Filing cabinet | Repository, project collection, or records system |
| Drawer | Workflow status or category |
| Folder | Task, ticket, or work item |
| Boardroom | Multi-agent collaboration or planning session |
| Small meeting room | Limited agent collaboration session |
| Finance office | Billing, usage, budgeting, and financial operations |
| Utility or server room | Infrastructure, integrations, and system health |
| Elevator | Navigation and access permissions |
| Door lock or badge | Authorization and tenant isolation |
| Office expansion | Increased server capacity |
| Additional office suite | Additional workspace capacity |
| Entire floor ownership | Larger organizational or hosting tier |
| Credits | In-world representation of platform billing |
| Dark workstation or locked office | Offline, suspended, or unavailable service |
| Room signage or digital plaque | Tenant, department, agent, or service identity |

### 3.2 Avoid Decorative Simulation

Vibe City may be atmospheric, attractive, and expressive, but it should avoid systems that imply activity or capability that does not exist.

There should be no filler workforce presented as productive agents. A character walking through an office should be connected to a real identity and state. A meeting should represent actual collaboration. A storage upgrade should correspond to actual value available to the customer.

Purely aesthetic details may exist where they improve warmth, identity, orientation, or comfort, but they must not mislead the customer about platform state. Decoration should support the metaphor, not counterfeit functionality.

### 3.3 The Metaphor Must Clarify, Not Obscure

A physical metaphor is valuable only when it makes the platform easier to understand. Customers should not be forced to perform tedious simulated actions merely because an office would require them in real life.

Vibe City should preserve the familiarity of rooms, people, objects, and places while removing unnecessary friction. The office is an interface to capability, not a realism test.

### 3.4 Real Work Drives the World

The world should react to genuine events:

- assignments becoming active;
- agents entering or leaving collaboration;
- reviews awaiting attention;
- blocked work requiring intervention;
- repositories receiving new records;
- departments gaining staff;
- services changing state;
- customers expanding capacity; and
- work reaching completion.

The virtual environment becomes valuable when it gives customers a coherent, human-readable view of these events.

---

## 4. The Skyscraper as the Initial World

### 4.1 Initial Setting

The initial Vibe City world should center on a **single skyscraper** representing the hosted platform. This is the first complete spatial model of the product and the foundation from which a larger city may eventually grow.

The skyscraper contains:

- customer office floors;
- four office suites per standard customer floor;
- dedicated Sierra Technology Group administrative floors;
- shared circulation and access-controlled transitions; and
- room for future operational, social, and platform spaces.

A conceptual vertical organization might be understood as:

```text
                     VIBE CITY — INITIAL BUILDING

                  ┌──────────────────────────────┐
                  │ Future / Reserved Expansion  │
                  ├──────────────────────────────┤
                  │ STG Administrative Floors    │
                  │ Operations, Finance, Support │
                  ├──────────────────────────────┤
                  │ Customer Floor               │
                  │ Suite A │ B │ C │ D          │
                  ├──────────────────────────────┤
                  │ Customer Floor               │
                  │ Suite A │ B │ C │ D          │
                  ├──────────────────────────────┤
                  │ Customer Floor               │
                  │ Suite A │ B │ C │ D          │
                  ├──────────────────────────────┤
                  │ Lobby / Arrival / Orientation│
                  └──────────────────────────────┘
```

This diagram is conceptual rather than a final architectural layout.

### 4.2 Four Suites per Floor

Each standard floor contains four office suites. Each suite is one isolated customer workspace.

A customer may occupy:

- one suite;
- multiple suites on one or more floors;
- an entire floor; or
- eventually multiple floors.

The four-suite model creates a stable unit for visual organization and commercial growth. It makes a single customer's starting space understandable while allowing expansion to remain visible and meaningful.

### 4.3 Benefits of the Skyscraper Model

**Clear tenancy.** A suite is a familiar boundary. It communicates ownership, privacy, and responsibility without requiring the customer to understand technical tenancy concepts.

**Visible isolation.** Separate suites and controlled doors make access boundaries intuitive. Customers can understand that neighboring organizations share a platform without sharing private workspaces.

**Understandable growth.** Moving from one office to multiple suites or a complete floor gives organizational growth a physical form.

**Consistent orientation.** A repeated floor structure helps customers learn where functions are located and reduces interface complexity.

**Commercial clarity.** Capacity, expansion, and premium space can be represented in units customers understand.

**Community without forced exposure.** Organizations may coexist in one world while maintaining private offices and controlled collaboration.

**A bounded first world.** One building gives the initial product a coherent identity and manageable mental model without limiting the long-term city vision.

### 4.4 Building as Platform Health

The building should convey the condition of the hosted platform in calm, understandable ways. Lighting, room availability, operations displays, access states, and staff activity can reveal real conditions. The building should not turn every warning into spectacle; it should make important states apparent without creating panic or visual noise.

---

## 5. Tenancy and Organizational Growth

### 5.1 The Customer Office

Each customer receives an office representing their hosted AI workspace. The office is the customer's headquarters inside Vibe City and the primary place from which they manage their AI organization.

An initial customer experience may include:

- one starter office suite;
- one starter AI agent;
- basic repository and records capacity;
- task management;
- essential meeting and review functions; and
- pathways to expand the office, workforce, departments, and hosted capacity.

These are product concepts rather than a final package definition.

### 5.2 The Workspace Boundary

A customer office should make isolation clear through physical ownership and controlled entry. The suite contains the organization's agents, work records, operating displays, and facilities. Access by other customers, visitors, or STG personnel should reflect real authorization rather than proximity in the world.

The model must preserve a crucial distinction:

> Sharing a building does not mean sharing private work.

### 5.3 Physical Growth of an Organization

Growth inside Vibe City should correspond to genuine increases in the customer's organization or service capacity.

A typical progression could be:

```text
Starter Suite
    │
    ├── Additional agent desks
    ├── Improved records and infrastructure capacity
    ├── New department offices
    └── Expanded meeting facilities
             │
             ▼
Multiple Suites
             │
             ├── Specialized teams
             ├── Separate projects or business units
             └── Larger shared facilities
             │
             ▼
Entire Floor
             │
             └── Unified organizational headquarters
             │
             ▼
Multiple Floors / Future Buildings
```

Expansion should be meaningful rather than cosmetic. A new office may represent a new department, isolated business unit, additional workforce, increased workload, or another real organizational need.

### 5.4 Ownership at Different Scales

**One suite** suits an individual, small business, focused project, or early-stage AI team.

**Multiple suites** allow separation among departments, projects, brands, or operational units.

**An entire floor** establishes a larger headquarters with stronger identity and room for coordinated departments.

**Multiple floors** represent substantial organizations, multiple business units, or advanced hosted operations.

Future products may allow customers to control how these spaces are named and arranged while preserving the truth of what each space represents.

---

## 6. Sierra Technology Group Headquarters

### 6.1 STG Within the Same World

Sierra Technology Group occupies dedicated administrative floors within the same skyscraper. STG is both the platform operator and an organization using the platform for its own work.

Locating STG in the building reinforces that Vibe City is an operated world rather than an abstract service. Customers can understand that there is a real platform organization responsible for the environment, while access restrictions preserve operational and commercial boundaries.

### 6.2 STG Administrative Functions

Dedicated STG floors may represent:

- platform operations;
- infrastructure;
- finance;
- engineering;
- project management;
- customer support; and
- future departments.

These spaces should reflect real STG functions and real authorized agents. Departments should not appear merely to make the company look larger.

### 6.3 Access Boundaries

Customers do not automatically have access to STG administrative floors. Access should correspond to actual permissions, support interactions, invited meetings, approved tours, or other legitimate purposes.

Restricted access is not only a security metaphor. It also communicates organizational boundaries: a customer may use and trust the platform without being able to enter internal operations, finance, or engineering spaces.

### 6.4 STG as a Participant in the System

STG should participate in the same broad office, workforce, resource, and accounting models as customers. This supports consistency and allows the platform operator to experience the product it provides.

Administrative privileges may remove practical credit limits or expose operational capabilities, but the world should still record and represent STG resource use. This prevents the operator's environment from becoming an unexplained exception to the system.

---

## 7. Standard Office Suite

### 7.1 Suite Design Goal

The standard suite should feel like a compact headquarters capable of supporting leadership, agent coordination, records, collaboration, and hosted operations. The layout should be recognizable across customers while allowing identity and growth over time.

A conceptual layout is shown below:

```text
┌─────────────────────────────────────────────────────────────┐
│ Owner / Executive │ Chief Agent │ Finance │ Future Dept.   │
│ Office            │ Office      │ Office  │ Offices        │
├───────────────────┴──────────────┬─────────┴────────────────┤
│ Large Board Room                 │ Kanban Records Room      │
├───────────────────────────────┬──┴──────────────────────────┤
│ Reception                     │ Small Meeting Room          │
│                               ├─────────────────────────────┤
│ Main Entry                    │ Utility / Infrastructure    │
└───────────────────────────────┴─────────────────────────────┘
```

The exact floor plan remains a later design decision. The essential requirement is that each major room have a clear product purpose.

### 7.2 Reception

Reception is the arrival, orientation, and controlled-entry point for the suite.

It may communicate:

- the organization and office identity;
- who is currently available;
- expected visitors or invited collaborators;
- high-level office status;
- where a user should go next; and
- whether access beyond reception is authorized.

Reception should make a new office feel inhabited and understandable without relying on a dense dashboard.

### 7.3 Owner / Executive Office

The Owner or Executive Office represents the human decision-maker's place in the organization.

Its purpose is to support:

- strategic review;
- approval and authority decisions;
- high-level priorities;
- sensitive or private discussions;
- organizational configuration; and
- executive summaries.

This room should reinforce that AI agents operate within delegated authority and that consequential decisions remain connected to an accountable owner.

### 7.4 Chief Agent Office

The Chief Agent Office belongs to the customer's lead coordinating agent.

Its purpose is to represent:

- oversight of the AI workforce;
- coordination among agents and departments;
- assignment and status awareness;
- escalation of blockers;
- synthesis of reports; and
- translation of owner direction into organized work.

The Chief Agent should be visible as a coordinator rather than an all-powerful substitute for human authority.

### 7.5 Finance Office

The Finance Office represents financial records, budgets, credit use, service costs, and purchasing controls.

Its purpose is to make financial state understandable while protecting sensitive information and preserving approval boundaries. It may be the natural place to review platform Credits, resource consumption, planned expansion costs, and financial approvals.

A Finance Office does not imply that every customer automatically receives an autonomous finance agent. The room represents the function; access and staffing depend on the actual organization.

### 7.6 Large Board Room

The Large Board Room is the primary space for important multi-party collaboration.

It may support:

- strategic meetings;
- project reviews;
- cross-department planning;
- formal presentations;
- consequential approvals;
- invited customer or STG collaboration; and
- durable meeting outcomes.

Its displays should present real documents, records, assignments, or summaries associated with the meeting.

### 7.7 Kanban Records Room

The Kanban Records Room represents durable work management and project records.

Its purpose is to provide a spatial home for:

- active and completed work;
- assignments and ownership;
- priorities and dependencies;
- blockers;
- evidence and comments;
- repositories and project documents; and
- historical decisions and outcomes.

Filing cabinets, shelves, boards, terminals, or records desks may form the interface, but the contents must correspond to real records. The room should help users trace work from request to result.

### 7.8 Future Department Offices

Future Department Offices provide reserved organizational space without pretending that departments already exist.

Possible uses include sales, marketing, legal coordination, research, production, human resources, customer service, or specialized project teams. A department office should become active only when the customer has created a real organizational function, assigned real agents, or connected relevant work.

### 7.9 Small Meeting Room

The Small Meeting Room supports focused collaboration that does not require the scale or formality of the board room.

It may be used for:

- one-on-one discussions;
- short agent reviews;
- problem-solving sessions;
- owner approvals;
- private customer support interactions; and
- limited cross-company meetings.

Its smaller scale should make quick collaboration feel distinct from formal organization-wide meetings.

### 7.10 Utility / Infrastructure Room

The Utility or Infrastructure Room represents the hosted systems supporting the office.

It may communicate the state or capacity of:

- agent hosting;
- storage;
- connected services;
- integrations;
- repository capacity;
- availability and service condition; and
- office-level infrastructure improvements.

Most customers should not need to operate raw infrastructure from this room. It should translate platform condition into understandable controls and status, not expose complexity merely because it exists.

---

## 8. AI Agents as the Workforce

### 8.1 No Filler NPCs

Every NPC in Vibe City is a real hosted AI agent. There are no filler employees whose presence falsely suggests work, capacity, or staffing.

Each visible agent should have a real identity connected to:

- a role;
- permissions;
- responsibilities;
- a personality;
- current or available work assignments;
- an office or departmental home; and
- a desk or other appropriate workplace.

If ambient life is desired, it should emerge from real users, real agents, shared spaces, environmental motion, and truthful world activity rather than invented workers.

### 8.2 Roles and Responsibilities

An agent's role describes its organizational purpose. Responsibilities describe what outcomes it is expected to support. These should be visible and understandable to the customer.

Examples might include executive coordination, project management, research, finance support, customer support, engineering assistance, records administration, or specialist work. The role should influence where the agent works, whom it collaborates with, what it reports, and which tasks it may accept.

### 8.3 Personality as Product Identity

Agents may have distinct personalities so that customers can understand and form working relationships with them. Personality should affect communication style, presence, and interpersonal character without overriding role boundaries, truthfulness, permissions, or professional standards.

Personality should make the workforce memorable, not unpredictable.

### 8.4 Offices and Desks

An agent's workplace gives its role and current context a physical anchor. A desk may show relevant assignments, current records, or availability. Private offices may reflect leadership, confidentiality, or specialized responsibility rather than arbitrary status.

Agents should use spaces consistent with their real work. A finance agent reviewing a budget may be in the Finance Office. A project manager coordinating a review may be in the Kanban Records Room or a meeting room. A chief agent may move between its office, board room, and departments as real coordination requires.

### 8.5 Work States

Agent behavior and animation should reflect actual state rather than random motion.

| State | Meaning in the hosted platform | Possible world expression |
|---|---|---|
| **Working** | Actively performing an assigned activity | At a desk, terminal, records area, or relevant room |
| **Meeting** | Participating in a real collaboration context | Present in an appropriate meeting room |
| **Researching** | Gathering and evaluating information | At research materials, a workstation, or records area |
| **Reviewing** | Examining work, evidence, or a decision | At a desk, display, board room, or records room |
| **Idle** | Available but not currently assigned or active | Calmly present at an appropriate workplace or shared area |
| **Offline** | Agent is unavailable or not hosted at the moment | Absent, clearly marked unavailable, or represented by an inactive workspace |
| **Blocked** | Work cannot continue without information, access, dependency, or decision | Visible blocked indicator at the relevant workspace without excessive alarm |
| **Completed** | A meaningful assigned unit of work has finished | Returns results, updates records, or reports completion before becoming available |

### 8.6 Behavior Must Follow Work

Movement should be a consequence of work context. Agents should not endlessly wander to create the appearance of life. When an agent enters a meeting room, there should be a real meeting or collaboration state. When an agent interacts with records, it should be connected to real work involving those records.

Some work may not have a literal physical equivalent. In those cases, Vibe City should choose a consistent spatial expression that helps the customer understand the activity without making false claims about its internal process.

### 8.7 Blockers and Completion

Blocked and completed states deserve special care because they drive human action.

A blocked agent should make clear:

- what work is blocked;
- why it cannot proceed;
- who or what can resolve it; and
- whether a decision, permission, dependency, or external event is required.

A completed agent should present a result with evidence or a durable record. Completion should not be communicated solely through celebratory animation; the user must be able to inspect what was accomplished.

---

## 9. Work, Collaboration, and Records

### 9.1 Work Assignments

Assignments are real units of work associated with accountable owners, agents, records, and outcomes. Vibe City should make assignment state visible through the places where work occurs.

The world should help a customer answer:

- What is being worked on?
- Who owns it?
- Where is collaboration happening?
- What is blocked?
- What requires my decision?
- What was completed, and where is the evidence?

### 9.2 Meetings

Meetings should represent real coordination, not scripted gatherings. A meeting may involve human users, agents, invited STG staff, or authorized participants from another customer organization.

A useful meeting should have a purpose, relevant materials, participants, and an outcome. The room can make these elements natural: the display holds the agenda or project state, seats communicate participants, and the room record preserves decisions or actions.

### 9.3 Repositories and Durable Knowledge

Repositories, Kanban, project documentation, decisions, and evidence should have stable representations in the office. Customers should be able to find important records through spatial memory without losing the precision expected from professional work-management systems.

The physical metaphor should not flatten distinct record types into one ambiguous object. Filing cabinets, boards, shelves, displays, and rooms may share a visual language while still making ownership, recency, sensitivity, and record type clear.

### 9.4 From Decision to Outcome

Vibe City should preserve a visible thread:

```text
Owner direction
      ↓
Authorized assignment
      ↓
Agent or team activity
      ↓
Review, meeting, or escalation
      ↓
Evidence and durable record
      ↓
Completion or next decision
```

This thread is central to trust. The user should not have to infer whether an agent merely appeared busy or actually produced a result.

---

## 10. Permissions, Skills, and Authority

Vibe City should clearly distinguish **skills**, **permissions**, and **authority**. These concepts are related but not interchangeable.

### 10.1 Skills

Skills describe what an agent understands how to do. Multiple agents may share access to the same body of procedural knowledge or capability.

A skill does not itself grant access to records, accounts, systems, or organizational decisions.

### 10.2 Permissions

Permissions determine what an agent may access or operate.

Permissions may govern:

- entry to offices or rooms;
- access to repositories and records;
- use of tools or connected services;
- visibility into customer or STG information;
- ability to change particular resources; and
- participation in restricted meetings.

Two agents with the same skills may have very different permissions.

### 10.3 Authority

Authority determines which decisions or commitments an agent is empowered to make on behalf of a person or organization.

Authority may determine whether an agent can:

- assign work;
- approve an outcome;
- authorize spending;
- invite external participants;
- change organizational policy;
- expand a workspace; or
- make a consequential commitment.

An agent may have the skill and permission to prepare an action while lacking authority to approve it.

### 10.4 Relationship Among the Three

```text
Skill:       “I know how to perform this kind of work.”
Permission:  “I am allowed to access the resources involved.”
Authority:   “I am empowered to make or approve this decision.”
```

The product should never imply that broad knowledge equals broad access or executive power. Doors, room access, object visibility, assignment controls, and approval interactions should make these distinctions understandable.

---

## 11. Economy and Platform Accounting

### 11.1 Three-Layer Economy

Vibe City's economy has three layers:

```text
Real Currency
      ↓
Platform Credits
      ↓
In-World Spending
```

Customers purchase Platform Credits with real currency. They then spend Credits inside Vibe City on hosted services and organizational expansion.

The in-world transaction is a clear, spatial expression of a real platform purchase. It should not disguise the cost or nature of the service.

### 11.2 Examples of In-World Spending

Credits may be used for concepts such as:

- office leases;
- hiring or hosting additional agents;
- repository expansion;
- storage;
- office upgrades;
- department expansion;
- additional meeting facilities;
- infrastructure improvements; and
- other managed platform capabilities.

The final definition, pricing, duration, and legal treatment of these items remain matters for later business and product decisions.

### 11.3 Meaningful Purchases

A purchase should correspond to a real benefit. An office upgrade should increase or unlock actual capability, capacity, service quality, organization, or control. The economy should not pressure customers to buy meaningless decoration to make the product usable.

Customization may be offered, but it should remain clearly distinguishable from operational capacity.

### 11.4 Transparent Accounting

Customers should be able to understand:

- their Credit balance;
- what consumed Credits;
- whether a cost is one-time, recurring, or usage-based;
- what capability a purchase provides;
- which account or department bears the cost; and
- which purchases require human approval.

The office metaphor must not obscure real financial consequences.

### 11.5 STG Accounting

Sierra Technology Group participates in the same accounting model so that platform resource use remains visible and internally coherent. Administrative accounts may effectively have unlimited Credits, but transactions and consumption should still be represented for accountability and platform understanding.

“Unlimited” should mean that administrative work is not blocked by a customer-style balance. It should not mean that STG resource use becomes invisible or unmeasured.

---

## 12. Managed Hosting Philosophy

### 12.1 Customers Buy Outcomes and Managed Capability

Vibe City customers are purchasing **managed AI infrastructure**, not merely raw API access.

Most customers should never need to manage:

- API keys;
- command-line tools;
- infrastructure setup;
- server maintenance; or
- the routine technical work required to keep hosted AI capabilities available.

Instead, they receive a managed AI workforce and workspace through Vibe City.

### 12.2 The Office as the Control Surface

Customers should manage the platform through concepts such as employees, roles, offices, records, meetings, capacity, and budgets. These concepts are closer to how organizations already think about work.

The technical substrate remains important, but Vibe City translates it into an operational experience. Customers should be able to run useful AI-supported organizations without becoming infrastructure operators.

### 12.3 Advanced Users Without Two Products

Some customers may eventually need more visibility or control. Advanced capabilities should still feel like deeper access to the same managed platform rather than abandonment of the Vibe City model.

The product should avoid creating a split where nontechnical customers receive a simplified fiction while advanced users receive the only truthful interface. Both experiences should describe the same underlying reality at different levels of detail.

### 12.4 Service Responsibility

The managed-hosting model places responsibility on STG to make service condition, capacity, constraints, and failures understandable. The world should communicate what the customer needs to know without requiring them to diagnose servers or platform internals.

---

## 13. Customer Journey

### 13.1 Arrival

A new customer creates an account and enters Vibe City. The first experience should establish the building as a real place, explain the relationship between the office and hosted services, and make ownership clear.

### 13.2 Leasing an Office

The customer leases an office suite. This action establishes their isolated workspace and gives the organization a physical headquarters inside the building.

The lease should communicate what is included, what is private, what can expand, and what recurring obligations or Credits are involved.

### 13.3 Meeting the First AI Employee

The customer meets their first hosted AI employee. This moment should communicate:

- who the agent is;
- what role it serves;
- what it can and cannot do;
- what access it currently has;
- when it needs approval; and
- how the customer begins working with it.

The first agent should feel like the beginning of an organization, not a generic chatbot placed in a room.

### 13.4 Organizing Work

The customer begins creating or connecting real work. Repositories, task management, records, assignments, and meetings become visible through office objects and rooms.

The early experience should teach the world through purposeful use rather than overwhelming instruction. The customer learns that the records room contains durable work, the meeting room supports collaboration, and the executive office concentrates decisions.

### 13.5 Expanding the Organization

As needs grow, the customer may:

- add agents;
- create departments;
- increase repository or storage capacity;
- improve infrastructure;
- add meeting facilities;
- lease adjacent suites;
- occupy an entire floor; or
- eventually expand across multiple floors or buildings.

Growth should make the customer's headquarters feel increasingly personal and capable while remaining grounded in real resources and work.

### 13.6 The Desired Emotional Experience

The customer's office should feel like **their company headquarters**: owned, purposeful, trustworthy, active, and capable of growth.

The experience should encourage pride and attachment without manipulating the customer into confusing virtual status with business success. The most satisfying changes should come from real organizational progress.

---

## 14. Interface and Interaction Philosophy

### 14.1 Redesign Toward a Minimal HUD

The long-term interface direction is a redesign around:

- minimal HUD;
- minimal overlays;
- physical interaction; and
- information displayed naturally through office objects.

The world itself should carry much of the interface.

### 14.2 Information Through the Environment

Examples include:

- desk monitors for active assignments and agent context;
- conference displays for meetings, plans, and reviews;
- filing cabinets for repositories and durable records;
- room signage for identity, access, and purpose;
- operations screens for service and infrastructure state;
- office doors for tenancy and permissions; and
- occupied desks or offices for real workforce presence.

These objects should behave consistently so users learn a visual language that transfers throughout the building.

### 14.3 Avoid HUD Clutter

Vibe City should avoid covering the screen with meters, icons, task markers, currencies, alerts, minimaps, and status panels merely because management games often use them.

Persistent HUD elements should be reserved for information that is genuinely necessary across contexts. Most detailed information should appear where it belongs in the world or be available through deliberate interaction.

### 14.4 Physical Does Not Mean Slow

A physical interface should not force the user to walk across the building for every routine action. The experience may support efficient movement, direct navigation, summaries, notifications, and accessible shortcuts while preserving spatial meaning.

The design goal is **world-first interaction**, not mandatory inconvenience.

### 14.5 Clarity and Accessibility

Natural presentation must remain readable and accessible. Important information cannot depend solely on color, tiny in-world text, precise movement, sound, or spatial memory. Alternative views and interaction methods may be needed so that the physical metaphor remains inclusive.

A minimal HUD must not become a minimal-information product.

### 14.6 Calm Operational Presence

The interface should feel composed and professional. Alerts should distinguish routine activity from matters requiring attention. Blockers, financial consequences, access restrictions, and service problems must be clear, but the environment should not become a constant field of flashing warnings.

---

## 15. Performance and Accessibility Philosophy

### 15.1 Efficient Spatial Loading

Vibe City should scale by loading and presenting only nearby or currently relevant areas. A customer should not bear the full performance cost of an entire skyscraper or future city when occupying one suite.

This principle applies conceptually to:

- floors and rooms;
- occupants and activity;
- visual detail;
- records and displays; and
- shared or public spaces.

The exact method is reserved for later engineering design.

### 15.2 Hardware Range

The product should support a range of hardware experiences:

- lightweight kiosk-style displays, including Raspberry Pi-class devices;
- ordinary desktop and laptop hardware; and
- higher-capability desktop systems able to present richer visual detail.

The core product meaning and essential controls should remain available across that range. More powerful hardware may improve visual quality, scale, or immersion, but it should not receive a fundamentally more truthful product.

### 15.3 Kiosk Experience

A kiosk display could make an office or operations area persistently visible, turning Vibe City into an ambient organizational interface. This use case strengthens the need for readable distance views, calm status communication, and efficient rendering.

Kiosk use should not assume constant keyboard-and-mouse interaction. The product should eventually consider how passive viewing, quick attention, and secure interaction coexist.

### 15.4 Graceful Degradation

Lower-capability modes should reduce visual complexity before sacrificing operational clarity. A simpler office with accurate state is more valuable than a visually rich world that obscures or delays important information.

---

## 16. Design Rationale

### 16.1 Why a Building?

A building provides universal concepts: ownership, rooms, doors, departments, floors, visitors, meetings, records, and expansion. These concepts can make multi-tenant AI hosting easier to understand than a collection of unrelated control panels.

### 16.2 Why a Skyscraper?

A skyscraper supports density, hierarchy, repeated structure, clear tenancy, and visible growth. It gives the initial world a strong identity while preserving an obvious path toward additional buildings and districts.

### 16.3 Why Four Suites per Floor?

Four suites balance individual ownership with shared structure. The floor remains easy to understand, and expansion from suite to neighboring suite or entire floor becomes visible. It also creates a repeatable planning unit without making every organization identical.

### 16.4 Why Real Agents Only?

Filler NPCs would weaken trust. If every agent is real, seeing an agent has operational meaning. The world becomes a readable interface rather than a theatrical layer.

### 16.5 Why Physical Records?

Repositories, Kanban, and decisions are abstract but central to professional work. Giving them stable places and objects supports orientation, memory, and accountability. Physical representation also creates opportunities for natural collaboration around shared information.

### 16.6 Why Credits?

Credits provide a consistent in-world accounting language across office leases, workforce capacity, storage, and improvements. They allow commercial transactions to fit the world without pretending that hosted resources are free.

The system must still clearly connect Credits to real-money value and real services.

### 16.7 Why Minimal HUD?

A dense HUD would compete with the core premise that the office itself is the interface. Environmental presentation strengthens immersion and helps the user associate information with organizational context.

The decision is not anti-dashboard; it is a preference for placing information where it has meaning.

### 16.8 Why Managed Hosting?

Most customers want useful AI capability, dependable service, understandable controls, and business outcomes. Requiring infrastructure expertise would exclude many of the people who could benefit most. Managed hosting lets Vibe City present sophisticated capability through an organizational model customers can operate.

---

## 17. Future Expansion

The single skyscraper is the initial world, not the final limit. Future expansion may include the following concepts without committing to a particular implementation or sequence.

### 17.1 Multiple Skyscrapers

Additional buildings could represent platform scale, different service classes, large customer headquarters, regional presence, or specialized communities.

### 17.2 Business Districts

Districts could organize related industries, services, organizations, or platform functions while making the city feel larger than one building.

### 17.3 Shared Public Spaces

Lobbies, plazas, cafés, parks, and common areas could support authorized social presence, discovery, community, and informal collaboration. Public does not have to mean unrestricted; privacy and identity remain essential.

### 17.4 Training Facilities

Training spaces could represent agent onboarding, skill development, practice environments, customer education, and capability evaluation.

### 17.5 Convention Centers

Convention facilities could host demonstrations, conferences, organization-wide presentations, product events, and large authorized gatherings.

### 17.6 Marketplace

A marketplace could make approved agents, skills, integrations, services, office capabilities, and customization discoverable. Marketplace participation would require strong quality, trust, pricing, and permission standards.

### 17.7 Customer Collaboration

Customers could choose to collaborate through shared projects, invited workspaces, controlled records, or joint facilities without weakening tenant isolation.

### 17.8 Cross-Company Meetings

Authorized cross-company meetings could occur in neutral or hosted meeting spaces with explicit participant, record, and access boundaries.

### 17.9 Advanced Office Customization

Customers may eventually customize layout, identity, furnishings, signage, department arrangement, and display preferences. Customization should preserve navigability, accessibility, and the truthful relationship between objects and platform capabilities.

### 17.10 A Living City

Over time, Vibe City may become a broader visual economy of organizations, services, workplaces, and collaboration. Growth should proceed only where the city remains a trustworthy interface to real systems.

---

## 18. Future Considerations

The following considerations should shape later product and business design without predetermining implementation.

### 18.1 Privacy in Shared Spaces

The product will need clear expectations for what others can see about an organization, its agents, office occupancy, meeting activity, and public identity.

### 18.2 Identity and Presence

Human users, AI agents, STG personnel, visitors, and service identities must remain distinguishable. The world should make it difficult to mistake an automated agent for a human participant.

### 18.3 Customization Versus Consistency

Customers should be able to make an office feel like their own, but shared interaction patterns must remain understandable across the building.

### 18.4 Operational Truth Versus Abstraction

The world should abstract complexity without misrepresenting it. Product language must be honest about limits, failures, uncertainty, and work that requires human review.

### 18.5 Notifications and Attention

A world-first interface needs a disciplined model for urgent alerts, routine updates, approvals, background activity, and information that can wait until the customer visits a room.

### 18.6 Time and Persistence

The product must decide how the world communicates ongoing work when the customer is absent, how past activity is reviewed, and how users understand whether a state is live, recent, or historical.

### 18.7 Organization Changes

Real organizations rename departments, change ownership, remove agents, archive projects, and restructure. The world should support change without erasing history or creating misleading abandoned spaces.

### 18.8 Trust and Evidence

Agent work should remain inspectable. The experience should balance simplicity with access to sources, evidence, approvals, and durable results.

### 18.9 Financial Safeguards

Credit purchase and spending will require clear consent, limits, auditability, refund or dispute policies, and controls that prevent agents from making unauthorized financial commitments.

### 18.10 Safety and Governance

The product should eventually define how prohibited work, abuse, compromised access, agent malfunction, customer disputes, and platform intervention are represented and handled.

---

## 19. Unanswered Product Questions

These questions require future product, design, business, policy, or customer-research decisions. They are intentionally left unanswered here.

### World and Tenancy

1. How are suites assigned within the building, and can customers choose location?
2. When does a customer expand an existing suite versus lease another suite?
3. Can one organization divide suites among subsidiaries, brands, or projects?
4. What aspects of neighboring offices are visible from shared areas?
5. How should archived or inactive offices appear?
6. What shared building spaces belong in the initial customer experience?

### Agents and Work

7. What is included with the starter agent, and how is its initial role chosen?
8. Can customers rename agents or alter personality, and which identity elements must remain stable?
9. How should agent limitations and uncertainty be communicated in-world?
10. What constitutes a meeting rather than ordinary background collaboration?
11. How long should completed state remain visible before an agent returns to idle or new work?
12. How should one agent working across multiple offices or departments be represented?

### Access and Governance

13. Which roles may invite visitors or external collaborators?
14. How should temporary access differ visually from permanent membership?
15. Under what conditions may authorized STG personnel enter a customer office?
16. How should emergency platform intervention be disclosed and recorded?
17. Which decisions always require human approval regardless of agent authority?

### Economy

18. Which services are leased, purchased once, subscribed to, or usage-based?
19. Do Credits expire, transfer, refund, or vary by customer agreement?
20. How are recurring costs communicated before renewal?
21. Can organizations allocate Credit budgets by department, agent, or project?
22. How are customization purchases separated from operational capacity?
23. How should administrative unlimited Credits be represented without distorting internal accounting?

### Experience and Interface

24. What is the fastest path from arrival to assigning the first meaningful work?
25. Which information, if any, must remain in a persistent HUD?
26. How do users navigate efficiently across multiple floors and buildings?
27. What alternative interface is available to users who cannot or do not want to navigate a 3D space?
28. How should mobile access relate to the headquarters experience?
29. How much office customization can occur without harming usability or performance?

### Community and Expansion

30. What makes a space public, private, shared, or invitation-only?
31. How are customer collaboration and cross-company records governed?
32. What standards determine which marketplace offerings are trusted?
33. When does expansion beyond the first skyscraper create real product value rather than decorative scale?

---

## 20. Matters Reserved for Later Engineering Decisions

The following ideas are essential to the vision but require technical investigation and architecture work later. This document does not select solutions.

- How customer workspaces, records, and agent contexts are isolated.
- How world objects remain synchronized with real platform state.
- How agent activity states are defined, updated, and verified.
- How permissions and authority are enforced beneath physical access metaphors.
- How repository, Kanban, meeting, finance, and infrastructure data are presented safely.
- How nearby floors, rooms, agents, and assets are loaded efficiently.
- How the same experience adapts from Raspberry Pi-class kiosks to powerful desktops.
- How live, delayed, offline, and historical state are distinguished.
- How users recover when a physical interaction is inaccessible or unavailable.
- How shared spaces and cross-company meetings preserve tenant boundaries.
- How Credits, purchases, consumption, and administrative accounting are reconciled.
- How the product provides durable evidence that visible agent activity represents real work.
- How office customization remains compatible with consistent navigation and interface behavior.
- How the world handles service interruption, partial availability, and stale data.
- How agent identity, personality, role, skills, permissions, and authority are represented consistently over time.

These are decision areas, not implementation tasks.

---

## 21. Vision Guardrails

Future Vibe City decisions should be evaluated against the following guardrails:

1. **Reality before spectacle.** Do not show work, staff, capacity, or capability that does not exist.
2. **The world is the interface.** Prefer meaningful spaces and objects over detached dashboard clutter.
3. **Clarity before simulation.** Do not reproduce real-world inconvenience without a product reason.
4. **Every agent is accountable.** Roles, access, assignments, and outcomes must be understandable.
5. **Skills do not equal permission or authority.** Preserve these boundaries visibly and operationally.
6. **Tenants remain isolated.** Shared geography must never imply shared private access.
7. **Growth must mean something.** Expansion should correspond to real organizational or hosted capability.
8. **Managed service is the product.** Customers should not need to become infrastructure operators.
9. **Financial consequences are explicit.** Credits must not obscure real costs or approvals.
10. **Evidence matters.** Visible activity must lead to inspectable results and durable records.
11. **Performance should preserve meaning.** Lower-capability hardware may simplify presentation, not truth.
12. **STG follows the model it operates.** Administrative privileges should not erase accounting or accountability.
13. **Accessibility is foundational.** The spatial interface must have readable and usable alternatives.
14. **The initial skyscraper must stand on its own.** Future city concepts should not prevent the first building from being a coherent product.

---

## 22. Closing Vision

Vibe City should make advanced AI operations feel tangible, organized, and human-readable.

A customer enters a building, leases an office, meets an AI employee, organizes real work, watches that work progress, participates in meaningful meetings, reviews evidence, makes decisions, and expands the organization. Behind the experience is a managed multi-agent platform; in front of the customer is a headquarters they can understand.

The long-term ambition is larger than a virtual office and more disciplined than a game-like control panel. Vibe City is a place where digital organizations become visible—where every office, agent, room, record, upgrade, and boundary reflects something real.

If the product preserves that integrity as it grows from one suite to one skyscraper and eventually to a city, Vibe City can become both an approachable interface for hosted AI and a distinct new way to experience the operation of an AI-enabled organization.

---

## 23. Design Bible Governance and Current Decisions

### 23.1 Version 0 and Document Governance

This document is **Version 0 of the Vibe City Design Bible**. It remains the central, long-term product vision document for Vibe City. Future planning should preserve this document's role and evolve the design through explicit, traceable decisions rather than replacing it with disconnected specifications or silently rewriting earlier conclusions.

Companion documents may add operational, experiential, aesthetic, and eventually implementation detail. If a companion document appears to conflict with this master vision, the conflict should be identified and resolved as a design decision. The master design should then be amended deliberately if the product vision itself has changed.

### 23.2 Proposed Documentation Set

The Vibe City Design Bible is organized around the following information architecture:

| File | Role in the documentation set | Future planning topics that belong there | Current status |
|---|---|---|---|
| `VIBE_CITY_MASTER_DESIGN.md` | Central product vision and design authority | Product vision, world structure, hosting metaphors, tenant model, agent model, economy, and long-term concepts | Active as Version 0 |
| `STG_TOWER_OPERATIONS.md` | STG's internal operating model inside Vibe City | Departments, reporting structure, agent authority, meetings, approvals, internal workflows, and cross-department coordination | Reserved companion document |
| `VIBE_CITY_LORE.md` | World identity and visual-language reference | Branding, naming conventions, terminology, architectural style, signage, office aesthetics, identity, and atmosphere | Reserved companion document |
| `VIBE_CITY_GAMEPLAY.md` | Customer experience and progression reference | Signup, office leasing, first-agent experience, creating work, hiring agents, capacity limits, suite expansion, floor ownership, and long-term customer progression | Reserved companion document |
| `VIBE_CITY_ROADMAP.md` | Implementation-planning reference | Implementation phases, milestones, dependencies, validation criteria, and development priorities | Active; explicitly authorized 2026-07-27 |

The companion documents should remain consistent with this master design while giving their subject areas room to develop. Operational procedures belong in `STG_TOWER_OPERATIONS.md`; terminology and atmosphere belong in `VIBE_CITY_LORE.md`; customer progression and interaction concepts belong in `VIBE_CITY_GAMEPLAY.md`; and implementation sequencing belongs only in the explicitly authorized `VIBE_CITY_ROADMAP.md`.

### 23.3 Current Planning Conclusions

The following statements are current planning conclusions for the Design Bible. They are product decisions at the present level of planning, not implementation instructions:

#### World and Tenancy

- The first Vibe City environment is one high-rise.
- Each floor contains four separately purchasable office suites.
- A customer may lease one suite, multiple suites, or all four suites on a floor.
- Each suite is an isolated managed Hermes workspace.
- Each suite contains appropriate office rooms and work areas.
- STG Headquarters exists within the high-rise as privileged administrative space.

#### Agents, Capacity, and Authority

- Every NPC represents a real AI agent; there are no filler NPCs.
- A starter office includes one agent.
- Customers may pay for additional agents, subject to office-tier capacity.
- Agent and repository limits are determined by the leased office tier.
- All agents may technically have access to the same platform skill library.
- Actual authority is controlled through tenant connections, permissions, roles, repository access, and approval rules.

#### Managed Hosting and Economy

- Most customers should not need direct API keys or CLI access because they are paying to use Vibe City's managed infrastructure, models, integrations, and execution gateway.
- Customers purchase in-world Credits with real money.
- Office rent, agents, repositories, storage, upgrades, and other services are billed in Credits.
- STG administrative accounts may have unlimited Credits, but their internal office and agent expenses should still be recorded through the same in-world accounting system.

#### Interface Direction

- The current visible HUD and phone-style interface are to be disabled until the interface system is completely redesigned.
- The future interface should use minimal overlays and favor physical in-world objects such as monitors, cabinets, office signs, meeting displays, and terminals.

These conclusions establish the design direction only. Any later work to change the current interface belongs in an explicitly authorized implementation-planning process, not in this Design Bible update.

#### Performance Direction

- Raspberry Pi performance is a primary design constraint.
- Only the current suite and nearby shared areas should need to be rendered.

The specific means of meeting this constraint remains a later engineering decision.
