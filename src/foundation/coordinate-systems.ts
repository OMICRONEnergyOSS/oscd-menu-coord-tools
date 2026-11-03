import { getReference, identity } from '@openscd/scl-lib';
import { createElement } from '@openscd/scl-lib/dist/foundation/utils.js';

import { privType, sldNs, xmlnsNs } from './layout-util.js';

import type { EditV2 } from '@openscd/oscd-api';

export const sldV1Ns = 'https://transpower.co.nz/SCL/SSD/SLD/v0';
export const sxyNs = 'http://www.iec.ch/61850/2003/SCLcoordinates';
export const coordinateSystems = ['sldv1', 'sldpriv', 'sxy'] as const;
export type CoordinateSystem = typeof coordinateSystems[number];

const legacyPrivateTypes = ['Transpower-SLD-Vertices', 'OpenSCD-Linked-IEDs'];
const layoutKeys = [
  'x', 'y', 'w', 'h', 'rot', 'lx', 'ly', 'kind', 'flip', 'color', 'weight', 'uuid',
];
const plantTags = new Set([
  // Text/Private matches the editor for now, but violates SCL's Text content model.
  // See https://github.com/openscd/oscd-extensions/issues/5.
  'Text', 'Substation', 'VoltageLevel', 'Bay', 'ConductingEquipment',
  'PowerTransformer', 'TransformerWinding', 'ConnectivityNode',
  'Terminal', 'NeutralPoint', 'Function', 'SubFunction', 'EqFunction', 'EqSubFunction',
]);

function allElements(doc: XMLDocument): Element[] {
  return [doc.documentElement, ...Array.from(doc.documentElement.getElementsByTagName('*'))];
}

function namespaceSystem(namespace: string | null): CoordinateSystem | undefined {
  switch (namespace) {
    case sldV1Ns: return 'sldv1';
    case sldNs: return 'sldpriv';
    case sxyNs: return 'sxy';
    default: return undefined;
  }
}

function privateSystem(element: Element): CoordinateSystem | undefined {
  if (element.localName !== 'Private' ||
      element.namespaceURI !== element.ownerDocument.documentElement.namespaceURI) {
    return undefined;
  }
  const type = element.getAttribute('type');
  if (type === privType) {
    return 'sldpriv';
  }
  if (legacyPrivateTypes.some(candidate => candidate === type)) {
    return 'sldv1';
  }
  return undefined;
}

export function detectCoordinateSystems(doc: XMLDocument): Record<CoordinateSystem, number> {
  const counts = { sldv1: 0, sldpriv: 0, sxy: 0 };
  for (const element of allElements(doc)) {
    const found = new Set<CoordinateSystem>();
    const system = privateSystem(element) ?? namespaceSystem(element.namespaceURI);
    if (system !== undefined) {
      found.add(system);
    }
    for (const attribute of Array.from(element.attributes)) {
      const system = namespaceSystem(attribute.namespaceURI);
      if (system !== undefined) {
        found.add(system);
      }
    }
    for (const system of found) {
      counts[system] += 1;
    }
  }
  return counts;
}

export type CoordinatePlan = { edits: EditV2[]; issues: string[] };

