import { expect } from '@open-wc/testing';
import { XMLEditor } from '@openscd/oscd-editor';

import { cleanCoordinatePlan, sldV1Ns, sxyNs } from './coordinate-systems.js';
import { privType, sldNs, xmlnsNs } from './layout-util.js';
import { copyPrivateToSxyPlan, copySxyPlan } from './sxy-coordinates.js';

const sclNs = 'http://www.iec.ch/61850/2003/SCL';

function parse(body: string): XMLDocument {
  return new DOMParser().parseFromString(
    `<SCL xmlns="${sclNs}" xmlns:xy="${sxyNs}" xmlns:n="${sldNs}"
      xmlns:old="${sldV1Ns}" xmlns:vendor="urn:vendor">${body}</SCL>`, 'application/xml',
  );
}

function layout(values: string): string {
  return `<Private type="${privType}"><n:SLDAttributes ${values}/></Private>`;
}

function record(owner: Element): Element {
  const found = Array.from(owner.children).find(child =>
    child.localName === 'Private' && child.getAttribute('type') === privType);
  const result = Array.from(found?.children ?? []).find(child =>
    child.namespaceURI === sldNs && child.localName === 'SLDAttributes');
  if (result === undefined) {
    throw new Error('Missing layout record');
  }
  return result;
}

