import { createElement } from '@openscd/scl-lib/dist/foundation/utils.js';

import { privateReference, sxyNs, unusedPrefix } from './coordinate-systems.js';
import { privType, sldNs, xmlnsNs } from './layout-util.js';

import type { CopyPlan } from './coordinate-systems.js';
import type { EditV2 } from '@openscd/oscd-api';

type Point = readonly [number, number];
type Target = { original?: Element; node: Element; record: Element; changed: boolean };

const owners = new Set([
  'Substation', 'VoltageLevel', 'Bay', 'ConductingEquipment', 'PowerTransformer', 'ConnectivityNode',
]);
const containers = new Set(['Substation', 'VoltageLevel', 'Bay']);
const axes = ['x', 'y'] as const;

function description(element: Element): string {
  return `${element.localName} ${element.getAttribute('name') ?? ''}`.trim();
}

function children(element: Element, ns: string | null, name: string): Element[] {
  return Array.from(element.children).filter(child => child.namespaceURI === ns && child.localName === name);
}

function numberValue(value: string | null, integer: boolean, owner: Element, issues: string[]): number {
  if (value === null) {
    return 0;
  }
  const text = value.trim();
  const valid = integer ? /^[+-]?\d+$/.test(text) : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
  const number = Number(text);
  if (!valid || !Number.isFinite(number) ||
      (integer && (number < -2147483648 || number > 2147483647))) {
    issues.push(`Invalid ${integer ? 'SXY integer' : 'SLD position'} "${value}" on ${description(owner)}.`);
    return 0;
  }
  return number;
}

function position(record: Element, ns: string, integer: boolean, owner: Element, issues: string[]): Point {
  return [
    numberValue(record.getAttributeNS(ns, 'x'), integer, owner, issues),
    numberValue(record.getAttributeNS(ns, 'y'), integer, owner, issues),
  ];
}

function hasPosition(record: Element, ns: string): boolean {
  return axes.some(axis => record.hasAttributeNS(ns, axis));
}

function plantElements(doc: XMLDocument): Element[] {
  const ns = doc.documentElement.namespaceURI;
  const result: Element[] = [];
  function visit(element: Element): void {
    if (element.namespaceURI !== ns || element.localName === 'Private') {
      return;
    }
    result.push(element);
    Array.from(element.children).forEach(visit);
  }
  children(doc.documentElement, ns, 'Substation').forEach(visit);
  return result;
}

function pointMatches(record: Element, ns: string, point: Point): boolean {
  return hasPosition(record, ns) && axes.every((axis, index) => {
    const value = record.getAttributeNS(ns, axis);
    return value === null ? point[index] === 0 : value.trim() !== '' && Number(value) === point[index];
  });
}

function notesFor(ignored: number, points: number): string[] {
  const notes: string[] = [];
  if (ignored > 0) {
    notes.push(`${ignored} source layout record(s) contain information outside the supported plant-position mapping. Only supported x/y positions are copied; direction, rotation, labels, styling, dimensions, IED placements, and connection paths are not converted.`);
  }
  if (points > 0) {
    notes.push(`${points} ConnectivityNode position(s) are point metadata, not connection paths. No wires or busbar routes are generated.`);
  }
  return notes;
}

