# Vibe City Gameplay

**Document type:** Vibe City Design Bible companion  
**Status:** Scope reserved for future customer-experience planning  
**Authority:** Subordinate to `VIBE_CITY_MASTER_DESIGN.md`, Version 0  
**Out of scope for this revision:** Implementation architecture, development tasks, milestones, and timelines

---

## Purpose

This document is reserved for the customer experience and long-term progression model in Vibe City. “Gameplay” refers to the way customers inhabit and operate their managed AI workspace; it should remain grounded in real platform resources, work, permissions, and purchases.

## Future Planning Topics

Future revisions should define:

- customer account creation and arrival;
- leasing the first office suite;
- meeting and understanding the starter agent;
- creating, connecting, assigning, and reviewing real work;
- repository and task-management experiences;
- hiring or hosting additional agents;
- agent, repository, storage, and capacity limits;
- office-tier differences;
- Credit purchase and in-world spending experiences;
- expanding within a suite;
- leasing additional suites;
- owning all four suites on a floor;
- long-term customer and organizational progression;
- collaboration within and across organizations;
- the balance between physical interaction and efficient navigation; and
- how alternative or accessible interfaces preserve the same product meaning.

## Current Baseline Conclusions

- A customer leases an isolated managed Hermes workspace represented by an office suite.
- Each floor contains four separately purchasable suites.
- A customer may lease one suite, multiple suites, or all four suites on a floor.
- A starter office includes one real AI agent.
- Customers may pay for additional agents subject to office-tier capacity.
- Agent and repository limits are determined by the leased office tier.
- Customers purchase Credits with real money and spend Credits on office rent, agents, repositories, storage, upgrades, and other managed services.
- Most customers should not need direct API keys or CLI access.
- The customer experience should favor physical in-world objects such as monitors, cabinets, signs, meeting displays, and terminals over a dense HUD.
- The current visible HUD and phone-style interface are designated to be disabled until a complete interface redesign is authorized and planned.
- Raspberry Pi performance is a primary constraint; the experience should only require the current suite and nearby shared areas to be presented at a time.

## Progression Principle

Customer progression should represent real growth in hosted capacity or organizational capability:

```text
Starter office and one agent
              ↓
Additional agents and records capacity
              ↓
Expanded departments and office capability
              ↓
Additional office suites
              ↓
All four suites on a floor
              ↓
Future multi-floor organization
```

This progression is a product-design concept, not an implementation sequence or timeline.

## Documentation Boundary

This file owns customer experience and progression. It should not define STG's internal operations, the world's complete branding system, technical architecture, or implementation phases. The explicitly authorized implementation sequence is maintained in `VIBE_CITY_ROADMAP.md`.