describe('SXY position copying', () => {
  it('accumulates nested offsets, single axes, zeros and negative relative values without changing source or vendor data', () => {
    const doc = parse(`<Substation name="S" xy:x="12" xy:y="4" x="900" vendor:x="700" old:x="600">
      <VoltageLevel name="V"><Bay name="B">
        <ConductingEquipment name="Q" type="DIS" xy:y="-1"/>
        <ConnectivityNode name="N" pathName="S/V/B/N" xy:x="3" xy:y="12"/>
        <vendor:Bay xy:x="800"/>
      </Bay></VoltageLevel></Substation>`);
    const before = doc.documentElement.cloneNode(true);
    const plan = copySxyPlan(doc);
    expect(plan.issues).to.deep.equal([]);
    expect(doc.documentElement.isEqualNode(before)).to.equal(true);
    const editor = new XMLEditor();
    editor.commit(plan.edits);
    const q = doc.querySelector('ConductingEquipment')!;
    const position = record(q);
    expect(position.getAttributeNS(sldNs, 'x')).to.equal('12');
    expect(position.getAttributeNS(sldNs, 'y')).to.equal('3');
    expect(q.getAttributeNS(sxyNs, 'y')).to.equal('-1');
    const s = doc.querySelector('Substation')!;
    expect(record(s).getAttributeNS(sldNs, 'w')).to.equal('16');
    expect(record(s).getAttributeNS(sldNs, 'h')).to.equal('17');
    expect(s.getAttribute('x')).to.equal('900');
    expect(s.getAttributeNS('urn:vendor', 'x')).to.equal('700');
    expect(s.getAttributeNS(sldV1Ns, 'x')).to.equal('600');
    expect(doc.getElementsByTagNameNS('urn:vendor', 'Bay')[0].children).to.have.lengthOf(0);
    expect(doc.getElementsByTagNameNS(sldNs, 'Section')).to.have.lengthOf(0);
    expect(plan.notes.join(' ')).to.contain('point metadata');
    expect(copySxyPlan(doc).edits).to.deep.equal([]);
    const after = doc.documentElement.cloneNode(true);
    editor.undo();
    expect(doc.documentElement.isEqualNode(before)).to.equal(true);
    editor.redo();
    expect(doc.documentElement.isEqualNode(after)).to.equal(true);
  });

  for (const overwrite of [false, true]) {
    it(`imports with ${overwrite ? 'overwrite' : 'skip'}, retaining dimensions and other destination fields`, () => {
      const doc = parse(`<Substation name="S" xy:x="0" xy:y="0">
        ${layout('n:x="0" n:y="0" n:w="80" n:h="60"')}
        <VoltageLevel name="V"><Bay name="B" xy:x="10" xy:y="5">
          ${layout('n:x="20" n:y="8" n:rot="2" n:color="blue" n:w="40" n:h="30"')}
          <ConductingEquipment name="Q" type="DIS" xy:x="2" xy:y="3"/>
        </Bay></VoltageLevel></Substation>`);
      const plan = copySxyPlan(doc, overwrite);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.conflicts).to.equal(1);
      new XMLEditor().commit(plan.edits);
      const bay = record(doc.querySelector('Bay')!);
      expect(bay.getAttributeNS(sldNs, 'x')).to.equal(overwrite ? '10' : '20');
      expect(bay.getAttributeNS(sldNs, 'w')).to.equal('40');
      expect(bay.getAttributeNS(sldNs, 'rot')).to.equal('2');
      expect(bay.getAttributeNS(sldNs, 'color')).to.equal('blue');
      expect(record(doc.querySelector('Substation')!).getAttributeNS(sldNs, 'w')).to.equal('80');
      expect(record(doc.querySelector('ConductingEquipment')!).getAttributeNS(sldNs, 'x')).to.equal('12');
    });
  }

  it('ignores declarations, empty wrappers, direction-only data and communication placements as position sources', () => {
    const doc = parse(`<Substation name="S" xy:dir="horizontal">
      <VoltageLevel name="V"><Bay name="B">${layout('n:rot="1"')}</Bay></VoltageLevel>
      </Substation><IED name="A" xy:x="8" xy:y="9"/>`);
    const imported = copySxyPlan(doc);
    expect(imported.edits).to.deep.equal([]);
    expect(imported.copied).to.equal(0);
    expect(imported.notes.join(' ')).to.contain('direction');
    const exported = copyPrivateToSxyPlan(doc);
    expect(exported.edits).to.deep.equal([]);
    expect(exported.copied).to.equal(0);
  });

  it('supports prefixed SCL and collision-free namespace declarations, retaining valid Private ordering', () => {
    const doc = new DOMParser().parseFromString(
      `<s:SCL xmlns:s="${sclNs}" xmlns:p="${sxyNs}" xmlns:eosld="urn:vendor">
        <s:Substation name="S" p:x="0" p:y="0"><s:Text>keep</s:Text>
          <s:VoltageLevel name="V" xmlns:eosld1="urn:other" p:x="2" p:y="3"/>
        </s:Substation></s:SCL>`, 'application/xml',
    );
    const plan = copySxyPlan(doc);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    const s = doc.getElementsByTagNameNS(sclNs, 'Substation')[0];
    expect(Array.from(s.children).map(child => child.localName)).to.deep.equal(['Text', 'Private', 'VoltageLevel']);
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'eosld')).to.equal('urn:vendor');
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'eosld2')).to.equal(sldNs);
    const reparsed = new DOMParser().parseFromString(new XMLSerializer().serializeToString(doc), 'application/xml');
    expect(reparsed.querySelector('parsererror')).to.equal(null);
    expect(record(reparsed.getElementsByTagNameNS(sclNs, 'VoltageLevel')[0]).getAttributeNS(sldNs, 'x')).to.equal('2');
  });

  for (const value of ['1.5', '', 'NaN', '1e2', '2147483648']) {
    it(`blocks malformed or out-of-range SXY "${value}" without partial edits`, () => {
      const doc = parse(`<Substation name="S" xy:x="0"><VoltageLevel name="V">
        <Bay name="Good" xy:x="1"/><Bay name="Bad" xy:y="${value}"/>
      </VoltageLevel></Substation>`);
      const before = new XMLSerializer().serializeToString(doc);
      const plan = copySxyPlan(doc, true);
      expect(plan.issues.length).to.be.greaterThan(0);
      expect(plan.edits).to.deep.equal([]);
      expect(new XMLSerializer().serializeToString(doc)).to.equal(before);
    });
  }

  it('blocks duplicate destination records and negative absolute positions', () => {
    for (const body of [
      `<Substation name="S" xy:x="1">${layout('')}${layout('')}</Substation>`,
      '<Substation name="S" xy:y="-1"/>',
    ]) {
      const plan = copySxyPlan(parse(body), true);
      expect(plan.issues.length).to.be.greaterThan(0);
      expect(plan.edits).to.deep.equal([]);
    }
  });

  for (const overwrite of [false, true]) {
    it(`exports relative to effective ${overwrite ? 'overwritten' : 'retained'} ancestor offsets and never edits children without source positions`, () => {
      const doc = parse(`<Substation name="S" xy:x="0" xy:y="0">
        <VoltageLevel name="V"><Bay name="B" xy:x="10" xy:y="5">
          ${layout('n:x="5" n:y="5"')}
          <ConductingEquipment name="Keep" type="DIS" xy:x="2" xy:y="3">
            ${layout('n:rot="1"')}
          </ConductingEquipment>
          <ConductingEquipment name="Copy" type="DIS">${layout('n:x="12" n:y="8"')}</ConductingEquipment>
        </Bay></VoltageLevel></Substation>`);
      const retained = doc.querySelector('ConductingEquipment[name="Keep"]')!;
      const before = retained.cloneNode(true);
      const plan = copyPrivateToSxyPlan(doc, overwrite);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.conflicts).to.equal(1);
      new XMLEditor().commit(plan.edits);
      expect(retained.isEqualNode(before)).to.equal(true);
      const copy = doc.querySelector('ConductingEquipment[name="Copy"]')!;
      expect(copy.getAttributeNS(sxyNs, 'x')).to.equal(overwrite ? '7' : '2');
      expect(copy.getAttributeNS(sxyNs, 'y')).to.equal('3');
      expect(copyPrivateToSxyPlan(doc, overwrite).edits).to.deep.equal([]);
    });

    it(`leaves a ${overwrite ? 'copied' : 'skipped'} child's offset under the effective new container position`, () => {
      const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
        ${layout('n:x="5" n:y="5"')}
        <ConductingEquipment name="Q" type="DIS" xy:x="2" xy:y="3">
          ${layout('n:x="12" n:y="8"')}
        </ConductingEquipment>
      </Bay></VoltageLevel></Substation>`);
      const plan = copyPrivateToSxyPlan(doc, overwrite);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.conflicts).to.equal(1);
      new XMLEditor().commit(plan.edits);
      expect(doc.querySelector('Bay')!.getAttributeNS(sxyNs, 'x')).to.equal('5');
      expect(doc.querySelector('ConductingEquipment')!.getAttributeNS(sxyNs, 'x')).to.equal(overwrite ? '7' : '2');
    });
  }

  it('rounds absolute positions once, warns explicitly, and preserves every SLD source record', () => {
    const doc = parse(`<Substation name="S">${layout('n:x="0" n:y="0" n:w="100" n:h="100"')}
      <VoltageLevel name="V">${layout('n:x="1.6" n:y="1.6"')}
        <Bay name="B">${layout('n:x="2.6" n:y="2.6" n:rot="2"')}
          <ConductingEquipment name="Q" type="DIS">${layout('n:x="3.6" n:y="3.6"')}
        </ConductingEquipment></Bay>
      </VoltageLevel></Substation>`);
    const sources = Array.from(doc.getElementsByTagNameNS(sldNs, 'SLDAttributes')).map(source => source.cloneNode(true));
    const plan = copyPrivateToSxyPlan(doc);
    expect(plan.issues).to.deep.equal([]);
    expect(plan.notes.join(' ')).to.contain('3 source position(s) use fractional values');
    const editor = new XMLEditor();
    editor.commit(plan.edits);
    expect(doc.querySelector('VoltageLevel')!.getAttributeNS(sxyNs, 'x')).to.equal('2');
    expect(doc.querySelector('Bay')!.getAttributeNS(sxyNs, 'x')).to.equal('1');
    expect(doc.querySelector('ConductingEquipment')!.getAttributeNS(sxyNs, 'x')).to.equal('1');
    Array.from(doc.getElementsByTagNameNS(sldNs, 'SLDAttributes')).forEach((source, index) =>
      expect(source.isEqualNode(sources[index])).to.equal(true));
    expect(copyPrivateToSxyPlan(doc).edits).to.deep.equal([]);
    const after = doc.documentElement.cloneNode(true);
    editor.undo();
    expect(doc.querySelector('Bay')!.hasAttributeNS(sxyNs, 'x')).to.equal(false);
    editor.redo();
    expect(doc.documentElement.isEqualNode(after)).to.equal(true);
  });

  it('preserves destination-only attributes and skips every conflicting export without edits', () => {
    const doc = parse(`<Substation name="S" xy:x="9" xy:y="8" xy:dir="horizontal" vendor:x="99">
      ${layout('n:x="1" n:y="2" n:rot="3"')}
    </Substation>`);
    expect(copyPrivateToSxyPlan(doc).edits).to.deep.equal([]);
    const plan = copyPrivateToSxyPlan(doc, true);
    new XMLEditor().commit(plan.edits);
    const s = doc.querySelector('Substation')!;
    expect(s.getAttributeNS(sxyNs, 'dir')).to.equal('horizontal');
    expect(s.getAttributeNS('urn:vendor', 'x')).to.equal('99');
    expect(s.getAttributeNS(sxyNs, 'x')).to.equal('1');
  });

  it('treats omitted zero axes as already matching instead of inventing conflicts', () => {
    const doc = parse(`<Substation name="S" xy:x="2">
      ${layout('n:x="2" n:w="10" n:h="10"')}
    </Substation>`);
    for (const planner of [copySxyPlan, copyPrivateToSxyPlan]) {
      const plan = planner(doc);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.edits).to.deep.equal([]);
      expect(plan.conflicts).to.equal(0);
      expect(plan.unchanged).to.equal(1);
    }
  });

  it('warns about rounding even when its effect arises only after overwriting an ancestor', () => {
    const doc = parse(`<Substation name="S" xy:x="10" xy:y="0">
      ${layout('n:x="5" n:y="0"')}
      <VoltageLevel name="V" xy:x="2" xy:y="0">${layout('n:x="12.4" n:y="0"')}</VoltageLevel>
    </Substation>`);
    const preview = copyPrivateToSxyPlan(doc);
    expect(preview.notes.join(' ')).to.contain('rounding to the nearest integer');
    const plan = copyPrivateToSxyPlan(doc, true);
    new XMLEditor().commit(plan.edits);
    expect(doc.querySelector('VoltageLevel')!.getAttributeNS(sxyNs, 'x')).to.equal('7');
  });

  for (const value of ['NaN', '-1', 'Infinity', '1e999', '2147483648']) {
    it(`blocks unrepresentable SLD position "${value}" atomically`, () => {
      const plan = copyPrivateToSxyPlan(parse(`<Substation name="S">${layout(`n:x="${value}"`)}</Substation>`));
      expect(plan.issues.length).to.be.greaterThan(0);
      expect(plan.edits).to.deep.equal([]);
    });
  }

  it('round-trips explicit positions independently of source retention and vendor layouts', () => {
    const doc = parse(`<Substation name="S" xy:x="2" xy:y="3"><VoltageLevel name="V" xy:x="2">
      <Bay name="B" xy:x="10" xy:y="13">
        <ConductingEquipment name="Q" type="DIS" xy:x="2"><Private type="ABB SLD"><vendor:Coord x="55"/></Private></ConductingEquipment>
      </Bay></VoltageLevel></Substation>`);
    const editor = new XMLEditor();
    editor.commit(copySxyPlan(doc).edits);
    expect(record(doc.querySelector('ConductingEquipment')!).getAttributeNS(sldNs, 'x')).to.equal('16');
    expect(record(doc.querySelector('ConductingEquipment')!).getAttributeNS(sldNs, 'y')).to.equal('16');
    editor.commit(cleanCoordinatePlan(doc, ['sxy']).edits);
    const plan = copyPrivateToSxyPlan(doc);
    expect(plan.issues).to.deep.equal([]);
    editor.commit(plan.edits);
    expect(doc.querySelector('Bay')!.getAttributeNS(sxyNs, 'x')).to.equal('10');
    expect(doc.querySelector('ConductingEquipment')!.getAttributeNS(sxyNs, 'x')).to.equal('2');
    expect(doc.querySelector('ConductingEquipment')!.getAttributeNS(sxyNs, 'y')).to.equal('0');
    expect(doc.getElementsByTagNameNS('urn:vendor', 'Coord')[0].getAttribute('x')).to.equal('55');
  });
});
