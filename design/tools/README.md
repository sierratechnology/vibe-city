# Vibe City Design Toolchain

Local-only tooling for validating and exporting reviewable SVG asset packets. It does not call paid generation providers or external services.

## Install

```bash
npm ci
```

## Export a packet

```bash
npm run export -- ../assets/<packet-id>
```

This reads each asset from `manifest.json`, performs namespace-aware XML safety inspection before optimization, uses SVGO with accessible title, description, and `viewBox` preservation, writes the optimized SVG export atomically, and renders a deterministic PNG preview through resvg.

## Validate a packet

```bash
npm run validate -- ../assets/<packet-id>
```

Validation checks exact packet/manifest/source/export/preview parity, dimensions, deterministic export and preview bytes, PNG headers, accessible SVG metadata, forbidden active or external content, renderer viability, and lexical, existing-symbolic-link, and dangling-symbolic-link path escapes.

## Test the toolchain

```bash
npm test
```

The tests prove a normal packet round-trip and fail-closed handling for manifest traversal, duplicate paths, symbolic-link and hard-link source/directory/output paths, dangling output links, active and namespace-prefixed animation, `xml:base`, inline/obfuscated CSS resources, resource syntax in any SVG attribute, dynamic CSS value syntax, root/namespace accessibility spoofing, malformed XML with structured validation errors, non-fragment SVG resources, stale exports/previews, and unmanifested artifacts.
