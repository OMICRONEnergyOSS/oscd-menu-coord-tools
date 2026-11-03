import { expect } from '@open-wc/testing';
import { XMLEditor } from '@openscd/oscd-editor';

import {
  cleanCoordinatePlan, copySldPrivatePlan, copySldV1Plan, detectCoordinateSystems, sldV1Ns, sxyNs,
} from './coordinate-systems.js';
import { privType, sldNs, xmlnsNs } from './layout-util.js';

const sclNs = 'http://www.iec.ch/61850/2003/SCL';
const vendorNs = 'http://www.abb.com/61850/2006/SCL_SLD';

function parse(body: string): XMLDocument {
  return new DOMParser().parseFromString(
    `<SCL xmlns="${sclNs}" xmlns:old="${sldV1Ns}" xmlns:new="${sldNs}"
      xmlns:xy="${sxyNs}" xmlns:vendor="${vendorNs}" version="2007" revision="B">
      ${body}</SCL>`, 'application/xml',
  );
}

function serialize(doc: XMLDocument): string {
  return new XMLSerializer().serializeToString(doc);
}

function layout(doc: XMLDocument): Element[] {
  return Array.from(doc.getElementsByTagNameNS(sldNs, 'SLDAttributes'));
}

describe('Copier conflict decisions', () => {
  for (const toPrivate of [true, false]) {
    const copy = toPrivate ? copySldV1Plan : copySldPrivatePlan;
    const targetNs = toPrivate ? sldNs : sldV1Ns;
    const extra = toPrivate ? 'new:rot="3"' : 'old:rot="3"';

    it(`${toPrivate ? 'imports' : 'exports'} matching scalar, IED and connectivity layouts without conflicts or edits`, () => {
      const doc = parse(`<Substation name="S" old:x="1" ${toPrivate ? '' : extra}>
        <Private type="${privType}"><new:SLDAttributes new:x="1" ${toPrivate ? extra : ''}/>
          <new:Reference new:type="IED" new:id="A"><new:SLDAttributes new:x="2"/></new:Reference>
        </Private>
        <Private type="OpenSCD-Linked-IEDs"><old:IEDName old:name="A" old:x="2"/></Private>
        <VoltageLevel name="V"><Bay name="B"><ConnectivityNode name="N" pathName="S/V/B/N">
          <Private type="Transpower-SLD-Vertices">
            <old:Section bus="true"><old:Vertex old:x="3" old:y="4" old:uuid="u"/></old:Section>
            <old:Section bus="false"><old:Vertex old:x="5"/></old:Section>
          </Private>
          <Private type="${privType}" xmlns:other="${sldNs}">
            <other:Section other:bus="true"><other:Vertex other:x="3" other:y="4" other:uuid="u"/></other:Section>
            <other:Section other:bus="false"><other:Vertex other:x="5"/></other:Section>
          </Private>
        </ConnectivityNode></Bay></VoltageLevel>
      </Substation><IED name="A"/>`);
      const before = serialize(doc);
      for (const overwrite of [false, true]) {
        const plan = copy(doc, overwrite);
        expect(plan.issues).to.deep.equal([]);
        expect(plan.conflicts).to.equal(0);
        expect(plan.copied).to.equal(0);
        expect(plan.unchanged).to.equal(3);
        expect(plan.edits).to.deep.equal([]);
        expect(serialize(doc)).to.equal(before);
      }
      const destination = toPrivate ? layout(doc)[0] : doc.querySelector('Substation');
      destination?.setAttributeNS(targetNs, 'target:x', '9');
      const differing = copy(doc);
      expect(differing.conflicts).to.equal(1);
      expect(differing.unchanged).to.equal(2);
      expect(differing.edits).to.deep.equal([]);
    });

    it(`${toPrivate ? 'imports' : 'exports'} a connectivity path set as one copied or conflicting record`, () => {
      const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
        <ConnectivityNode name="N" pathName="S/V/B/N">
          ${toPrivate ? `<Private type="Transpower-SLD-Vertices">
            <old:Section><old:Vertex old:x="1"/></old:Section>
            <old:Section><old:Vertex old:x="2"/></old:Section>
          </Private>` : `<Private type="${privType}">
            <new:Section><new:Vertex new:x="1"/></new:Section>
            <new:Section><new:Vertex new:x="2"/></new:Section>
          </Private>`}
        </ConnectivityNode></Bay></VoltageLevel></Substation>`);
      const plan = copy(doc);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.copied).to.equal(1);
      new XMLEditor().commit(plan.edits);
      expect(copy(doc).conflicts).to.equal(0);
      const vertex = doc.getElementsByTagNameNS(targetNs, 'Vertex')[0];
      vertex.setAttributeNS(targetNs, 'target:x', '9');
      expect(copy(doc).conflicts).to.equal(1);
      expect(copy(doc).copied).to.equal(0);
      expect(copy(doc, true).copied).to.equal(1);
    });
  }

  it('fills an empty SLDAttributes destination without asking to overwrite nonexistent coordinates', () => {
    const doc = parse(`<Substation name="S" old:x="1"><Private type="${privType}">
      <new:SLDAttributes vendor:keep="yes"/></Private></Substation>`);
    const plan = copySldV1Plan(doc);
    expect(plan.conflicts).to.equal(0);
    expect(plan.copied).to.equal(1);
    new XMLEditor().commit(plan.edits);
    expect(layout(doc)[0].getAttributeNS(sldNs, 'x')).to.equal('1');
    expect(layout(doc)[0].getAttributeNS(vendorNs, 'keep')).to.equal('yes');
  });
});

describe('Text coordinate copying', () => {
  for (const toPrivate of [true, false]) {
    for (const overwrite of [false, true]) {
      it(`${toPrivate ? 'imports' : 'exports'} text layout with ${overwrite ? 'overwrite' : 'skip'} conflicts without altering mixed text content`, () => {
        const values = { x: '0', y: '-2', lx: '3.5', ly: '4', rot: '1', color: '#ff0000', weight: '500' };
        const ns = toPrivate ? sldV1Ns : sldNs;
        const targetNs = toPrivate ? sldNs : sldV1Ns;
        const fields = Object.entries(values).map(([key, value]) => `from:${key}="${value}"`).join(' ');
        const text = (conflict: boolean) => {
          const record = !toPrivate || conflict
            ? `<s:Private type="${privType}"><${toPrivate ? 'to' : 'from'}:SLDAttributes ${toPrivate ? 'to:lx="99"' : fields}/></s:Private>`
            : '';
          return `<s:Text source="urn:notes" lx="DECOY"
            ${toPrivate ? fields : conflict ? 'to:lx="99"' : ''}>Feeder <![CDATA[<A>]]>
Second line<vendor:Span> preserved</vendor:Span>${record}</s:Text>`;
        };
        const doc = new DOMParser().parseFromString(
          `<s:SCL xmlns:s="${sclNs}" xmlns:from="${ns}" xmlns:to="${targetNs}" xmlns:vendor="${vendorNs}">
            <s:Substation name="S"><s:VoltageLevel name="V">
              <s:Bay name="B1">${text(false)}</s:Bay><s:Bay name="B2">${text(true)}</s:Bay>
            </s:VoltageLevel></s:Substation>
          </s:SCL>`, 'application/xml',
        );
        const texts = Array.from(doc.getElementsByTagNameNS(sclNs, 'Text'));
        const content = texts.map(element => element.textContent);
        const originals = texts.map(element => Array.from(element.childNodes).filter(child =>
          !(child instanceof Element && child.localName === 'Private')));
        const before = doc.documentElement.cloneNode(true);
        const copy = toPrivate ? copySldV1Plan : copySldPrivatePlan;
        const plan = copy(doc, overwrite);
        expect(plan.issues).to.deep.equal([]);
        expect(plan.conflicts).to.equal(1);
        expect(plan.notes.some(note => note.includes('violates the SCL schema'))).to.equal(toPrivate);
        expect(doc.documentElement.isEqualNode(before)).to.equal(true);
        const editor = new XMLEditor();
        editor.commit(plan.edits);
        texts.forEach((element, index) => {
          expect(element.textContent).to.equal(content[index]);
          originals[index].forEach(node => expect(node.parentNode).to.equal(element));
          expect(element.getAttribute('source')).to.equal('urn:notes');
          expect(element.getAttribute('lx')).to.equal('DECOY');
          const source = toPrivate ? element : element.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0];
          for (const [key, value] of Object.entries(values)) {
            expect(source.getAttributeNS(ns, key)).to.equal(value);
          }
          const target = toPrivate ? element.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0] : element;
          for (const [key, value] of Object.entries(values)) {
            expect(target.getAttributeNS(targetNs, key), key)
              .to.equal(index === 1 && !overwrite ? key === 'lx' ? '99' : null : value);
          }
        });
        expect(copy(doc, overwrite).edits).to.deep.equal([]);
        if (overwrite) {
          expect(copy(doc, overwrite).notes).to.deep.equal([]);
        }
        const reparsed = new DOMParser().parseFromString(serialize(doc), 'application/xml');
        expect(reparsed.querySelector('parsererror')).to.equal(null);
        expect(Array.from(reparsed.getElementsByTagNameNS(sclNs, 'Text')).map(element => element.textContent))
          .to.deep.equal(content);
        const after = doc.documentElement.cloneNode(true);
        editor.undo();
        expect(doc.documentElement.isEqualNode(before)).to.equal(true);
        editor.redo();
        expect(doc.documentElement.isEqualNode(after)).to.equal(true);
      });
    }
  }
});

describe('SLD Private to SLDv1', () => {
  it('exports all scalar fields without changing the source, SXY, or vendor attributes', () => {
    const values = {
      x: '0', y: '-2.5', w: '12', h: '8', lx: '1.25', ly: '3',
      rot: '0.5', flip: 'true', color: '#ff0000', weight: '400', kind: 'auto', uuid: 'terminal-1',
    };
    const doc = parse(`<Substation name="S" x="DECOY" xy:x="4" vendor:x="8">
      <Private type="${privType}"><new:SLDAttributes x="DECOY"
        ${Object.entries(values).map(([key, value]) => `new:${key}="${value}"`).join(' ')}/>
        <vendor:Metadata>keep</vendor:Metadata>
      </Private><VoltageLevel name="V"/>
    </Substation>`);
    const before = doc.documentElement.cloneNode(true);
    const source = doc.querySelector(`Private[type="${privType}"]`)!.cloneNode(true);
    const plan = copySldPrivatePlan(doc);
    expect(plan.issues).to.deep.equal([]);
    expect(plan.copied).to.equal(1);
    expect(doc.documentElement.isEqualNode(before)).to.equal(true);
    const editor = new XMLEditor();
    editor.commit(plan.edits);
    const substation = doc.querySelector('Substation')!;
    for (const [key, value] of Object.entries(values)) {
      expect(substation.getAttributeNS(sldV1Ns, key), key).to.equal(value);
    }
    expect(substation.getAttribute('x')).to.equal('DECOY');
    expect(substation.getAttributeNS(sxyNs, 'x')).to.equal('4');
    expect(substation.getAttributeNS(vendorNs, 'x')).to.equal('8');
    expect(substation.firstElementChild!.isEqualNode(source)).to.equal(true);
    const after = doc.documentElement.cloneNode(true);
    expect(copySldPrivatePlan(doc).edits).to.deep.equal([]);
    expect(copySldPrivatePlan(doc, true).edits).to.deep.equal([]);
    editor.undo();
    expect(doc.documentElement.isEqualNode(before)).to.equal(true);
    editor.redo();
    expect(doc.documentElement.isEqualNode(after)).to.equal(true);
  });

  for (const overwrite of [false, true]) {
    it(`${overwrite ? 'overwrites' : 'skips'} scalar and linked IED conflicts as records`, () => {
      const doc = parse(`<Substation name="S" old:x="9" old:rot="2">
        <Private type="${privType}"><new:SLDAttributes new:x="1" new:y="2"/>
          <new:Reference new:type="IED" new:id="A"><new:SLDAttributes new:x="3" new:y="4"/></new:Reference>
        </Private>
        <Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A" old:x="8" old:color="blue" vendor:extra="keep"/></Private>
        <VoltageLevel name="V"><Private type="${privType}"><new:SLDAttributes new:x="0"/></Private></VoltageLevel>
      </Substation><IED name="A"/>`);
      const plan = copySldPrivatePlan(doc, overwrite);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.conflicts).to.equal(2);
      new XMLEditor().commit(plan.edits);
      const substation = doc.querySelector('Substation')!;
      expect(substation.getAttributeNS(sldV1Ns, 'x')).to.equal(overwrite ? '1' : '9');
      expect(substation.getAttributeNS(sldV1Ns, 'y')).to.equal(overwrite ? '2' : null);
      expect(substation.getAttributeNS(sldV1Ns, 'rot')).to.equal('2');
      const entry = doc.querySelector('IEDName')!;
      expect(entry.getAttributeNS(sldV1Ns, 'x')).to.equal(overwrite ? '3' : '8');
      expect(entry.getAttributeNS(sldV1Ns, 'y')).to.equal(overwrite ? '4' : null);
      expect(entry.getAttributeNS(sldV1Ns, 'color')).to.equal('blue');
      expect(entry.getAttributeNS(vendorNs, 'extra')).to.equal('keep');
      expect(doc.querySelector('VoltageLevel')!.getAttributeNS(sldV1Ns, 'x')).to.equal('0');
    });
  }

  it('preserves all three IED scopes with linked entries and survives a clean reimport', () => {
    const reference = (id: string) => `<Private type="${privType}">
      <new:Reference new:type="IED" new:id="${id}" id="DECOY">
        <new:SLDAttributes new:x="0" new:y="-3" new:lx="1" new:ly="2"/>
      </new:Reference></Private>`;
    const doc = parse(`<Substation name="S">${reference('A')}
      <VoltageLevel name="V">${reference('B')}<Bay name="B">${reference('C')}</Bay></VoltageLevel>
      </Substation><IED name="A"/><IED name="B"/><IED name="C"/>`);
    const editor = new XMLEditor();
    const plan = copySldPrivatePlan(doc);
    expect(plan.issues).to.deep.equal([]);
    editor.commit(plan.edits);
    const entries = Array.from(doc.getElementsByTagNameNS(sldV1Ns, 'IEDName'));
    expect(entries.map(entry => entry.parentElement?.parentElement?.localName))
      .to.deep.equal(['Substation', 'VoltageLevel', 'Bay']);
    expect(entries.map(entry => entry.getAttributeNS(sldV1Ns, 'name'))).to.deep.equal(['A', 'B', 'C']);
    expect(entries.map(entry => entry.getAttributeNS(sldV1Ns, 'y'))).to.deep.equal(['-3', '-3', '-3']);
    expect(doc.querySelector('IED')!.hasAttributeNS(sldV1Ns, 'x')).to.equal(false);
    const cleanup = cleanCoordinatePlan(doc, ['sldpriv']);
    expect(cleanup.issues).to.deep.equal([]);
    editor.commit(cleanup.edits);
    const imported = copySldV1Plan(doc);
    expect(imported.issues).to.deep.equal([]);
    editor.commit(imported.edits);
    const refs = Array.from(doc.getElementsByTagNameNS(sldNs, 'Reference'));
    expect(refs.map(ref => ref.parentElement?.parentElement?.localName))
      .to.deep.equal(['Substation', 'VoltageLevel', 'Bay']);
    expect(refs.map(ref => ref.getAttributeNS(sldNs, 'id'))).to.deep.equal(['A', 'B', 'C']);
    expect(layout(doc).map(record => record.getAttributeNS(sldNs, 'y'))).to.deep.equal(['-3', '-3', '-3']);
    expect(copySldPrivatePlan(doc, true).edits).to.deep.equal([]);
  });

  it('supports prefixed SCL, avoids nested prefix collisions, and orders new Privates', () => {
    const doc = new DOMParser().parseFromString(
      `<s:SCL xmlns:s="${sclNs}" xmlns:n="${sldNs}" xmlns:esld="urn:vendor">
        <s:Substation name="S" xmlns:esld1="urn:other"><s:Text>keep</s:Text>
          <s:Private type="${privType}"><n:Reference n:type="IED" n:id="A">
            <n:SLDAttributes n:x="1"/></n:Reference></s:Private>
          <s:VoltageLevel name="V"/>
        </s:Substation><s:IED name="A"/>
      </s:SCL>`, 'application/xml',
    );
    const plan = copySldPrivatePlan(doc);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    const substation = doc.getElementsByTagNameNS(sclNs, 'Substation')[0];
    expect(Array.from(substation.children).map(child => child.localName))
      .to.deep.equal(['Text', 'Private', 'Private', 'VoltageLevel']);
    expect(doc.documentElement.lookupNamespaceURI('esld')).to.equal('urn:vendor');
    expect(substation.lookupNamespaceURI('esld1')).to.equal('urn:other');
    const reparsed = new DOMParser().parseFromString(serialize(doc), 'application/xml');
    expect(reparsed.querySelector('parsererror')).to.equal(null);
    const entry = reparsed.getElementsByTagNameNS(sldV1Ns, 'IEDName')[0];
    expect(entry.getAttributeNS(sldV1Ns, 'name')).to.equal('A');
    expect(entry.getAttributeNS(sldV1Ns, 'x')).to.equal('1');
  });

  it('reuses an unambiguous direct root-IED destination without introducing linked entries', () => {
    const doc = parse(`<Substation name="S"><Private type="${privType}">
      <new:Reference new:type="IED" new:id="A"><new:SLDAttributes new:x="0"/></new:Reference>
      </Private></Substation><IED name="A" old:x="8" old:color="blue"/>`);
    expect(copySldPrivatePlan(doc).conflicts).to.equal(1);
    expect(copySldPrivatePlan(doc).edits).to.deep.equal([]);
    const plan = copySldPrivatePlan(doc, true);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    expect(doc.querySelector('IED')!.getAttributeNS(sldV1Ns, 'x')).to.equal('0');
    expect(doc.querySelector('IED')!.getAttributeNS(sldV1Ns, 'color')).to.equal('blue');
    expect(doc.querySelector('Private[type="OpenSCD-Linked-IEDs"]')).to.equal(null);
  });

  for (const overwrite of [false, true]) {
    it(`${overwrite ? 'replaces' : 'preserves'} connectivity paths as a set and maps bus flags`, () => {
      const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
        <ConnectivityNode name="N" pathName="S/V/B/N">
          <Private type="${privType}"><new:Section new:bus="true" bus="DECOY">
            <new:Vertex new:x="0" new:y="-2.5" new:uuid="t1" x="DECOY"/>
            <new:Vertex new:x="3" new:y="4"/>
          </new:Section><new:Section new:bus="false"/></Private>
          <Private type="Transpower-SLD-Vertices"><old:Section bus="false">
            <old:Vertex old:x="9" old:y="9"/></old:Section><vendor:Metadata/>
          </Private>
        </ConnectivityNode></Bay></VoltageLevel></Substation>`);
      const plan = copySldPrivatePlan(doc, overwrite);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.conflicts).to.equal(1);
      if (plan.edits.length > 0) {
        new XMLEditor().commit(plan.edits);
      }
      const sections = doc.getElementsByTagNameNS(sldV1Ns, 'Section');
      expect(sections).to.have.lengthOf(overwrite ? 2 : 1);
      expect(sections[0].getAttribute('bus')).to.equal(overwrite ? 'true' : 'false');
      expect(sections[0].getAttributeNS(sldV1Ns, 'bus')).to.equal(null);
      expect(sections[0].firstElementChild!.getAttributeNS(sldV1Ns, 'x')).to.equal(overwrite ? '0' : '9');
      expect(sections[0].firstElementChild!.getAttributeNS(sldV1Ns, 'uuid')).to.equal(overwrite ? 't1' : null);
      expect(doc.getElementsByTagNameNS(vendorNs, 'Metadata')).to.have.lengthOf(1);
      expect(doc.getElementsByTagNameNS(sldNs, 'Section')).to.have.lengthOf(2);
      expect(copySldPrivatePlan(doc, overwrite).edits).to.deep.equal([]);
    });
  }

  it('blocks overwriting connectivity paths containing vendor data', () => {
    const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
      <ConnectivityNode name="N" pathName="S/V/B/N">
        <Private type="${privType}"><new:Section><new:Vertex new:x="1" new:y="2"/></new:Section></Private>
        <Private type="Transpower-SLD-Vertices"><old:Section><vendor:Data/></old:Section></Private>
      </ConnectivityNode></Bay></VoltageLevel></Substation>`);
    expect(copySldPrivatePlan(doc).issues).to.deep.equal([]);
    const plan = copySldPrivatePlan(doc, true);
    expect(plan.issues.join(' ')).to.contain('unrelated content');
    expect(plan.edits).to.deep.equal([]);
  });

  it('round-trips scalar fields and connectivity through a clean legacy-only document', () => {
    const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
      <ConductingEquipment name="Q" type="CBR"><Private type="${privType}">
        <new:SLDAttributes new:x="0" new:y="2.5" new:lx="1" new:ly="3" new:rot="0.5"/>
      </Private><Terminal connectivityNode="S/V/B/N"><Private type="${privType}">
        <new:SLDAttributes new:uuid="t1"/></Private></Terminal></ConductingEquipment>
      <ConnectivityNode name="N" pathName="S/V/B/N"><Private type="${privType}">
        <new:Section new:bus="true"><new:Vertex new:x="0" new:y="2.5" new:uuid="t1"/></new:Section>
      </Private></ConnectivityNode>
      </Bay></VoltageLevel></Substation>`);
    const editor = new XMLEditor();
    const exported = copySldPrivatePlan(doc);
    expect(exported.issues).to.deep.equal([]);
    editor.commit(exported.edits);
    expect(doc.querySelector('Terminal')!.getAttributeNS(sldV1Ns, 'uuid')).to.equal('t1');
    expect(doc.getElementsByTagNameNS(sldV1Ns, 'Section')[0].getAttribute('bus')).to.equal('true');
    const cleanup = cleanCoordinatePlan(doc, ['sldpriv']);
    expect(cleanup.issues).to.deep.equal([]);
    editor.commit(cleanup.edits);
    const imported = copySldV1Plan(doc);
    expect(imported.issues).to.deep.equal([]);
    editor.commit(imported.edits);
    expect(layout(doc).map(record => record.getAttributeNS(sldNs, 'rot')))
      .to.deep.equal(['0.5', null]);
    expect(layout(doc)[0].getAttributeNS(sldNs, 'lx')).to.equal('1');
    expect(layout(doc)[1].getAttributeNS(sldNs, 'uuid')).to.equal('t1');
    const section = doc.getElementsByTagNameNS(sldNs, 'Section')[0];
    expect(section.getAttributeNS(sldNs, 'bus')).to.equal('true');
    expect(section.firstElementChild!.getAttributeNS(sldNs, 'uuid')).to.equal('t1');
    expect(section.firstElementChild!.getAttributeNS(sldNs, 'y')).to.equal('2.5');
  });

  it('does not add empty linked entries for references without layout values', () => {
    const doc = parse(`<Substation name="S"><Private type="${privType}">
      <new:SLDAttributes new:x="1"/><new:Reference new:type="IED" new:id="A"/>
      </Private></Substation><IED name="A"/>`);
    const plan = copySldPrivatePlan(doc);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    expect(doc.querySelector('Private[type="OpenSCD-Linked-IEDs"]')).to.equal(null);
  });

  const ref = '<new:Reference new:type="IED" new:id="A"><new:SLDAttributes new:x="1"/></new:Reference>';
  for (const body of [
    `<Substation name="S"><Private type="${privType}">${ref}</Private></Substation>`,
    `<Substation name="S"><Private type="${privType}">${ref}${ref}</Private></Substation><IED name="A"/>`,
    `<Substation name="S"><Private type="${privType}">${ref}</Private></Substation><IED name="A"/><IED name="A"/>`,
    `<Substation name="S"><Private type="${privType}"><new:SLDAttributes/><new:SLDAttributes/></Private></Substation>`,
    `<Substation name="S"><Private type="${privType}"/><Private type="${privType}"/></Substation>`,
    `<Substation name="S"><Private type="${privType}"><new:SLDAttributes new:unknown="1"/></Private></Substation>`,
    `<Substation name="S"><Private type="${privType}"><new:Other/></Private></Substation>`,
    '<vendor:Bay><new:SLDAttributes new:x="1"/></vendor:Bay>',
    `<Substation name="S"><Private type="${privType}">${ref}</Private>
      <Private type="OpenSCD-Linked-IEDs"><old:IEDName old:name="A" old:x="2"/><old:IEDName old:name="A" old:x="3"/></Private>
      </Substation><IED name="A"/>`,
    `<Substation name="S"><Private type="${privType}">${ref}</Private>
      <Private type="OpenSCD-Linked-IEDs"><old:IEDName old:name="A" old:x="2"/></Private>
      </Substation><IED name="A" old:x="3"/>`,
    `<Substation name="S"><VoltageLevel name="V"><Bay name="B">
      <Private type="${privType}">${ref}</Private></Bay></VoltageLevel></Substation><IED name="A" old:x="3"/>`,
    `<Substation name="S"><Private type="${privType}">${ref}</Private></Substation>
      <Substation name="T"/><IED name="A" old:x="3"/>`,
  ]) {
    it(`rejects ambiguous/unsupported export without partial edits: ${body.slice(0, 65)}`, () => {
      const doc = parse(`<Substation name="Good"><Private type="${privType}"><new:SLDAttributes new:x="0"/></Private></Substation>${body}`);
      const before = serialize(doc);
      const plan = copySldPrivatePlan(doc, true);
      expect(plan.issues.length).to.be.greaterThan(0);
      expect(plan.edits).to.deep.equal([]);
      expect(serialize(doc)).to.equal(before);
    });
  }
});

