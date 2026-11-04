# Coordinate copier mappings

The examples below are **illustrative XML excerpts**, not complete SCL documents.
The “after” column shows destination data only: all copiers retain their source.
Unchanged destination fields and unrelated vendor data are retained too.

| Prefix | Namespace                                     |
| ------ | --------------------------------------------- |
| `v1:`  | `https://transpower.co.nz/SCL/SSD/SLD/v0`     |
| `sld:` | `https://openscd.org/SCL/SSD/SLD/v0`          |
| `sxy:` | `http://www.iec.ch/61850/2003/SCLcoordinates` |

## SLDv1 ↔ SLD Private

**SLDv1** is our shorthand for the previous Transpower New Zealand notation for
SLD metadata: namespaced attributes on SCL elements, plus dedicated Private
sections for IED placements and connection paths.
**SLD Private** is the current OpenSCD editor's representation, using
`Private type="OpenSCD-SLD-Layout"`.

### SLDv1 -> SLD Private

| Group                              | Before: SLDv1                                                                                                                                                  | After: SLD Private                                                                                                                                               | Mapping                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Element position `x`, `y`          | `<Bay name="B" v1:x="2.5" v1:y="3">`                                                                                                                           | Within the same Bay:<br>`<Private type="OpenSCD-SLD-Layout"><sld:SLDAttributes sld:x="2.5" sld:y="3"/></Private>`                                                | Values unchanged; no scaling or ancestor-offset calculation                                   |
| Size `w`, `h`                      | `<Bay name="B" v1:w="10" v1:h="8">`                                                                                                                            | `<sld:SLDAttributes sld:w="10" sld:h="8"/>` within its Layout Private                                                                                            | Values unchanged                                                                              |
| Label position `lx`, `ly`          | `v1:lx="4" v1:ly="5"`                                                                                                                                          | `sld:lx="4" sld:ly="5"` on SLDAttributes                                                                                                                         | Values unchanged                                                                              |
| Rotation and other scalar metadata | `v1:rot="1" v1:flip="true" v1:color="#ff0000"`                                                                                                                 | `sld:rot="1" sld:flip="true" sld:color="#ff0000"` on SLDAttributes                                                                                               | Same-name mapping for `rot`, `flip`, `kind`, `color`, `weight`, `uuid`                        |
| IED placement                      | `<Private type="OpenSCD-Linked-IEDs"><IEDName v1:name="IED1" v1:x="2" v1:y="3"/></Private>`                                                                    | Within the same container's Layout Private:<br>`<sld:Reference sld:type="IED" sld:id="IED1"><sld:SLDAttributes sld:x="2" sld:y="3"/></sld:Reference>`            | Preserve Substation/VoltageLevel/Bay placement scope; root IED must resolve uniquely          |
| Connection paths                   | Under ConnectivityNode:<br>`<Private type="Transpower-SLD-Vertices"><v1:Section bus="true"><v1:Vertex v1:x="2" v1:y="3" v1:uuid="t1"/></v1:Section></Private>` | Under the same node:<br>`<Private type="OpenSCD-SLD-Layout"><sld:Section sld:bus="true"><sld:Vertex sld:x="2" sld:y="3" sld:uuid="t1"/></sld:Section></Private>` | Preserve section/vertex order and values. Also accept `v1:bus`; contradictory bus flags block |
| Text annotations                   | `<Text v1:x="2" v1:y="3">Label</Text>`                                                                                                                         | `<Text>Label<Private type="OpenSCD-SLD-Layout"><sld:SLDAttributes sld:x="2" sld:y="3"/></Private></Text>`                                                        | Retain text; temporary schema exception noted below                                           |

### SLD Private —> SLDv1