/** IEC Annex C positions are parent-relative; SLD Private positions are absolute. */
export function copySxyPlan(doc: XMLDocument, overwrite = false): CopyPlan {
  const elements = plantElements(doc);
  const all = [doc.documentElement, ...Array.from(doc.documentElement.getElementsByTagName('*'))];
  const prefix = unusedPrefix(all, 'eosld');
  const ns = doc.documentElement.namespaceURI;
  const issues: string[] = [];
  const edits: EditV2[] = [];
  const offsets = new Map<Element, Point>();
  const targets = new Map<Element, Target>();
  const accepted = new Set<Element>();
  let conflicts = 0;
  let copied = 0;
  let unchanged = 0;
  let ignored = 0;
  let points = 0;

  function target(owner: Element): Target | undefined {
    const cached = targets.get(owner);
    if (cached !== undefined) {
      return cached;
    }
    const privates = children(owner, ns, 'Private').filter(child => child.getAttribute('type') === privType);
    const records = privates.flatMap(priv => children(priv, sldNs, 'SLDAttributes'));
    if (privates.length > 1 || records.length > 1) {
      issues.push(`Multiple SLD Private destinations on ${description(owner)}.`);
      return undefined;
    }
    const original = privates[0];
    const clone = original?.cloneNode(true);
    const node = clone instanceof Element ? clone : createElement(doc, 'Private', { type: privType });
    const record = children(node, sldNs, 'SLDAttributes')[0] ??
      doc.createElementNS(sldNs, `${prefix}:SLDAttributes`);
    if (record.parentElement === null) {
      node.appendChild(record);
    }
    const result = { original, node, record, changed: false };
    targets.set(owner, result);
    return result;
  }

  for (const owner of elements) {
    const parent = owner.parentElement === null ? [0, 0] : offsets.get(owner.parentElement) ?? [0, 0];
    const relative = position(owner, sxyNs, true, owner, issues);
    const absolute: Point = [parent[0] + relative[0], parent[1] + relative[1]];
    offsets.set(owner, absolute);
    const source = Array.from(owner.attributes).filter(attribute => attribute.namespaceURI === sxyNs);
    if (source.some(attribute => !axes.some(axis => axis === attribute.localName)) ||
        (source.length > 0 && !owners.has(owner.localName))) {
      ignored += 1;
    }
    if (!owners.has(owner.localName) || !hasPosition(owner, sxyNs)) {
      continue;
    }
    if (absolute.some(value => !Number.isSafeInteger(value) || value < 0)) {
      issues.push(`The absolute SXY position of ${description(owner)} cannot be represented as a nonnegative SLD position.`);
      continue;
    }
    const destination = target(owner);
    if (destination === undefined) {
      continue;
    }
    if (pointMatches(destination.record, sldNs, absolute)) {
      unchanged += 1;
      accepted.add(owner);
      continue;
    }
    if (hasPosition(destination.record, sldNs)) {
      conflicts += 1;
      if (!overwrite) {
        continue;
      }
    }
    axes.forEach((axis, index) =>
      destination.record.setAttributeNS(sldNs, `${prefix}:${axis}`, String(absolute[index])));
    destination.changed = true;
    accepted.add(owner);
    copied += 1;
    if (owner.localName === 'ConnectivityNode') {
      points += 1;
    }
  }

  // Bounds use effective destination positions, including retained conflicting layouts.
  const bounds = new Map<Element, Point>();
  const needsBounds = new Set<Element>();
  for (const owner of accepted) {
    let ancestor: Element | null = owner;
    while (ancestor !== null && ancestor !== doc.documentElement) {
      if (containers.has(ancestor.localName)) {
        needsBounds.add(ancestor);
      }
      ancestor = ancestor.parentElement;
    }
  }
  for (const owner of [...elements].reverse()) {
    const existing = children(owner, ns, 'Private').filter(child => child.getAttribute('type') === privType);
    const record = targets.get(owner)?.record ?? existing.flatMap(priv => children(priv, sldNs, 'SLDAttributes'))[0];
    if (record === undefined && !needsBounds.has(owner)) {
      continue;
    }
    const origin = record === undefined ? [0, 0] : position(record, sldNs, false, owner, issues);
    const extent = bounds.get(owner) ?? [origin[0] + 1, origin[1] + 1];
    const dimensions = ['w', 'h'].map((axis, index) => {
      const value = record?.getAttributeNS(sldNs, axis);
      if (value === null || value === undefined) {
        return Math.max(1, Math.ceil(extent[index] -
          (owner.localName === 'Substation' ? 0 : origin[index])));
      }
      const dimension = numberValue(value, false, owner, issues);
      if (dimension < 1) {
        issues.push(`Invalid SLD dimension on ${description(owner)}.`);
      }
      return dimension;
    });
    if (needsBounds.has(owner)) {
      const destination = target(owner);
      if (destination !== undefined) {
        let changed = false;
        ['w', 'h'].forEach((axis, index) => {
          if (!destination.record.hasAttributeNS(sldNs, axis)) {
            destination.record.setAttributeNS(sldNs, `${prefix}:${axis}`, String(dimensions[index]));
            changed = true;
          }
        });
        if (changed && !destination.changed) {
          copied += 1;
          if (accepted.has(owner)) {
            unchanged -= 1;
          }
        }
        destination.changed ||= changed;
      }
    }
    const parent = owner.parentElement;
    if (parent !== null) {
      const previous = bounds.get(parent) ?? [0, 0];
      bounds.set(parent, [
        Math.max(previous[0], origin[0] + dimensions[0], extent[0]),
        Math.max(previous[1], origin[1] + dimensions[1], extent[1]),
      ]);
    }
  }
  for (const [owner, destination] of targets) {
    if (!destination.changed) {
      continue;
    }
    const reference = destination.original?.nextSibling ?? privateReference(owner);
    if (destination.original !== undefined) {
      edits.push({ node: destination.original });
    }
    edits.push({ parent: owner, node: destination.node, reference });
  }
  if (edits.length > 0) {
    edits.unshift({
      element: doc.documentElement, attributes: {},
      attributesNS: { [xmlnsNs]: { [`xmlns:${prefix}`]: sldNs } },
    });
  }
  return { edits: issues.length === 0 ? edits : [], issues, copied, conflicts, unchanged, notes: notesFor(ignored, points) };
}

