# Validation — World Zero Wayfinding v0

Validation date: 2026-07-29

## Export

Command, run from `design/tools`:

`npm run export -- ../assets/world-zero-wayfinding-v0`

Outcome: exit code `0`. Six optimized SVG exports and six PNG previews were generated. Reported render properties:

| Asset | Render dimensions | PNG bytes |
|---|---:|---:|
| `stg-headquarters-entry` | 1024 × 256 | 18,786 |
| `reception-plaque` | 768 × 192 | 8,760 |
| `chief-agent-office-plaque` | 768 × 192 | 11,949 |
| `kanban-records-room-plaque` | 768 × 192 | 12,573 |
| `executive-office-plaque` | 768 × 192 | 9,280 |
| `world-zero-directory` | 1024 × 1536 | 75,223 |

The exporter completed without SVGO advisories after its compatibility configuration was corrected for SVGO 4.0.2. Optimized exports preserve `viewBox`, accessible `title`, `desc`, `aria-label`, and `aria-description` metadata.

A second export completed with exit code `0`; SHA-256 comparisons across all SVG exports and PNG previews matched the first generated outputs exactly.

## Packet validation

Command, run from `design/tools`:

`npm run validate -- ../assets/world-zero-wayfinding-v0`

Outcome: exit code `0`; `svgCount: 6`; `errors: []`; `warnings: []`.

The validator now enforces exact manifest/source/export/preview parity, exact deterministic output matching, dimensions, preview PNG headers, accessible metadata on the SVG root and optimized exports, namespace-aware XML rejection of active/external SVG content, and lexical, symbolic-link, dangling-link, and hard-link path containment. `npm test` in `design/tools` passed all sixteen toolchain tests, including fail-closed manifest traversal, duplicate manifest paths, symbolic-link source/directory/output cases, dangling output links, hard-linked packet assets, active and legacy animation elements, namespace-prefixed active elements, `xml:base`, inline styles, obfuscated CSS resources, non-fragment resources, root/namespace accessibility spoofing, malformed XML with structured validation errors, stale exports/previews, and unmanifested artifacts.

An additional `xmllint --noout` pass succeeded for all six source SVGs and all six exported SVGs. The packet contains exactly six source SVGs, six exported SVGs, and six PNG previews.

## Preview inspection

All six generated PNGs were independently inspected at their native render dimensions and accepted with no blocking visual defects. None were empty. No clipping, text overlap, malformed geometry, or unsupported state implication was observed. The four plaques and entry sign remain readable at native size. The directory visibly contains exactly four numbered room rows—Reception, Chief Agent Office, Kanban Records Room, and Executive Office—and carries both `PUBLIC ORIENTATION` and `WORLD ZERO`. The graphite, warm-ivory, and cyan system is coherent across the packet. No preview presents availability, occupancy, staffing, access, work state, or service-health claims.

## Repository build

Command, run from the repository root after provisioning the worktree with `npm ci --ignore-scripts --no-audit --no-fund`:

`npm run build`

Outcome: exit code `0`. TypeScript compiled and Vite 8.1.5 completed a production build with 83 modules transformed. Vite emitted its existing advisory that one generated JavaScript chunk exceeds 500 kB; the design-only packet adds no runtime imports and did not alter the application bundle.

## Known limitations

- Typeface metrics use the local generic Arial/Helvetica/sans-serif stack and can vary slightly by platform; the deterministic checked-in previews were rendered on the validation host.
- World-space placement, final target-viewport reading distance, 200% browser text-zoom behavior, high-contrast mode behavior, and Raspberry Pi-class runtime performance require integration review and are outside this source-only packet.
- Cyan is an orientation accent only; integration must not reinterpret it as live state.
- The right-pointing chevrons are generic orientation symbols in this source packet. Integration must rotate or replace them to match actual room direction rather than implying an incorrect route.

Integration state: `verified` source asset packet (not integrated or released).