export function cleanCoordinatePlan(
  doc: XMLDocument,
  systems: readonly CoordinateSystem[],
): CoordinatePlan {
  const selected = new Set(systems);
  const removed = new Set<Element>();
  const edits: EditV2[] = [];
  const issues: string[] = [];
  const declarations: Attr[] = [];
  const qnameNamespaces = new Set<string>();
  for (const element of allElements(doc)) {
    if (element.parentElement !== null && removed.has(element.parentElement)) {
      removed.add(element);
      continue;
    }
    const privateKind = privateSystem(element);
    const system = privateKind ?? namespaceSystem(element.namespaceURI);
    if (system !== undefined && selected.has(system)) {
      const contents = [element, ...Array.from(element.getElementsByTagName('*'))];
      const unrelated = contents.some(child =>
        (child !== element && namespaceSystem(child.namespaceURI) !== system &&
          !(system === 'sldv1' && child.localName === 'IEDName' &&
            child.namespaceURI === doc.documentElement.namespaceURI)) ||
        Array.from(child.attributes).some(attribute =>
          attribute.namespaceURI !== null && attribute.namespaceURI !== xmlnsNs &&
          namespaceSystem(attribute.namespaceURI) !== system));
      if (unrelated || element === doc.documentElement) {
        issues.push(`Layout data on ${element.parentElement?.localName ?? element.localName} contains unrelated content; nothing was removed.`);
      }
      edits.push({ node: element });
      removed.add(element);
      continue;
    }
    const attributesNS: Record<string, Record<string, null>> = {};
    for (const attribute of Array.from(element.attributes)) {
      const system = namespaceSystem(attribute.namespaceURI);
      if (system !== undefined && selected.has(system) && attribute.namespaceURI !== null) {
        attributesNS[attribute.namespaceURI] ??= {};
        attributesNS[attribute.namespaceURI][attribute.name] = null;
      } else if (attribute.namespaceURI === xmlnsNs) {
        const declaredSystem = namespaceSystem(attribute.value);
        if (declaredSystem !== undefined && selected.has(declaredSystem)) {
          declarations.push(attribute);
        }
      } else {
        recordQNames(element, attribute.value);
      }
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        recordQNames(element, child.textContent ?? '');
      }
    }
    if (Object.keys(attributesNS).length > 0) {
      edits.push({ element, attributes: {}, attributesNS });
    }
  }
  // XML namespace usage is gone; retain declarations referenced by QName-valued metadata.
  for (const declaration of declarations) {
    if (declaration.ownerElement !== null && !qnameNamespaces.has(declaration.value)) {
      edits.push({
        element: declaration.ownerElement,
        attributes: {},
        attributesNS: { [xmlnsNs]: { [declaration.name]: null } },
      });
    }
  }
  return { edits: issues.length === 0 ? edits : [], issues };

  function recordQNames(element: Element, value: string): void {
    for (const match of value.matchAll(/\b([A-Za-z_][\w.-]*):[A-Za-z_]/g)) {
      const namespace = element.lookupNamespaceURI(match[1]);
      if (namespace !== null) {
        qnameNamespaces.add(namespace);
      }
    }
  }
}

export type CopyPlan = CoordinatePlan & {
  conflicts: number;
  copied: number;
  unchanged: number;
  notes: string[];
};

type Destination = {
  original?: Element;
  node: Element;
  changed: boolean;
  references: Map<string, Element[]>;
};

function sameLayout(left: Element, right: Element): boolean {
  const attributes = (element: Element) => Array.from(element.attributes)
    .filter(attribute => attribute.namespaceURI !== xmlnsNs)
    .map(attribute => [attribute.namespaceURI, attribute.localName, attribute.value])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return left.namespaceURI === right.namespaceURI && left.localName === right.localName &&
    JSON.stringify(attributes(left)) === JSON.stringify(attributes(right)) &&
    left.children.length === right.children.length &&
    Array.from(left.children).every((child, index) => sameLayout(child, right.children[index]));
}

function privateReference(container: Element): Node | null {
  // scl-lib's ordering helper uses tagName; normalize prefixed SCL in a detached view.
  const view = createElement(container.ownerDocument, container.localName, {});
  const children = Array.from(container.children);
  for (const child of children) {
    view.appendChild(child.namespaceURI === container.namespaceURI
      ? createElement(container.ownerDocument, child.localName, {}) : child.cloneNode(false));
  }
  const reference = getReference(view, 'Private');
  return reference instanceof Element
    ? children[Array.from(view.children).indexOf(reference)] : null;
}

function unusedPrefix(elements: Element[], base: string): string {
  const prefixes = new Set(elements.flatMap(element =>
    Array.from(element.attributes)
      .filter(attribute => attribute.namespaceURI === xmlnsNs)
      .map(attribute => attribute.localName)));
  let prefix = base;
  let suffix = 1;
  while (prefixes.has(prefix)) {
    prefix = `${base}${suffix++}`;
  }
  return prefix;
}

function rootIedIdentity(doc: XMLDocument, name: string): string {
  // identity() dispatches on tagName; normalize without modifying the source.
  const view = createElement(doc, 'IED', { name });
  createElement(doc, 'SCL', {}).appendChild(view);
  return String(identity(view));
}

