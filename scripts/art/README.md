# Original field kit

`create_models.py` authors the original Vibe City meshes in Blender and exports
`client/assets/field-kit.glb` plus a provenance manifest. All geometry is local
original work; there is no downloaded third-party model or paid-provider content.
The checked-in Three.js loader/utility/rounded-box sources are from the project's
installed Three.js 0.181.2, with its MIT license in client/vendor/THREE-LICENSE.txt.

Rebuild from the repository root:

```
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/art/create_models.py -- client/assets
```

Asset budget: 25 roots, under 5 MiB, metres, named rigid-part pivots, vertex-color
PBR materials. No external texture requests. The game reuses source geometry
and materials. Resources use merged instanced geometry; ground scenery uses two
bounded instance batches. The local terrain patch contains 18,432 triangles.

`client/field-art.js` animates articulated pivots rather than a skinned armature.
Game movement/jumping remain authoritative. Local action gestures are feedback,
not confirmation of a successful action. No save schema is added.

Tests: `tests/field-art.test.js` covers import/bounds, clone independence,
equipment visibility and surface alignment. `tests/art-preview-browser.js`
covers real browser rendering, locomotion/jump states, phone layout and failed
asset loading. Physical phone/controller performance is not established by these.