| Group                              | Before: SLD Private                                                                                                                      | After: SLDv1                                                                                                                        | Mapping                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Element position `x`, `y`          | Within Bay's Layout Private:<br>`<sld:SLDAttributes sld:x="2.5" sld:y="3"/>`                                                             | `<Bay name="B" v1:x="2.5" v1:y="3">`                                                                                                | Values unchanged                                                                  |
| Size `w`, `h`                      | `<sld:SLDAttributes sld:w="10" sld:h="8"/>`                                                                                              | `<Bay name="B" v1:w="10" v1:h="8">`                                                                                                 | Values unchanged                                                                  |
| Label position `lx`, `ly`          | `sld:lx="4" sld:ly="5"` on SLDAttributes                                                                                                 | `v1:lx="4" v1:ly="5"` on the SCL owner                                                                                              | Values unchanged                                                                  |
| Rotation and other scalar metadata | `sld:rot="1" sld:flip="true" sld:color="#ff0000"` on SLDAttributes                                                                       | `v1:rot="1" v1:flip="true" v1:color="#ff0000"` on the SCL owner                                                                     | Same-name mapping for `rot`, `flip`, `kind`, `color`, `weight`, `uuid`            |
| IED placement                      | `<sld:Reference sld:type="IED" sld:id="IED1"><sld:SLDAttributes sld:x="2" sld:y="3"/></sld:Reference>`                                   | `<Private type="OpenSCD-Linked-IEDs"><v1:IEDName v1:name="IED1" v1:x="2" v1:y="3"/></Private>`                                      | Preserve container scope; exception for reusing direct root-IED coordinates below |
| Connection paths                   | Within ConnectivityNode's Layout Private:<br>`<sld:Section sld:bus="true"><sld:Vertex sld:x="2" sld:y="3" sld:uuid="t1"/></sld:Section>` | `<Private type="Transpower-SLD-Vertices"><v1:Section bus="true"><v1:Vertex v1:x="2" v1:y="3" v1:uuid="t1"/></v1:Section></Private>` | Preserve order and values; bus flag becomes unqualified                           |
| Text annotations                   | Text's Layout Private contains:<br>`<sld:SLDAttributes sld:x="2" sld:y="3"/>`                                                            | `<Text v1:x="2" v1:y="3">Label…</Text>`                                                                                             | Retain original text and source Private                                           |

| Special case / limit              | Behavior in the SLDv1 pair                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported elements                | Text, Substation, VoltageLevel, Bay, ConductingEquipment, PowerTransformer, TransformerWinding, ConnectivityNode, Terminal, NeutralPoint, Function, SubFunction, EqFunction, EqSubFunction         |
| Direct root-IED attributes        | Import into the sole Substation. Export reuses an existing direct destination only for an unambiguous placement in that sole Substation; otherwise create scoped linked entries or block ambiguity |
| Older `OpenSCD-Coords/Coords`     | Import uses a scoped linked placement with geometry in preference to Coords and retains Coords. Without that scoped placement, block rather than guess. Export does not generate Coords            |
| Empty legacy connection wrapper   | Ignore; do not erase destination paths                                                                                                                                                             |
| Unsupported or ambiguous mappings | Block with diagnostics rather than partially copy                                                                                                                                                  |
| Text schema exception             | A Private child inside Text matches the current editor but violates SCL's Text content model; tracked in [openscd/oscd-extensions#5](https://github.com/openscd/oscd-extensions/issues/5)          |

## SXY ↔ SLD Private

**Work in progress — significant limitations.** This is currently a position-only
conversion, not a way to reproduce a complete, legible diagram. SXY only
scratches the surface of the drawing information in the inspected IOP files.
Reproducing their presentation requires investigating proprietary drawing
metadata and any layout behavior supplied by the originating tools.

| Finding in the inspected IOP files / current importer | Current shortcoming |
| --- | --- |
| ABB Private data contains `Line`, `Via`, `StopAt`, `Busbar`, and `Point` elements | Stored connection routing and busbar geometry are not converted; SLD Private needs Section/Vertex paths to draw connections |
| ABB Private data also contains drawing sizes, fonts, and winding information | Additional presentation data is outside the SXY mapping |
| SXY and ABB coordinates are not identical: examples include SXY x=`3` versus ABB x=`13`, and SXY y=`7` versus ABB y=`30` | Do not assume a simple namespace replacement or universal scale factor reproduces the proprietary layout |
| The importer does not generate label positions; the current SLD editor defaults missing `lx/ly` to `(0,0)` | Labels can overlap at the origin |
| Five conducting-equipment elements in the inspected HV-BUS example have no explicit SXY position | They remain unpositioned by this copier; the native tool's interpretation has not been established |
| Derived container bounds cover positions, not measured labels and complete symbol footprints | Container boxes can be too tight for a readable drawing |

Coordinate-value, preservation, and undo tests have passed, but **these do not
establish visual fidelity or diagram readability**. We do not have the originating
IOP tools available to confirm which details they read from proprietary metadata
and which they derive from electrical topology. Proprietary-data conversion is
not currently implemented.

SXY is the coordinate extension described in IEC 61850-6 Annex C.1. It stores
integer positions **relative to parent elements**; SLD Private stores absolute
positions. No pixel scaling or vendor rendering multiplier is applied.

### SXY -> SLD Private