/** Copies into detached layout sections, so planning cannot change the live document. */
export function copySldV1Plan(doc: XMLDocument, overwrite = false): CopyPlan {
  const issues: string[] = [];
  let conflicts = 0;
  let copied = 0;
  let unchanged = 0;
  let hasTextChanges = false;
  const sclNs = doc.documentElement.namespaceURI;
  const elements = allElements(doc);
  const substations = elements.filter(element => element.namespaceURI === sclNs &&
    element.localName === 'Substation' && element.parentElement === doc.documentElement);
  const ieds = new Map<string, Element[]>();
  for (const element of elements) {
    if (element.namespaceURI === sclNs && element.localName === 'IED' &&
        element.parentElement === doc.documentElement) {
      const name = element.getAttribute('name') ?? '';
      ieds.set(name, [...(ieds.get(name) ?? []), element]);
    }
  }
  const prefix = unusedPrefix(elements, 'eosld');
  const destinations = new Map<Element, Destination>();
  const handled = new Set<Element>();
  const linkedNames = new Set<string>();
  const linkedCoordinateNames = new Set<string>();
  let retainedCoords = 0;
  const copiedReferences = new Map<Element, Set<string>>();
  const copiedSections = new Set<Element>();

  function extension(localName: string): Element {
    return doc.createElementNS(sldNs, `${prefix}:${localName}`);
  }

  function destination(container: Element): Destination | undefined {
    const cached = destinations.get(container);
    if (cached !== undefined) {
      return cached;
    }
    const existing = Array.from(container.children).filter(child =>
      child.namespaceURI === sclNs && child.localName === 'Private' &&
      child.getAttribute('type') === privType);
    if (existing.length > 1) {
      issues.push(`Multiple SLD Private sections on ${container.localName} ${container.getAttribute('name') ?? ''}.`);
      return undefined;
    }
    const original = existing[0];
    const clone = original?.cloneNode(true);
    const node = clone instanceof Element ? clone : createElement(doc, 'Private', { type: privType });
    const references = new Map<string, Element[]>();
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI === sldNs && child.localName === 'Reference' &&
          child.getAttributeNS(sldNs, 'type') === 'IED') {
        const id = child.getAttributeNS(sldNs, 'id') ?? '';
        references.set(id, [...(references.get(id) ?? []), child]);
      }
    }
    const result = { original, node, changed: false, references };
    destinations.set(container, result);
    return result;
  }

  function writeAttributes(parent: Element, source: Element, target: Destination): void {
    const values = Array.from(source.attributes).filter(attribute =>
      attribute.namespaceURI === sldV1Ns && layoutKeys.includes(attribute.localName));
    if (values.length === 0) {
      return;
    }
    const existing = Array.from(parent.children).filter(child =>
      child.namespaceURI === sldNs && child.localName === 'SLDAttributes');
    if (existing.length > 1) {
      issues.push('Multiple SLDAttributes destinations; resolve duplicates before copying.');
      return;
    }
    if (existing.length > 0 && values.every(attribute =>
      existing[0].getAttributeNS(sldNs, attribute.localName) === attribute.value)) {
      unchanged += 1;
      return;
    }
    hasTextChanges ||= source.namespaceURI === sclNs && source.localName === 'Text';
    if (existing.some(record => Array.from(record.attributes).some(attribute =>
      attribute.namespaceURI === sldNs && layoutKeys.includes(attribute.localName)))) {
      conflicts += 1;
      if (!overwrite) {
        return;
      }
    }
    const node = existing[0] ?? extension('SLDAttributes');
    let changed = existing.length === 0;
    for (const attribute of values) {
      if (node.getAttributeNS(sldNs, attribute.localName) !== attribute.value) {
        node.setAttributeNS(sldNs, `${prefix}:${attribute.localName}`, attribute.value);
        changed = true;
      }
    }
    if (existing.length === 0) {
      parent.appendChild(node);
    }
    target.changed ||= changed;
    copied += 1;
  }

  function copyIed(source: Element, container: Element, name: string): void {
    if (!Array.from(source.attributes).some(attribute =>
      attribute.namespaceURI === sldV1Ns && layoutKeys.includes(attribute.localName))) {
      return;
    }
    const matches = ieds.get(name) ?? [];
    if (name === '' || matches.length !== 1) {
      issues.push(`Cannot uniquely resolve legacy IED "${name}".`);
      return;
    }
    const id = rootIedIdentity(doc, name);
    const seen = copiedReferences.get(container) ?? new Set<string>();
    if (seen.has(id)) {
      issues.push(`Multiple legacy placements for IED "${name}" in the same container.`);
      return;
    }
    seen.add(id);
    copiedReferences.set(container, seen);
    const target = destination(container);
    if (target === undefined) {
      return;
    }
    const references = target.references.get(id) ?? [];
    if (references.length > 1) {
      issues.push(`Duplicate destination references for IED "${name}".`);
      return;
    }
    const reference = references[0] ?? extension('Reference');
    if (references.length === 0) {
      reference.setAttributeNS(sldNs, `${prefix}:id`, id);
      reference.setAttributeNS(sldNs, `${prefix}:type`, 'IED');
      target.node.appendChild(reference);
      target.references.set(id, [reference]);
    }
    writeAttributes(reference, source, target);
  }

  function validateAttributes(element: Element, allowed: readonly string[]): void {
    const unknown = Array.from(element.attributes).filter(attribute =>
      attribute.namespaceURI === sldV1Ns && !allowed.includes(attribute.localName));
    if (unknown.length > 0) {
      issues.push(`Unsupported SLDv1 attributes on ${element.localName}: ${unknown.map(attribute => attribute.localName).join(', ')}.`);
    }
  }

  for (const element of elements.filter(candidate =>
    privateSystem(candidate) === 'sldv1' &&
    candidate.getAttribute('type') === 'OpenSCD-Linked-IEDs')) {
    handled.add(element);
    validateAttributes(element, []);
    for (const child of Array.from(element.children)) {
      handled.add(child);
      const name = child.getAttributeNS(sldV1Ns, 'name');
      validateAttributes(child, [...layoutKeys, 'name']);
      if (child.localName === 'IEDName' &&
          (child.namespaceURI === sclNs || child.namespaceURI === sldV1Ns) &&
          name !== null && child.children.length === 0 && element.parentElement !== null &&
          element.parentElement.namespaceURI === sclNs &&
          ['Substation', 'VoltageLevel', 'Bay'].includes(element.parentElement.localName)) {
        linkedNames.add(name);
        if (Array.from(child.attributes).some(attribute =>
          attribute.namespaceURI === sldV1Ns && layoutKeys.includes(attribute.localName))) {
          linkedCoordinateNames.add(name);
        }
        copyIed(child, element.parentElement, name);
      } else {
        issues.push('Unsupported entry or container in OpenSCD-Linked-IEDs.');
      }
    }
  }
  for (const source of elements.filter(element =>
    element.namespaceURI === sclNs && element.localName === 'Private' &&
    element.getAttribute('type') === 'OpenSCD-Coords')) {
    const records = Array.from(source.children).filter(child =>
      child.namespaceURI === sldV1Ns && child.localName === 'Coords');
    if (records.length === 0) {
      continue;
    }
    handled.add(source);
    validateAttributes(source, []);
    for (const record of records) {
      handled.add(record);
      validateAttributes(record, layoutKeys);
    }
    const owner = source.parentElement;
    if (records.length !== 1 || records[0].children.length > 0 ||
        owner?.namespaceURI !== sclNs || owner.localName !== 'IED' ||
        owner.parentElement !== doc.documentElement) {
      issues.push('Ambiguous or unsupported OpenSCD-Coords container.');
      continue;
    }
    const name = owner.getAttribute('name') ?? '';
    if (!linkedCoordinateNames.has(name)) {
      issues.push(`Legacy Coords for IED "${name}" has no scoped linked placement; its destination must be resolved before copying.`);
      continue;
    }
    retainedCoords += 1;
  }
  for (const source of elements.filter(element =>
    privateSystem(element) === 'sldv1' &&
    element.getAttribute('type') === 'Transpower-SLD-Vertices')) {
    handled.add(source);
    validateAttributes(source, []);
    const container = source.parentElement;
    if (container === null || container.localName !== 'ConnectivityNode' ||
        container.namespaceURI !== sclNs || copiedSections.has(container)) {
      issues.push('Ambiguous or unsupported Transpower-SLD-Vertices container.');
      continue;
    }
    copiedSections.add(container);
    if (source.children.length === 0) {
      continue;
    }
    const target = destination(container);
    if (target === undefined) {
      continue;
    }
    const converted: Element[] = [];
    for (const section of Array.from(source.children)) {
      handled.add(section);
      if (section.namespaceURI !== sldV1Ns || section.localName !== 'Section') {
        issues.push('Unsupported content in Transpower-SLD-Vertices.');
        continue;
      }
      validateAttributes(section, ['bus']);
      if (section.hasAttribute('bus') && section.hasAttributeNS(sldV1Ns, 'bus') &&
          section.getAttribute('bus') !== section.getAttributeNS(sldV1Ns, 'bus')) {
        issues.push('Conflicting legacy connectivity bus flags.');
      }
      const node = extension('Section');
      for (const attribute of Array.from(section.attributes)) {
        if (attribute.namespaceURI === xmlnsNs) {
          continue;
        }
        if ((attribute.namespaceURI === null && attribute.localName === 'bus') ||
            attribute.namespaceURI === sldV1Ns) {
          node.setAttributeNS(sldNs, `${prefix}:${attribute.localName}`, attribute.value);
        } else {
          issues.push('Unsupported attribute on a legacy connectivity section.');
        }
      }
      for (const vertex of Array.from(section.children)) {
        handled.add(vertex);
        if (vertex.namespaceURI !== sldV1Ns || vertex.localName !== 'Vertex' ||
            vertex.children.length > 0) {
          issues.push('Unsupported connectivity vertex.');
          continue;
        }
        validateAttributes(vertex, ['x', 'y', 'uuid']);
        const copy = extension('Vertex');
        for (const attribute of Array.from(vertex.attributes)) {
          if (attribute.namespaceURI === sldV1Ns) {
            copy.setAttributeNS(sldNs, `${prefix}:${attribute.localName}`, attribute.value);
          } else if (attribute.namespaceURI !== xmlnsNs) {
            issues.push('Unsupported attribute on a legacy connectivity vertex.');
          }
        }
        node.appendChild(copy);
      }
      converted.push(node);
    }
    const existing = Array.from(target.node.children).filter(child =>
      child.namespaceURI === sldNs && child.localName === 'Section');
    if (converted.length > 0 && existing.length === converted.length &&
        existing.every((section, index) => sameLayout(section, converted[index]))) {
      unchanged += 1;
      continue;
    }
    if (existing.length > 0) {
      conflicts += 1;
      if (!overwrite) {
        continue;
      }
    }
    if (converted.length > 0) {
      copied += 1;
      if (existing.some(section => [section, ...Array.from(section.getElementsByTagName('*'))]
        .some(child => child.namespaceURI !== sldNs ||
          Array.from(child.attributes).some(attribute => attribute.namespaceURI !== sldNs &&
            attribute.namespaceURI !== xmlnsNs)))) {
        issues.push('Destination connectivity sections contain unrelated content; overwrite was blocked.');
        continue;
      }
      for (const section of existing) {
        section.remove();
      }
      target.node.append(...converted);
      target.changed = true;
    }
  }
  for (const element of elements) {
    if (handled.has(element)) {
      continue;
    }
    const attributes = Array.from(element.attributes).filter(attribute => attribute.namespaceURI === sldV1Ns);
    if (attributes.length === 0 && element.namespaceURI !== sldV1Ns) {
      continue;
    }
    validateAttributes(element, layoutKeys);
    if (element.namespaceURI !== sclNs) {
      issues.push(`Unsupported SLDv1 coordinate owner: ${element.localName}.`);
    } else if (element.localName === 'IED' && element.parentElement === doc.documentElement) {
      const name = element.getAttribute('name') ?? '';
      if (linkedNames.has(name)) {
        issues.push(`IED "${name}" has both direct and linked legacy coordinates; choose a source first.`);
      } else if (substations.length !== 1) {
        issues.push(`Direct legacy IED "${name}" needs exactly one Substation for unambiguous placement.`);
      } else {
        copyIed(element, substations[0], name);
      }
    } else if (plantTags.has(element.localName)) {
      const target = destination(element);
      if (target !== undefined) {
        writeAttributes(target.node, element, target);
      }
    } else {
      issues.push(`Unsupported SLDv1 coordinate owner: ${element.localName}.`);
    }
  }
  const edits: EditV2[] = [];
  for (const [container, target] of destinations) {
    if (!target.changed) {
      continue;
    }
    const reference = target.original !== undefined
      ? target.original.nextSibling : privateReference(container);
    if (target.original !== undefined) {
      edits.push({ node: target.original });
    }
    edits.push({ parent: container, node: target.node, reference });
  }
  if (edits.length > 0) {
    edits.unshift({
      element: doc.documentElement,
      attributes: {},
      attributesNS: { [xmlnsNs]: { [`xmlns:${prefix}`]: sldNs } },
    });
  }
  const notes = retainedCoords > 0
    ? [`Scoped linked IED placements take precedence over ${retainedCoords} legacy Coords record(s), which are retained unchanged.`]
    : [];
  if (hasTextChanges) {
    notes.push('Copying Text layout to SLD Private uses a Private child inside Text for editor compatibility. This representation violates the SCL schema.');
  }
  return { edits: issues.length === 0 ? edits : [], conflicts, copied, unchanged, issues, notes };
}