describe('Coordinate systems', () => {
  it('prefers scoped linked placements over retained IED Coords and reports the choice', () => {
    const doc = parse(`<Substation name="S"><VoltageLevel name="V">
      <Private type="OpenSCD-Linked-IEDs"><old:IEDName old:name="A" old:x="27" old:y="14" old:lx="28" old:ly="15"/></Private>
      <Bay name="B"><Private type="OpenSCD-Linked-IEDs"><old:IEDName old:name="B" old:x="72" old:y="14" old:lx="73" old:ly="15"/></Private></Bay>
      </VoltageLevel></Substation><Substation name="Other"/>
      <IED name="A"><Private type="OpenSCD-Coords"><old:Coords old:lx="27" old:ly="14"/></Private></IED>
      <IED name="B"><Private type="OpenSCD-Coords"><old:Coords old:lx="72" old:ly="14"/></Private></IED>`);
    const before = doc.documentElement.cloneNode(true);
    const sources = Array.from(doc.querySelectorAll('IED > Private'));
    const originalSources = sources.map(source => source.cloneNode(true));
    const plan = copySldV1Plan(doc);
    expect(plan.issues).to.deep.equal([]);
    expect(plan.notes).to.have.lengthOf(1);
    expect(plan.notes[0]).to.contain('2 legacy Coords record(s)');
    expect(doc.documentElement.isEqualNode(before)).to.equal(true);
    const editor = new XMLEditor();
    editor.commit(plan.edits);
    const references = Array.from(doc.getElementsByTagNameNS(sldNs, 'Reference'));
    expect(references.map(reference => reference.parentElement?.parentElement?.localName))
      .to.deep.equal(['VoltageLevel', 'Bay']);
    expect(layout(doc).map(record => record.getAttributeNS(sldNs, 'lx'))).to.deep.equal(['28', '73']);
    sources.forEach((source, index) => expect(source.isEqualNode(originalSources[index])).to.equal(true));
    expect(copySldV1Plan(doc, true).edits).to.deep.equal([]);
    editor.undo();
    expect(doc.documentElement.isEqualNode(before)).to.equal(true);
  });

  for (const linked of ['', '<Private type="OpenSCD-Linked-IEDs"><old:IEDName old:name="A"/></Private>']) {
    it('does not discard standalone Coords just because an empty or absent linked entry exists', () => {
      const doc = parse(`<Substation name="S" old:x="1">${linked}</Substation>
        <IED name="A"><Private type="OpenSCD-Coords"><old:Coords old:lx="27" old:ly="14"/></Private></IED>`);
      const plan = copySldV1Plan(doc);
      expect(plan.issues.join(' ')).to.contain('no scoped linked placement');
      expect(plan.edits).to.deep.equal([]);
    });
  }

  for (const section of [
    '<old:Section old:unknown="1"/>',
    '<old:Section bus="true" old:bus="false"/>',
    '<old:Section><old:Vertex old:x="1" old:y="2" old:unknown="3"/></old:Section>',
  ]) {
    it(`blocks unsupported legacy connectivity fields: ${section}`, () => {
      const doc = parse(`<Substation name="S" old:x="1"><VoltageLevel name="V"><Bay name="B">
        <ConnectivityNode name="N" pathName="S/V/B/N">
          <Private type="Transpower-SLD-Vertices">${section}</Private>
        </ConnectivityNode></Bay></VoltageLevel></Substation>`);
      const plan = copySldV1Plan(doc);
      expect(plan.issues.length).to.be.greaterThan(0);
      expect(plan.edits).to.deep.equal([]);
    });
  }

  it('detects namespace content, not declarations or prefix names', () => {
    expect(detectCoordinateSystems(parse('<Substation name="S"/>')))
      .to.deep.equal({ sldv1: 0, sldpriv: 0, sxy: 0 });
    const doc = parse(`<Substation name="S" old:x="0" xy:y="-2" vendor:x="9">
      <Private type="${privType}"><new:SLDAttributes new:x="1"/></Private>
      </Substation>`);
    const found = detectCoordinateSystems(doc);
    expect(found.sldv1).to.equal(1);
    expect(found.sxy).to.equal(1);
    expect(found.sldpriv).to.equal(2);
  });

  it('copies zero/negative values with namespace decoys and leaves the source intact', () => {
    const doc = parse(`<Substation name="S" x="99" old:x="0" old:y="-2" old:uuid="a">
      <VoltageLevel name="V"><Voltage unit="V" multiplier="k">110</Voltage></VoltageLevel>
      </Substation>`);
    const before = serialize(doc);
    const plan = copySldV1Plan(doc);
    expect(plan.issues).to.deep.equal([]);
    expect(plan.copied).to.equal(1);
    expect(serialize(doc)).to.equal(before);
    const editor = new XMLEditor();
    editor.commit(plan.edits);
    expect(layout(doc)[0].getAttributeNS(sldNs, 'x')).to.equal('0');
    expect(layout(doc)[0].getAttributeNS(sldNs, 'y')).to.equal('-2');
    expect(layout(doc)[0].getAttributeNS(sldNs, 'uuid')).to.equal('a');
    expect(doc.querySelector('Substation')?.getAttribute('x')).to.equal('99');
    expect(doc.querySelector('Substation')?.getAttributeNS(sldV1Ns, 'x')).to.equal('0');
    const after = serialize(doc);
    editor.undo();
    expect(doc.documentElement.isEqualNode(
      new DOMParser().parseFromString(before, 'application/xml').documentElement,
    )).to.equal(true);
    editor.redo();
    expect(serialize(doc)).to.equal(after);
    expect(copySldV1Plan(doc).edits).to.deep.equal([]);
    expect(copySldV1Plan(doc, true).edits).to.deep.equal([]);
  });

  it('uses valid Private ordering for prefixed SCL and avoids nested prefix collisions', () => {
    const doc = new DOMParser().parseFromString(
      `<s:SCL xmlns:s="${sclNs}" xmlns:o="${sldV1Ns}" xmlns:eosld="urn:vendor">
      <s:Substation name="S" o:x="1" xmlns:eosld1="urn:other">
        <s:Text>Text</s:Text><s:VoltageLevel name="V"/>
      </s:Substation></s:SCL>`, 'application/xml',
    );
    const plan = copySldV1Plan(doc);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    const children = Array.from(doc.getElementsByTagNameNS(sclNs, 'Substation')[0].children);
    expect(children.map(child => child.localName)).to.deep.equal(['Text', 'Private', 'VoltageLevel']);
    expect(children[1].namespaceURI).to.equal(sclNs);
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'eosld')).to.equal('urn:vendor');
    expect(layout(doc)[0].getAttributeNS(sldNs, 'x')).to.equal('1');
    const roundTrip = new DOMParser().parseFromString(serialize(doc), 'application/xml');
    expect(roundTrip.querySelector('parsererror')).to.equal(null);
    expect(layout(roundTrip)[0].getAttributeNS(sldNs, 'x')).to.equal('1');
  });

  for (const overwrite of [false, true]) {
    it(`${overwrite ? 'overwrites' : 'skips'} ALL conflicts and still copies absent destinations`, () => {
      const doc = parse(`<Substation name="S" old:x="1" old:y="2">
        <Private type="${privType}"><new:SLDAttributes new:x="8" new:rot="3"/></Private>
        <VoltageLevel name="V" old:x="4">
          <Private type="${privType}"><new:SLDAttributes new:x="7"/></Private>
          <Bay name="B" old:x="0"/>
        </VoltageLevel></Substation>`);
      const before = serialize(doc);
      const plan = copySldV1Plan(doc, overwrite);
      expect(plan.conflicts).to.equal(2);
      expect(plan.issues).to.deep.equal([]);
      expect(serialize(doc)).to.equal(before);
      new XMLEditor().commit(plan.edits);
      const records = layout(doc);
      expect(records[0].getAttributeNS(sldNs, 'x')).to.equal(overwrite ? '1' : '8');
      expect(records[0].getAttributeNS(sldNs, 'y')).to.equal(overwrite ? '2' : null);
      expect(records[0].getAttributeNS(sldNs, 'rot')).to.equal('3');
      expect(records[1].getAttributeNS(sldNs, 'x')).to.equal(overwrite ? '4' : '7');
      expect(records[2].getAttributeNS(sldNs, 'x')).to.equal('0');
      expect(doc.querySelector('Bay')?.getAttributeNS(sldV1Ns, 'x')).to.equal('0');
    });
  }

  it('leaves already-identical destination records unchanged without conflicts', () => {
    const doc = parse(`<Substation name="S" old:x="1"><Private type="${privType}">
      <new:SLDAttributes new:x="1"/></Private></Substation>`);
    expect(copySldV1Plan(doc).conflicts).to.equal(0);
    expect(copySldV1Plan(doc).unchanged).to.equal(1);
    expect(copySldV1Plan(doc).edits).to.deep.equal([]);
  });

  it('copies connectivity sections, bus flags, vertices and UUIDs without removing the old Private', () => {
    const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
      <ConnectivityNode name="N" pathName="S/V/B/N" old:x="0">
        <Private type="Transpower-SLD-Vertices">
          <old:Section bus="true"><old:Vertex old:x="0" old:y="-1" old:uuid="v1"/></old:Section>
        </Private>
      </ConnectivityNode></Bay></VoltageLevel></Substation>`);
    const plan = copySldV1Plan(doc);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    expect(doc.querySelector('Private[type="Transpower-SLD-Vertices"]')).to.not.equal(null);
    const section = doc.getElementsByTagNameNS(sldNs, 'Section')[0];
    expect(section.getAttributeNS(sldNs, 'bus')).to.equal('true');
    expect(section.firstElementChild?.getAttributeNS(sldNs, 'x')).to.equal('0');
    expect(section.firstElementChild?.getAttributeNS(sldNs, 'uuid')).to.equal('v1');
    expect(doc.querySelectorAll(`Private[type="${privType}"]`)).to.have.lengthOf(1);
    expect(copySldV1Plan(doc).edits).to.deep.equal([]);
    expect(copySldV1Plan(doc).conflicts).to.equal(0);
    expect(copySldV1Plan(doc, true).edits.length).to.equal(0);
  });

  it('ignores empty legacy path wrappers without conflicts or changes to existing paths', () => {
    for (const withDestination of [false, true]) {
      const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
        <ConnectivityNode name="N" pathName="S/V/B/N">
          <Private type="Transpower-SLD-Vertices">
            <!-- No source paths -->
          </Private>
          ${withDestination ? `<Private type="${privType}"><new:Section new:bus="true">
            <new:Vertex new:x="1" new:y="2"/><new:Vertex new:x="5" new:y="2"/>
          </new:Section></Private>` : ''}
        </ConnectivityNode></Bay></VoltageLevel></Substation>`);
      const before = serialize(doc);
      for (const overwrite of [false, true]) {
        const plan = copySldV1Plan(doc, overwrite);
        expect(plan.issues).to.deep.equal([]);
        expect(plan.conflicts).to.equal(0);
        expect(plan.copied).to.equal(0);
        expect(plan.unchanged).to.equal(0);
        expect(plan.edits).to.deep.equal([]);
        expect(serialize(doc)).to.equal(before);
      }
      const originalPath = doc.getElementsByTagNameNS(sldNs, 'Section')[0]?.cloneNode(true);
      doc.querySelector('Substation')!.setAttributeNS(sldV1Ns, 'old:x', '3');
      const plan = copySldV1Plan(doc);
      expect(plan.issues).to.deep.equal([]);
      expect(plan.conflicts).to.equal(0);
      expect(plan.copied).to.equal(1);
      new XMLEditor().commit(plan.edits);
      expect(doc.getElementsByTagNameNS(sldNs, 'Section').length).to.equal(withDestination ? 1 : 0);
      expect(doc.getElementsByTagNameNS(sldNs, 'Vertex').length).to.equal(withDestination ? 2 : 0);
      if (originalPath !== undefined) {
        expect(doc.getElementsByTagNameNS(sldNs, 'Section')[0].isEqualNode(originalPath)).to.equal(true);
      }
      expect(layout(doc)[0].getAttributeNS(sldNs, 'x')).to.equal('3');
    }
  });

  it('skips/overwrites connectivity paths as a whole without duplicating the destination', () => {
    for (const overwrite of [false, true]) {
      const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
        <ConnectivityNode name="N" pathName="S/V/B/N">
          <Private type="Transpower-SLD-Vertices"><old:Section bus="false">
            <old:Vertex old:x="1"/></old:Section></Private>
          <Private type="${privType}"><new:Section new:bus="true">
            <new:Vertex new:x="9"/></new:Section></Private>
        </ConnectivityNode></Bay></VoltageLevel></Substation>`);
      const plan = copySldV1Plan(doc, overwrite);
      expect(plan.conflicts).to.equal(1);
      if (plan.edits.length > 0) {
        new XMLEditor().commit(plan.edits);
      }
      const sections = doc.getElementsByTagNameNS(sldNs, 'Section');
      expect(sections).to.have.lengthOf(1);
      expect(sections[0].getAttributeNS(sldNs, 'bus')).to.equal(overwrite ? 'false' : 'true');
    }
  });

  it('copies both linked and direct legacy IED placement without altering the IED or source', () => {
    const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
      <Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A" old:x="0" old:y="-3"/></Private>
      </Bay></VoltageLevel></Substation><IED name="A"/><IED name="B" old:x="2" old:ly="4"/>`);
    const plan = copySldV1Plan(doc);
    expect(plan.issues).to.deep.equal([]);
    new XMLEditor().commit(plan.edits);
    const refs = Array.from(doc.getElementsByTagNameNS(sldNs, 'Reference'));
    expect(refs).to.have.lengthOf(2);
    const a = refs.find(reference => reference.getAttributeNS(sldNs, 'id') === 'A');
    const b = refs.find(reference => reference.getAttributeNS(sldNs, 'id') === 'B');
    expect(a?.parentElement?.parentElement?.localName).to.equal('Bay');
    expect(b?.parentElement?.parentElement?.localName).to.equal('Substation');
    expect(doc.querySelector('IED[name="B"]')?.getAttributeNS(sldV1Ns, 'x')).to.equal('2');
    expect(doc.querySelector('Private[type="OpenSCD-Linked-IEDs"]')).to.not.equal(null);
  });

  it('reconciles IED conflicts without duplicating references', () => {
    for (const overwrite of [false, true]) {
      const doc = parse(`<Substation name="S">
        <Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A" old:x="1"/></Private>
        <Private type="${privType}"><new:Reference new:id="A" new:type="IED">
          <new:SLDAttributes new:x="9"/></new:Reference></Private>
        </Substation><IED name="A"/>`);
      const plan = copySldV1Plan(doc, overwrite);
      expect(plan.conflicts).to.equal(1);
      if (plan.edits.length > 0) {
        new XMLEditor().commit(plan.edits);
      }
      expect(doc.getElementsByTagNameNS(sldNs, 'Reference')).to.have.lengthOf(1);
      expect(layout(doc)[0].getAttributeNS(sldNs, 'x')).to.equal(overwrite ? '1' : '9');
    }
  });

  it('copies prefixed IEDs with the same identity as unprefixed IEDs', () => {
    const doc = new DOMParser().parseFromString(
      `<s:SCL xmlns:s="${sclNs}" xmlns:o="${sldV1Ns}">
        <s:Substation name="S"/><s:IED name="A" o:x="0"/>
      </s:SCL>`, 'application/xml',
    );
    const plan = copySldV1Plan(doc);
    expect(plan.issues.length).to.equal(0);
    new XMLEditor().commit(plan.edits);
    expect(doc.getElementsByTagNameNS(sldNs, 'Reference')[0].getAttributeNS(sldNs, 'id')).to.equal('A');
  });

  it('does not create empty references for linked IEDs without coordinates', () => {
    const doc = parse(`<Substation name="S" old:x="0">
      <Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A"/></Private>
      </Substation><IED name="A"/>`);
    new XMLEditor().commit(copySldV1Plan(doc).edits);
    expect(doc.getElementsByTagNameNS(sldNs, 'Reference').length).to.equal(0);
  });

  it('blocks overwriting connectivity sections containing vendor content', () => {
    const doc = parse(`<Substation name="S"><VoltageLevel name="V"><Bay name="B">
      <ConnectivityNode name="N" pathName="S/V/B/N">
        <Private type="Transpower-SLD-Vertices"><old:Section><old:Vertex old:x="1"/></old:Section></Private>
        <Private type="${privType}"><new:Section><vendor:Data/></new:Section></Private>
      </ConnectivityNode></Bay></VoltageLevel></Substation>`);
    expect(copySldV1Plan(doc, true).issues.length).to.equal(1);
    expect(copySldV1Plan(doc, true).edits.length).to.equal(0);
    expect(copySldV1Plan(doc).issues.length).to.equal(0);
  });

  for (const body of [
    '<Substation name="S"/><Substation name="T"/><IED name="A" old:x="1"/>',
    '<Substation name="S"><Private type="OpenSCD-Linked-IEDs"><IEDName old:name="Missing" old:x="1"/></Private></Substation>',
    '<Substation name="S" old:unknown="1"/>',
    `<Substation name="S" old:x="1"><Private type="${privType}"/><Private type="${privType}"/></Substation>`,
    `<Substation name="S" old:x="1"><Private type="${privType}"><new:SLDAttributes/><new:SLDAttributes/></Private></Substation>`,
    '<Substation name="S"><Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A" old:x="1"/><IEDName old:name="A" old:x="2"/></Private></Substation><IED name="A"/>',
    '<Substation name="S"><Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A" old:x="1"/></Private></Substation><IED name="A" old:x="2"/>',
    '<Substation name="S"/><vendor:Bay old:x="1"/>',
  ]) {
    it(`blocks ambiguous/unsupported input without partial edits: ${body.slice(0, 70)}`, () => {
      const doc = parse(body);
      const before = serialize(doc);
      const plan = copySldV1Plan(doc, true);
      expect(plan.issues.length).to.be.greaterThan(0);
      expect(plan.edits).to.deep.equal([]);
      expect(serialize(doc)).to.equal(before);
    });
  }

  it('removes selected systems completely, preserving vendor and unselected data, with undo/redo', () => {
    const doc = parse(`<Substation name="S" old:x="0" xy:y="-1" vendor:x="9">
      <Private type="${privType}"><new:SLDAttributes new:x="2"/></Private>
      <Private type="OpenSCD-Linked-IEDs"><IEDName old:name="A" old:x="1"/></Private>
      <Private type="vendor"><vendor:Data vendor:x="3"/></Private>
      </Substation><IED name="A" old:y="0"/>`);
    const before = serialize(doc);
    const editor = new XMLEditor();
    const plan = cleanCoordinatePlan(doc, ['sldv1', 'sxy']);
    expect(plan.issues).to.deep.equal([]);
    expect(serialize(doc)).to.equal(before);
    editor.commit(plan.edits);
    expect(detectCoordinateSystems(doc).sldv1).to.equal(0);
    expect(detectCoordinateSystems(doc).sxy).to.equal(0);
    expect(layout(doc)).to.have.lengthOf(1);
    expect(doc.querySelector('Substation')?.getAttributeNS(vendorNs, 'x')).to.equal('9');
    expect(doc.querySelector('Private[type="vendor"]')).to.not.equal(null);
    const after = serialize(doc);
    editor.undo();
    expect(doc.documentElement.isEqualNode(
      new DOMParser().parseFromString(before, 'application/xml').documentElement,
    )).to.equal(true);
    editor.redo();
    expect(serialize(doc)).to.equal(after);
    editor.commit(cleanCoordinatePlan(doc, ['sldpriv']).edits);
    expect(detectCoordinateSystems(doc)).to.deep.equal({ sldv1: 0, sldpriv: 0, sxy: 0 });
    expect(doc.querySelector('Private[type="vendor"]')).to.not.equal(null);
  });

  it('recognizes and removes orphan namespaced layout elements', () => {
    const doc = parse('<Substation name="S"><old:Section><old:Vertex old:x="1"/></old:Section></Substation>');
    new XMLEditor().commit(cleanCoordinatePlan(doc, ['sldv1']).edits);
    expect(detectCoordinateSystems(doc).sldv1).to.equal(0);
  });

  it('blocks removing orphan layout elements containing vendor children', () => {
    const doc = parse('<Substation name="S"><old:Section><vendor:Data/></old:Section></Substation>');
    const plan = cleanCoordinatePlan(doc, ['sldv1']);
    expect(plan.issues.length).to.equal(1);
    expect(plan.edits.length).to.equal(0);
  });

  it('removes unused selected namespace declarations but retains vendor and unselected declarations', () => {
    const doc = parse('<Substation name="S" old:x="0" xy:x="1"/>');
    new XMLEditor().commit(cleanCoordinatePlan(doc, ['sldv1']).edits);
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'old')).to.equal(null);
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'xy')).to.equal(sxyNs);
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'vendor')).to.equal(vendorNs);
  });

  it('retains a selected namespace declaration still referenced by QName metadata', () => {
    const doc = parse('<Substation name="S" old:x="1"><Private type="vendor"><vendor:Data type="old:Metadata"/></Private></Substation>');
    new XMLEditor().commit(cleanCoordinatePlan(doc, ['sldv1']).edits);
    expect(doc.documentElement.getAttributeNS(xmlnsNs, 'old')).to.equal(sldV1Ns);
    expect(detectCoordinateSystems(doc).sldv1).to.equal(0);
  });

  it('blocks cleanup rather than deleting unrelated data mixed inside a layout Private', () => {
    const doc = parse(`<Substation name="S" old:x="1"><Private type="${privType}">
      <new:SLDAttributes new:x="2"/><vendor:Data/></Private></Substation>`);
    const before = serialize(doc);
    const plan = cleanCoordinatePlan(doc, ['sldv1', 'sldpriv']);
    expect(plan.edits).to.deep.equal([]);
    expect(plan.issues).to.have.lengthOf(1);
    expect(serialize(doc)).to.equal(before);
  });
});