| Group                                | Before: SXY                                                                                               | After: SLD Private                                                                                                 | Mapping / limit                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Element position `x`, `y`            | `<Bay name="B" sxy:x="10" sxy:y="5"><ConductingEquipment name="Q" type="DIS" sxy:x="2" sxy:y="3"/></Bay>` | Within Q's Layout Private:<br>`<sld:SLDAttributes sld:x="12" sld:y="8"/>`                                          | Sum own and ancestor offsets. Example assumes zero offsets above Bay                                           |
| Size `w`, `h`                        | No SXY size fields                                                                                        | For that Bay, enclosing its own position and Q:<br>`<sld:SLDAttributes sld:x="10" sld:y="5" sld:w="3" sld:h="4"/>` | Derive missing Substation/VoltageLevel/Bay dimensions from effective destination bounds; existing sizes remain |
| Preferred connection axis `dir`      | `sxy:dir="horizontal"`                                                                                    | No corresponding rotation generated                                                                                | An axis is not an exact rotation                                                                               |
| Labels, rotation, styling, UUIDs     | No equivalent fields in this SXY mapping                                                                  | No values generated                                                                                                | Existing destination metadata remains                                                                          |
| IED placements, Text, winding layout | Outside supported element-position scope                                                                  | Not converted                                                                                                      | No guessed placement or scope                                                                                  |
| ConnectivityNode point               | `<ConnectivityNode name="N" pathName="S/V/B/N" sxy:x="2" sxy:y="3"/>`                                     | Node's Layout Private contains scalar `sld:x/y` after ancestor summation                                           | Point metadata only; no Section/Vertex paths, wires, or busbar routes generated                                |

### SLD Private —> SXY

| Group                                       | Before: SLD Private                                                                                           | After: SXY                                                                                                | Mapping / limit                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Element position `x`, `y`                   | Bay's absolute position `(10,5)`; Q's Layout Private contains:<br>`<sld:SLDAttributes sld:x="12" sld:y="8"/>` | `<Bay name="B" sxy:x="10" sxy:y="5"><ConductingEquipment name="Q" type="DIS" sxy:x="2" sxy:y="3"/></Bay>` | Subtract effective destination ancestor offsets. Example assumes zero offsets above Bay          |
| Fractional position                         | Bay at `(10,5)`; Q has:<br>`<sld:SLDAttributes sld:x="12.4" sld:y="8.6"/>`                                    | Q receives `sxy:x="2" sxy:y="4"`                                                                          | Round absolute position to `(12,9)` before subtraction. Explicit rounding warning before copying |
| Size `w`, `h`                               | `sld:w="10" sld:h="8"`                                                                                        | Not converted                                                                                             | No SXY size mapping                                                                              |
| Labels `lx`, `ly`                           | `sld:lx="4" sld:ly="5"`                                                                                       | Not converted                                                                                             | No label-position mapping                                                                        |
| Rotation / styling / UUIDs                  | `sld:rot="1" sld:flip="true" sld:uuid="t1"`                                                                   | Not converted                                                                                             | Also excludes `kind`, `color`, `weight`; existing `sxy:dir` remains                              |
| Scoped IED placements, Text, winding layout | Reference or element layout outside supported scope                                                           | Not converted                                                                                             | No guessed placement or scope                                                                    |
| Connection paths                            | `<sld:Section><sld:Vertex sld:x="2" sld:y="3"/></sld:Section>`                                                | Not converted                                                                                             | An explicit ConnectivityNode scalar position can be copied; vertices are not used to invent one  |

| Special case / limit    | Behavior in the SXY pair                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported elements      | Substation, VoltageLevel, Bay, ConductingEquipment, PowerTransformer, ConnectivityNode within Substation trees                                          |
| Missing axis            | Treat as zero; one explicit axis is enough to constitute a source position                                                                              |
| No source position      | No position edit. Export leaves existing child offsets unchanged, even if a copied parent position makes the child move                                 |
| Numeric limits          | Signed 32-bit SXY offsets; imported absolute positions must be nonnegative safe integers. Invalid or unrepresentable numbers block, not clamp           |
| Derived sizes           | Target-format adaptation, not original SXY data. Minimum one unit; Substation viewport includes its offset because the viewport starts at zero          |
| Specification reference | Supplied IEC 61850-6 Edition 2.1 draft, Annex C.1, pp. 179–180; informative annex/schema. Compatibility with every vendor interpretation is not claimed |

For all directions, differing destinations require **Skip existing** or
**Overwrite existing**. Matching data is left alone. Scalar overwrites retain
destination-only fields; connection-path overwrites replace the complete section
set. Each copy is one undoable transaction.