/** Exports existing geometry without repositioning elements or removing source data. */
export function copySldPrivatePlan(doc: XMLDocument, overwrite = false): CopyPlan {
  const elements = allElements(doc);
  const sclNs = doc.documentElement.namespaceURI;
  const prefix = unusedPrefix(elements, 'esld');
  const issues: string[] = [];
  const edits: EditV2[] = [];
  let conflicts = 0;
  let copied = 0;
  let unchanged = 0;
  const handled = new Set<Element>();
  const ieds = new Map<string, Element[]>();
  const substations = elements.filter(element => element.namespaceURI === sclNs &&
    element.localName === 'Substation' && element.parentElement === doc.documentElement);
  const sourcePlacements = new Map<string, number>();
  const linkedNames = new Set<string>();
  const destinations = new Map<Element, Map<string, Destination>>();

  for (const element of elements) {
    if (element.namespaceURI === sclNs && element.localName === 'IED' &&
        element.parentElement === doc.documentElement) {
      const name = element.getAttribute('name') ?? '';
      const id = rootIedIdentity(doc, name);
      ieds.set(id, [...(ieds.get(id) ?? []), element]);
    }
    if (element.namespaceURI === sldNs && element.localName === 'Reference') {
      const id = element.getAttributeNS(sldNs, 'id') ?? '';
      sourcePlacements.set(id, (sourcePlacements.get(id) ?? 0) + 1);
    }
    if (element.localName === 'IEDName' &&
        (element.namespaceURI === sclNs || element.namespaceURI === sldV1Ns) &&
        element.parentElement?.getAttribute('type') === 'OpenSCD-Linked-IEDs' &&
        privateSystem(element.parentElement) === 'sldv1') {
      linkedNames.add(element.getAttributeNS(sldV1Ns, 'name') ?? '');
    }
  }

  function sourceAttributes(element: Element, allowed: readonly string[]): Attr[] {
    handled.add(element);
    const attributes = Array.from(element.attributes).filter(attribute =>
      attribute.namespaceURI === sldNs);
    const unknown = attributes.filter(attribute => !allowed.includes(attribute.localName));
    if (unknown.length > 0) {
      issues.push(`Unsupported SLD Private attributes on ${element.localName}: ${unknown.map(attribute => attribute.localName).join(', ')}.`);
    }
    return attributes.filter(attribute => allowed.includes(attribute.localName));
  }

  function destination(container: Element, type: string): Destination | undefined {
    const cache = destinations.get(container) ?? new Map<string, Destination>();
    destinations.set(container, cache);
    const cached = cache.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const matches = Array.from(container.children).filter(child =>
      child.namespaceURI === sclNs && child.localName === 'Private' &&
      child.getAttribute('type') === type);
    if (matches.length > 1) {
      issues.push(`Multiple ${type} destinations on ${container.localName}.`);
      return undefined;
    }
    const original = matches[0];
    const clone = original?.cloneNode(true);
    const node = clone instanceof Element ? clone : createElement(doc, 'Private', { type });
    const result: Destination = { original, node, changed: false, references: new Map() };
    cache.set(type, result);
    return result;
  }

  function writeAttributes(target: Element, values: Attr[], detached?: Destination): void {
    if (values.length === 0) {
      return;
    }
    const changed = values.filter(attribute =>
      target.getAttributeNS(sldV1Ns, attribute.localName) !== attribute.value);
    if (changed.length === 0) {
      unchanged += 1;
      return;
    }
    const exists = Array.from(target.attributes).some(attribute =>
      attribute.namespaceURI === sldV1Ns && layoutKeys.includes(attribute.localName));
    if (exists) {
      conflicts += 1;
      if (!overwrite) {
        return;
      }
    }
    copied += 1;
    if (detached !== undefined) {
      changed.forEach(attribute =>
        target.setAttributeNS(sldV1Ns, `${prefix}:${attribute.localName}`, attribute.value));
      detached.changed = true;
    } else {
      edits.push({
        element: target,
        attributes: {},
        attributesNS: {
          [sldV1Ns]: Object.fromEntries(changed.map(attribute =>
            [`${prefix}:${attribute.localName}`, attribute.value])),
        },
      });
    }
  }

  function layoutValues(parent: Element): Attr[] {
    const records = Array.from(parent.children).filter(child =>
      child.namespaceURI === sldNs && child.localName === 'SLDAttributes');
    if (records.length > 1) {
      issues.push(`Multiple SLDAttributes sources on ${parent.localName}.`);
    }
    const values = records.flatMap((record) => {
      if (record.children.length > 0) {
        issues.push('Unsupported children in SLDAttributes.');
      }
      return sourceAttributes(record, layoutKeys);
    });
    return values;
  }

  function copyIed(reference: Element, container: Element, seen: Set<string>): void {
    sourceAttributes(reference, ['id', 'type']);
    const id = reference.getAttributeNS(sldNs, 'id') ?? '';
    const matches = ieds.get(id) ?? [];
    if (reference.getAttributeNS(sldNs, 'type') !== 'IED' || matches.length !== 1 ||
        id === '' || !['Substation', 'VoltageLevel', 'Bay'].includes(container.localName)) {
      issues.push(`Cannot uniquely export SLD Private reference "${id}" from ${container.localName}.`);
      return;
    }
    if (seen.has(id)) {
      issues.push(`Duplicate source references for IED "${id}" in the same container.`);
      return;
    }
    seen.add(id);
    if (Array.from(reference.children).some(child =>
      child.namespaceURI !== sldNs || child.localName !== 'SLDAttributes')) {
      issues.push(`Unsupported children in IED reference "${id}".`);
    }
    const values = layoutValues(reference);
    if (values.length === 0) {
      return;
    }
    const ied = matches[0];
    const name = ied.getAttribute('name') ?? '';
    const direct = Array.from(ied.attributes).some(attribute =>
      attribute.namespaceURI === sldV1Ns && layoutKeys.includes(attribute.localName));
    if (direct) {
      if (linkedNames.has(name) || substations.length !== 1 ||
          container !== substations[0] || sourcePlacements.get(id) !== 1) {
        issues.push(`Competing or ambiguous direct legacy placement for IED "${name}".`);
        return;
      }
      writeAttributes(ied, values);
      return;
    }
    const target = destination(container, 'OpenSCD-Linked-IEDs');
    if (target === undefined) {
      return;
    }
    const entries = Array.from(target.node.children).filter(child =>
      child.localName === 'IEDName' &&
      (child.namespaceURI === sclNs || child.namespaceURI === sldV1Ns) &&
      child.getAttributeNS(sldV1Ns, 'name') === name);
    if (entries.length > 1) {
      issues.push(`Duplicate legacy destination entries for IED "${name}".`);
      return;
    }
    const entry = entries[0] ?? doc.createElementNS(sldV1Ns, `${prefix}:IEDName`);
    if (entries.length === 0) {
      entry.setAttributeNS(sldV1Ns, `${prefix}:name`, name);
      target.node.appendChild(entry);
    }
    writeAttributes(entry, values, target);
  }

  function copySections(sections: Element[], container: Element): void {
    if (sections.length === 0) {
      return;
    }
    if (container.localName !== 'ConnectivityNode') {
      issues.push('SLD Private connectivity sections must belong to a ConnectivityNode.');
      return;
    }
    const converted = sections.map((section) => {
      const node = doc.createElementNS(sldV1Ns, `${prefix}:Section`);
      sourceAttributes(section, ['bus']).forEach(attribute =>
        node.setAttribute('bus', attribute.value));
      for (const vertex of Array.from(section.children)) {
        if (vertex.namespaceURI !== sldNs || vertex.localName !== 'Vertex' ||
            vertex.children.length > 0) {
          issues.push('Unsupported SLD Private connectivity vertex.');
          continue;
        }
        const copy = doc.createElementNS(sldV1Ns, `${prefix}:Vertex`);
        sourceAttributes(vertex, ['x', 'y', 'uuid']).forEach(attribute =>
          copy.setAttributeNS(sldV1Ns, `${prefix}:${attribute.localName}`, attribute.value));
        node.appendChild(copy);
      }
      return node;
    });
    const target = destination(container, 'Transpower-SLD-Vertices');
    if (target === undefined) {
      return;
    }
    const existing = Array.from(target.node.children).filter(child =>
      child.namespaceURI === sldV1Ns && child.localName === 'Section');
    if (existing.length === converted.length &&
        existing.every((section, index) => sameLayout(section, converted[index]))) {
      unchanged += 1;
      return;
    }
    if (existing.length > 0) {
      conflicts += 1;
      if (!overwrite) {
        return;
      }
    }
    copied += 1;
    if (existing.some(section => [section, ...Array.from(section.getElementsByTagName('*'))]
      .some(child => child.namespaceURI !== sldV1Ns ||
        Array.from(child.attributes).some(attribute => attribute.namespaceURI !== sldV1Ns &&
          attribute.namespaceURI !== xmlnsNs &&
          !(child === section && attribute.namespaceURI === null && attribute.localName === 'bus'))))) {
      issues.push('Legacy connectivity sections contain unrelated content; overwrite was blocked.');
      return;
    }
    existing.forEach(section => section.remove());
    target.node.append(...converted);
    target.changed = true;
  }

  const containers = new Set<Element>();
  for (const source of elements.filter(element => privateSystem(element) === 'sldpriv')) {
    sourceAttributes(source, []);
    const container = source.parentElement;
    if (container === null || container.namespaceURI !== sclNs ||
        !plantTags.has(container.localName) || containers.has(container)) {
      issues.push('Duplicate or unsupported SLD Private source container.');
      continue;
    }
    containers.add(container);
    writeAttributes(container, layoutValues(source));
    const seen = new Set<string>();
    for (const child of Array.from(source.children)) {
      if (child.namespaceURI === sldNs && child.localName === 'Reference') {
        copyIed(child, container, seen);
      }
    }
    copySections(Array.from(source.children).filter(child =>
      child.namespaceURI === sldNs && child.localName === 'Section'), container);
  }
  for (const element of elements) {
    if (!handled.has(element) && (element.namespaceURI === sldNs ||
        Array.from(element.attributes).some(attribute => attribute.namespaceURI === sldNs))) {
      issues.push(`Unsupported SLD Private content on ${element.localName}.`);
    }
  }
  for (const [container, targets] of destinations) {
    for (const target of targets.values()) {
      if (target.changed) {
        const reference = target.original !== undefined
          ? target.original.nextSibling : privateReference(container);
        if (target.original !== undefined) {
          edits.push({ node: target.original });
        }
        edits.push({ parent: container, node: target.node, reference });
      }
    }
  }
  if (edits.length > 0) {
    edits.unshift({
      element: doc.documentElement,
      attributes: {},
      attributesNS: { [xmlnsNs]: { [`xmlns:${prefix}`]: sldV1Ns } },
    });
  }
  return { edits: issues.length === 0 ? edits : [], issues, conflicts, copied, unchanged, notes: [] };
}
