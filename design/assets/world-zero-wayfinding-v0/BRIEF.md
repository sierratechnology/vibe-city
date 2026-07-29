# World Zero Wayfinding v0

## Purpose

Provide the first production asset packet for clear, environmental orientation inside the existing Working World Zero / Sierra Technology Group Headquarters. The kit identifies the Headquarters entry and the four existing rooms without presenting operational state.

## World meaning

- The entry sign identifies Sierra Technology Group Headquarters within World Zero.
- Four room plaques identify Reception, Chief Agent Office, Kanban Records Room, and Executive Office.
- The directory is a static public-orientation aid for those same four rooms only.
- Cyan chevrons and rails mean orientation or direction, not status.

## Non-scope

This packet does not claim or display live availability, occupancy, staffing, access, service health, work state, room status, tenant state, or authorization. It does not add rooms, agents, services, logos, interaction behavior, runtime integration, or production publication.

## Assets and target dimensions

| Asset | ViewBox / target size |
|---|---:|
| `stg-headquarters-entry` | 1024 × 256 |
| `reception-plaque` | 768 × 192 |
| `chief-agent-office-plaque` | 768 × 192 |
| `kanban-records-room-plaque` | 768 × 192 |
| `executive-office-plaque` | 768 × 192 |
| `world-zero-directory` | 1024 × 1536 |

## Visual tokens

- Graphite field: `#111820`
- Slate panel: `#1C2933`
- Deep inset: `#0B1117`
- Warm ivory primary text: `#F3EBD8`
- Muted ivory secondary text: `#C9C1AD`
- Orientation cyan: `#63D9E6`
- Slate divider: `#40515D`

The system uses a strong dark silhouette, inset borders, clipped-corner geometry, room-specific line symbols, and restrained cyan directional marks. Typography uses only a local generic system sans-serif stack: `Arial, Helvetica, sans-serif`; no font file is embedded or fetched.

## Accessibility

- Every SVG has a programmatic `title` and `desc`; explicit `aria-label` and `aria-description` attributes preserve an accessible name and description through optimization.
- Ivory-on-graphite text carries the primary meaning; cyan is supplementary.
- Every plaque pairs a geometric room symbol with the full room name.
- The directory uses numbered rows, symbols, room names, and chevrons rather than color alone.
- Type is deliberately large, with no tiny decorative copy.
- Assets are static and contain no motion; reduced-motion behavior is therefore unchanged.
- Source vectors remain sharp under enlargement and are suitable for 200% text-zoom review when presented at an appropriate CSS size.

## Performance

All artwork is flat vector geometry with no filters, masks, raster images, external resources, scripts, or animation. The checked-in exporter optimizes SVG and renders PNG previews deterministically through SVGO and resvg.

## Integration notes

Use the SVG exports as environmental signage, preserving aspect ratio and sufficient world-space size for readable text. The tall directory must remain labeled `PUBLIC ORIENTATION` and `WORLD ZERO`. Cyan must not be remapped to a live-state token. Runtime placement and interaction are outside this packet.