/** Export changes only explicit source positions, never compensating retained children. */
export function copyPrivateToSxyPlan(doc: XMLDocument, overwrite = false): CopyPlan {
  const all = [doc.documentElement, ...Array.from(doc.documentElement.getElementsByTagName('*'))];
  const prefix = unusedPrefix(all, 'sxy');
  const ns = doc.documentElement.namespaceURI;
  const issues: string[] = [];
  const edits: EditV2[] = [];
  const offsets = new Map<Element, Point>();
  let copied = 0;
  let conflicts = 0;
  let unchanged = 0;
  let ignored = 0;
  let rounded = 0;

  for (const owner of plantElements(doc)) {
    const parent = owner.parentElement === null ? [0, 0] : offsets.get(owner.parentElement) ?? [0, 0];
    const existing = position(owner, sxyNs, true, owner, issues);
    let effective: Point = [parent[0] + existing[0], parent[1] + existing[1]];
    const privates = children(owner, ns, 'Private').filter(child => child.getAttribute('type') === privType);
    const records = privates.flatMap(priv => children(priv, sldNs, 'SLDAttributes'));
    if (privates.some(priv => Array.from(priv.children).some(child =>
      child.namespaceURI === sldNs && child.localName !== 'SLDAttributes')) ||
        records.some(record => Array.from(record.attributes).some(attribute =>
          attribute.namespaceURI === sldNs && !axes.some(axis => axis === attribute.localName))) ||
        (privates.length > 0 && !owners.has(owner.localName))) {
      ignored += 1;
    }
    if (records.some(record => hasPosition(record, sldNs)) && owners.has(owner.localName)) {
      if (privates.length > 1 || records.length > 1) {
        issues.push(`Multiple SLD Private position sources on ${description(owner)}.`);
      } else {
        const absolute = position(records[0], sldNs, false, owner, issues);
        const quantized = absolute.map(value => Math.round(value));
        const relative: Point = [quantized[0] - parent[0], quantized[1] - parent[1]];
        if (absolute.some((value, index) => value !== quantized[index])) {
          rounded += 1;
        }
        if (absolute.some(value => value < 0) ||
            relative.some(value => !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
          issues.push(`The SLD position of ${description(owner)} cannot be represented as SXY integers.`);
        } else if (pointMatches(owner, sxyNs, relative)) {
          unchanged += 1;
        } else {
          const conflict = hasPosition(owner, sxyNs);
          if (conflict) {
            conflicts += 1;
          }
          if (!conflict || overwrite) {
            edits.push({
              element: owner, attributes: {},
              attributesNS: { [sxyNs]: { [`${prefix}:x`]: String(relative[0]), [`${prefix}:y`]: String(relative[1]) } },
            });
            effective = [quantized[0], quantized[1]];
            copied += 1;
          }
        }
      }
    }
    offsets.set(owner, effective);
  }
  if (edits.length > 0) {
    edits.unshift({
      element: doc.documentElement, attributes: {},
      attributesNS: { [xmlnsNs]: { [`xmlns:${prefix}`]: sxyNs } },
    });
  }
  const notes = notesFor(ignored, 0);
  if (rounded > 0 && (copied > 0 || conflicts > 0)) {
    notes.unshift(`${rounded} source position(s) use fractional values, represented by rounding to the nearest integer in SXY. Fractional positions cannot be represented exactly; rounding can change spacing or make positions coincide.`);
  }
  return { edits: issues.length === 0 ? edits : [], issues, copied, conflicts, unchanged, notes };
}
