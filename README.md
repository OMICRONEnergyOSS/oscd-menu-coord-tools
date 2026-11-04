# oscd-menu-coord-tools

OpenSCD menu plugins for positioning, copying, and cleaning SLD coordinates.

The positioner is intended as a starting point for documents that already
contain primary plant data but do not yet contain SLD coordinates.

## Behavior

- Substations are laid out as vertical stacks of voltage levels.
- Each voltage level contains a single row of bays.
- Each bay uses three conceptual columns: one IED column and two conducting-equipment columns.
- IED scope allocation follows the old OpenSCD zeroline `attachedIeds` logic.
- Direct non-bay primary equipment under `VoltageLevel` or `Substation` is also placed in a second pass so transformer-heavy models still get a usable starting layout.
- IED names are placed underneath their symbols. Measured label footprints determine
  IED spacing, equipment column widths, row heights, and enclosing container sizes.

Stored layout data follows the
[OpenSCD SLD extension schema](https://github.com/openscd/oscd-extensions/blob/main/SSD/SLD/v0/ssd-sld-v0.xsd).
Placement and measurement use diagram/grid units, not browser pixels or the
editor's zoom setting. Labels are measured with native SVG text after the font
is available, with measurements cached for each name and font size during a run.
The current editor's default typography and label-coordinate rendering offsets
are isolated in `src/foundation/sld-editor-foundations.ts`; layout-specific
clearance, label placement, and conservative symbol envelopes live in
`src/foundation/layout-geometry.ts`. No hidden editor instance is used.

This remains a first-pass row/column layout, not a general collision solver.
It assumes the editor's default fonts and does not avoid existing wires,
free text, or other manually positioned obstacles. Custom font overrides or
unusual transformer decorations can require manual adjustment.

## Coordinate tools

See [Coordinate copier mappings](COORDINATE-MAPPINGS.md) for the developer
contract: field/structure mappings, coordinate arithmetic, and intentional limits
for all four directions.

Five additional, independent menu plugins are included. They do not automatically
synchronize competing coordinate systems or change auto-layout behavior.

| Plugin | Package export / browser bundle |
| --- | --- |
| SLD positioner | `oscd-menu-sld-positioner.js` |
| Copy SLDv1 to SLD Private | `oscd-menu-copy-sldv1-sldpriv.js` |
| Copy SLD Private to SLDv1 | `oscd-menu-copy-sldpriv-sldv1.js` |
| Copy SXY to SLD Private | `oscd-menu-copy-sxy-sldpriv.js` |
| Copy SLD Private to SXY | `oscd-menu-copy-sldpriv-sxy.js` |
| SLD Coords cleaner | `oscd-menu-sld-coords-cleaner.js` |

The SLDv1 copiers retain all source data, including IED placements and connectivity
vertices. A direction-specific introduction explains the older SLDv1 layout
format and the current editor's SLD Private format. Check **Don't show
this introduction again** and submit to suppress it for that plugin in this
browser. The preference uses oscd-ui's `@localstorage` decorator keyed by the
plugin ID; each direction has an independent preference.

If the selected source format has no coordinates, or all destination layouts
already match, a short dialog with **Close** is always shown instead. It explains
which case applies, has no introduction, counts, copy actions, preference
checkbox, or snackbar, and does not change the saved preference. When shown, the introduction
checkbox is last in the dialog content, just above the footer.

Differing destination layouts always prompt for **Skip existing** or
**Overwrite existing**, with Cancel available. Skip still copies missing
destinations. Neither choice is remembered. Matching destinations do not count
as conflicts, even if they contain additional scalar fields that will be
retained. Overwritten connectivity paths are replaced as a complete set.
Counts refer to layout records, not individual SCL elements or attributes;
each connectivity path set counts as one record.
After submitting, the dialog closes. A nonmodal snackbar reports actual copies,
including how many conflicts were skipped alongside them. Skipping everything
closes silently; no snackbar is shown without document edits.
With the introduction suppressed, conflict-free copies
run directly. Blocking diagnostics and document-specific precedence notes
remain visible in the dialog.
The Text compatibility warning appears separately when importing Text layout
that does not already match its destination; it is not generic onboarding.
Ambiguous IED placements, duplicate destinations, and unsupported source data
block the operation with an explanation instead of guessing or partially copying.

The reverse copier exports plant layout fields as Transpower-namespaced
attributes on their original SCL owners. IED references become
`OpenSCD-Linked-IEDs/IEDName` entries in the same Substation, VoltageLevel, or
Bay, rather than being repositioned. Existing root-IED coordinates are reused
only for an unambiguous matching placement in the document's sole Substation;
competing direct/linked placements block copying. Connectivity paths become
`Transpower-SLD-Vertices` sections, with the legacy unqualified `bus` flag.
Coordinate values, label positions, rotation, styling, and terminal/vertex UUIDs
are copied without numerical conversion. Unsupported SLD layout fields or
structures block export; unrelated source vendor metadata remains in the source.

When an IED has both an older `OpenSCD-Coords/Coords` record and a scoped
`OpenSCD-Linked-IEDs` placement, import uses the linked placement and retains
the older record unchanged. The dialog reports this precedence choice.
Standalone Coords records without a linked placement still require an explicit
destination; the copier does not guess their scope.

Text annotations are supported in both directions, including their coordinates,
rotation, color, and font weight; their text content is retained.
**Temporary schema exception:** to match the current SLD editor, text layout
uses `Text > Private[type="OpenSCD-SLD-Layout"] > SLDAttributes`. An SCL `Private`
child inside `Text` violates the SCL schema. This owner-approved compatibility
exception must be corrected once the representation is settled in
[openscd/oscd-extensions#5](https://github.com/openscd/oscd-extensions/issues/5).

SLDv1 and SLD Private are separate menu actions with fixed directions. Copies
are not synchronization: destination-only records remain, and changing one
representation does not update the other. The current SLD editor prompts for
migration when SLDv1 is present, even if SLD Private data also exists. To inspect
Private data without migrating a retained SLDv1 copy, use the cleaner to remove
SLDv1 explicitly from a working copy.

### SXY position copying

The SXY pair uses the coordinate model described in IEC 61850-6 Annex C.1:
integer object/grid coordinates relative to parent elements, rather than pixel
positions. The reference inspected for this implementation is the supplied
Edition 2.1 draft, printed pages 179-180; Annex C and its example schema are
informative. Compatibility with every vendor interpretation is not claimed.

Supported owners are Substation, VoltageLevel, Bay, ConductingEquipment,
PowerTransformer, and ConnectivityNode. Import sums ancestor offsets to obtain
absolute SLD positions. Missing axes contribute zero. Signed relative offsets
are accepted when the resulting absolute position is nonnegative. No CoMPAS
display scale or vendor-specific drawing fields are applied.

Missing Substation/VoltageLevel/Bay dimensions are derived from effective
destination positions; existing dimensions are retained, even if too small.
These inferred bounds are target-format adaptations, not original SXY data.
ConnectivityNode positions are preserved as scalar point metadata; the SLD
editor draws connections from Section/Vertex paths, which this copier does
not generate. A position-only import is not a complete rendered diagram.

Export rounds absolute SLD positions to the nearest integer, then subtracts
effective ancestor offsets to produce relative SXY positions. Fractional source
positions produce an explicit warning before copying, even if onboarding is
dismissed. Rounding can alter spacing or make positions coincide. It is not
repeated at each relative hierarchy level.

Only elements with explicit supported source positions are repositioned.
An element without source positions keeps its existing SXY attributes exactly:
moving its container can therefore move it in the resulting drawing.
Skip/overwrite applies to position pairs; other destination fields remain.
Sources, ABB/vendor metadata, and other coordinate systems remain untouched.

SXY `dir` and SLD rotation are not converted: a preferred connection axis is
not an exact rotation mapping. Labels, styling, explicit dimensions, scoped
IED placements, winding details, and connection paths have no mapping in this
position-only implementation. Relevant source records outside the supported
mapping are reported, not deleted or guessed.

The SXY pair shares the dismissible direction-specific introduction, mandatory
conflict decisions, Close-only empty/matching dialogs, and actual-edit-only
snackbars described above.

### Coordinate cleanup

The cleaner detects SLDv1, SLD Private, and IEC SXY data by namespace URI.
Detected systems are enabled but initially unchecked. Selecting every detected
system requires the additional acknowledgment:
“Are you sure? Removing all coordinates means nothing will appear on the SLD
Designer canvas”. Changing the selection resets that acknowledgment.
Selected layout attributes and Private sections are removed; vendor data and
unselected systems are retained. The cleaner closes after successful removal.
Mixed unrelated content inside a layout section
blocks removal rather than being discarded. Unused selected namespace
declarations are removed, but declarations referenced by QName metadata remain.

Each operation is one undoable EditV2 transaction. A changed document or
`docVersion` invalidates an open confirmation; close and reopen the plugin.

Register the additional plugins in the host's scoped registry just like
auto-layout, using their default class exports:

```js
import OscdMenuCopySldv1Sldpriv from
  '@omicronenergy/oscd-menu-coord-tools/oscd-menu-copy-sldv1-sldpriv.js';
import OscdMenuCopySldprivSldv1 from
  '@omicronenergy/oscd-menu-coord-tools/oscd-menu-copy-sldpriv-sldv1.js';
import OscdMenuCopySxySldpriv from
  '@omicronenergy/oscd-menu-coord-tools/oscd-menu-copy-sxy-sldpriv.js';
import OscdMenuCopySldprivSxy from
  '@omicronenergy/oscd-menu-coord-tools/oscd-menu-copy-sldpriv-sxy.js';
import OscdMenuSldCoordsCleaner from
  '@omicronenergy/oscd-menu-coord-tools/oscd-menu-sld-coords-cleaner.js';

shell.registry.define('oscd-menu-copy-sldv1-sldpriv', OscdMenuCopySldv1Sldpriv);
shell.registry.define('oscd-menu-copy-sldpriv-sldv1', OscdMenuCopySldprivSldv1);
shell.registry.define('oscd-menu-copy-sxy-sldpriv', OscdMenuCopySxySldpriv);
shell.registry.define('oscd-menu-copy-sldpriv-sxy', OscdMenuCopySldprivSxy);
shell.registry.define('oscd-menu-sld-coords-cleaner', OscdMenuSldCoordsCleaner);
```

Add corresponding menu entries with `requireDoc: true` and these `tagName`
values. All are already registered in the demo.

## Install

```sh
npm install @omicronenergy/oscd-menu-coord-tools
```

## Register in oscd-shell

```js
import OscdMenuSldPositioner from '@omicronenergy/oscd-menu-coord-tools';

const shell = document.querySelector('oscd-shell');
shell.registry.define('oscd-menu-sld-positioner', OscdMenuSldPositioner);

export const plugins = {
  menu: [
    {
      name: 'Auto-position SLD elements',
      translations: { de: 'SLD automatisch layouten' },
      icon: 'account_tree',
      requireDoc: true,
      tagName: 'oscd-menu-sld-positioner',
    },
  ],
  editor: [],
  background: [],
};

shell.plugins = plugins;
```

The current shell uses a scoped registry. Register tagged plugins in
`shell.registry`, not the global `customElements` registry.

## Development

```sh
npm install
npm run build
npm test
npm run start
```

Source lives in `src/`, with layout logic in `src/foundation/` and the menu
integration spec beside the entry point. Build, lint, test, and
development-server commands use `@omicronenergy/oscd-tooling`; browser tests
use Playwright. `npm run compile` remains an alias for `npm run build`.

`npm install` installs shared Git hooks through the `prepare` script and sets
this repository's `core.hooksPath` to `.githooks`.

`npm run build` compiles modules into `dist/`. `npm run bundle` creates the
browser-deployable plugin and bundled demo; `npm run start:bundle` serves that
bundled demo.

The demo starts without a document. Open a file using its File menu, or append
`?doc=sample.scd` to `/demo/` to load the included sample. It includes the
Source Editor and an SLD editor for graphical inspection.

The demo imports the npm SLD editor, pinned by the lockfile, which reads the
`OpenSCD-SLD-Layout` private elements generated by this plugin. The temporary
legacy deployment reads direct Transpower-namespaced attributes instead and
is not compatible with this output format.

## Packaging and deployment

The intended canonical repository is
[`OMICRONEnergyOSS/oscd-menu-coord-tools`](https://github.com/OMICRONEnergyOSS/oscd-menu-coord-tools).
The configured Pages endpoints, once deployed, are:

- Plugin: `https://omicronenergyoss.github.io/oscd-menu-coord-tools/oscd-menu-sld-positioner.js`
- Demo: `https://omicronenergyoss.github.io/oscd-menu-coord-tools/demo/?doc=sample.scd`

Use the plugin URL as a menu plugin's `src` in hosts supporting sourced
plugins. The standalone bundle contains its runtime imports; the bundled demo
also includes the compatible SLD editor.

`npm run build` produces the npm modules and declarations. The npm package
excludes demo output, tests, snapshots, and source maps. Build before manual
publication and inspect contents with `npm pack --dry-run`.

`npm run bundle` produces four independent, single-file plugin bundles and
the static demo under `dist`. The thin local Rollup config extends the shared
configuration only to add the coordinate-tool entry points.
`npm run deploy` bundles first, then publishes the output to the `deploy`
branch of the configured Git remote. This command writes to
the remote and should only be run intentionally against the canonical repo.

### Shared automation

The workflow callers use `OMICRONEnergyOSS/oscd-gh-workflows`:

- Unit tests run the build, lint, and Playwright tests on pushes and PRs.
- Continuous deployment bundles and pushes `dist` to `deploy` on `main`.
- Release Please maintains a release PR using conventional commits. Merging
  it creates a release, publishes the npm modules with provenance, and
  attaches zipped browser bundles.

### Owner setup before enabling releases

1. Make these files available in the canonical repository on `main`. This
   checkout may still point at a personal fork; package metadata does not
   change the Git remote.
2. Enable GitHub Actions and allow the shared workflows. Allow Actions to
   create and approve pull requests for Release Please. Workflow job
   permissions request the required repository writes and OIDC publishing.
3. Configure Pages to deploy from the `deploy` branch, root directory, after
   the first deployment creates that branch. If a workflow's `GITHUB_TOKEN`
   push does not trigger a Pages build, use an approved GitHub App/PAT secret
   for deployment or update the shared workflow to use Pages artifact
   deployment; do not embed credentials in the repo.
4. Ensure the npm scope/package is owned by the appropriate organization.
   For an unpublished package, an authorized maintainer may need to bootstrap
   the first publication before configuring its trusted publisher.
5. Configure npm's GitHub Actions trusted publisher for owner
   `OMICRONEnergyOSS`, repository `oscd-menu-coord-tools`, and workflow
   `release-please.yml` (the caller, not the reusable workflow's repository).
   Both caller and shared publishing job grant `id-token: write`, as required
   by npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
   No npm token is committed or configured by this project.
6. Review the first release PR's version before merging; the manifest starts
   at the current package version, `0.0.0`. PRs created with `GITHUB_TOKEN`
   do not automatically trigger other workflows, so run checks manually on
   release PRs or use the organization's approved automation token.

### Known tooling limitation

Published `oscd-tooling` 0.0.6 passes literal quotes in its cleanup glob on
Linux, so a successful clean message can leave stale `dist` files. Until
the upstream fix is published, do not treat that message as proof of a clean
build; inspect/remove generated output before switching build modes. No
plugin-local tooling override is installed here.