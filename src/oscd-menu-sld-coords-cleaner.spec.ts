import { expect, fixture, html, oneEvent } from '@open-wc/testing';
import { OscdCheckbox } from '@omicronenergy/oscd-ui/checkbox/OscdCheckbox.js';
import { OscdFilledButton } from '@omicronenergy/oscd-ui/button/OscdFilledButton.js';
import { OscdTextButton } from '@omicronenergy/oscd-ui/button/OscdTextButton.js';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';
import { XMLEditor } from '@openscd/oscd-editor';

import OscdMenuSldCoordsCleaner from './oscd-menu-sld-coords-cleaner.js';
import { detectCoordinateSystems, sldV1Ns, sxyNs } from './foundation/coordinate-systems.js';
import { privType, sldNs } from './foundation/layout-util.js';

import type { EditEventV2 } from '@openscd/oscd-api';

function parse(body: string): XMLDocument {
  return new DOMParser().parseFromString(
    `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:old="${sldV1Ns}"
      xmlns:n="${sldNs}" xmlns:xy="${sxyNs}">${body}</SCL>`, 'application/xml',
  );
}

customElements.define('test-clean-sld', OscdMenuSldCoordsCleaner);

describe('SLD coordinates cleaner menu', () => {
  let element: OscdMenuSldCoordsCleaner;
  let editor: XMLEditor;
  let events: EditEventV2[];

  function checkbox(index: number): OscdCheckbox {
    const box = element.shadowRoot?.querySelectorAll('oscd-checkbox')[index];
    if (!(box instanceof OscdCheckbox)) {
      throw new Error('Checkbox did not upgrade');
    }
    return box;
  }

  function removeButton(): OscdFilledButton {
    const button = element.shadowRoot?.querySelector('oscd-filled-button');
    if (!(button instanceof OscdFilledButton)) {
      throw new Error('Remove button did not upgrade');
    }
    return button;
  }

  function dialog(): OscdDialog {
    const node = element.shadowRoot?.querySelector('oscd-dialog');
    if (!(node instanceof OscdDialog)) {
      throw new Error('Dialog did not upgrade');
    }
    return node;
  }

  beforeEach(async () => {
    editor = new XMLEditor();
    events = [];
    element = await fixture(html`<test-clean-sld .doc=${parse(
      `<Substation name="S" old:x="1" xy:x="0">
        <Private type="${privType}"><n:SLDAttributes n:x="2"/></Private>
      </Substation>`,
    )} @oscd-edit-v2=${(event: EditEventV2) => {
      events.push(event);
      editor.commit(event.detail.edit);
    }}></test-clean-sld>`);
    const dialog = element.shadowRoot?.querySelector('oscd-dialog');
    if (!(dialog instanceof OscdDialog)) {
      throw new Error('Dialog did not upgrade');
    }
    dialog.quick = true;
    await element.run();
    expect(dialog.open).to.equal(true);
  });

  afterEach(async () => {
    const dialog = element.shadowRoot?.querySelector('oscd-dialog');
    if (dialog instanceof OscdDialog) {
      await dialog.close();
    }
  });

  it('starts with enabled detected systems unchecked and removal disabled', () => {
    for (const index of [0, 1, 2]) {
      expect(checkbox(index).checked).to.equal(false);
      expect(checkbox(index).disabled).to.equal(false);
    }
    expect(removeButton().disabled).to.equal(true);
    expect(element.shadowRoot?.querySelectorAll('oscd-checkbox')).to.have.lengthOf(3);
    const labels = Array.from(element.shadowRoot?.querySelectorAll('label') ?? [])
      .map(label => label.textContent?.trim());
    expect(labels).to.deep.equal(['SLDv1', 'SLD Private', 'SXY']);
  });

  it('removes only selected data in one undoable transaction', async () => {
    checkbox(0).click();
    await element.updateComplete;
    expect(removeButton().disabled).to.equal(false);
    const closed = oneEvent(dialog(), 'closed');
    removeButton().click();
    await closed;
    expect(dialog().open).to.equal(false);
    expect(events).to.have.lengthOf(1);
    expect(editor.past).to.have.lengthOf(1);
    if (element.doc === undefined) {
      throw new Error('Missing document');
    }
    const counts = detectCoordinateSystems(element.doc);
    expect(counts.sldv1).to.equal(0);
    expect(counts.sldpriv).to.be.greaterThan(0);
    expect(counts.sxy).to.equal(1);
    editor.undo();
    expect(detectCoordinateSystems(element.doc).sldv1).to.equal(1);
    editor.redo();
    expect(detectCoordinateSystems(element.doc).sldv1).to.equal(0);
  });

  it('requires a separate unchecked acknowledgment when all enabled systems are selected', async () => {
    for (const index of [0, 1, 2]) {
      checkbox(index).click();
      await element.updateComplete;
    }
    expect(element.shadowRoot?.querySelectorAll('oscd-checkbox')).to.have.lengthOf(4);
    expect(checkbox(3).checked).to.equal(false);
    expect(element.shadowRoot?.textContent).to.contain(
      'Are you sure? Removing all coordinates means nothing will appear on the SLD Designer canvas',
    );
    expect(removeButton().disabled).to.equal(true);
    removeButton().click();
    expect(events).to.have.lengthOf(0);
    checkbox(3).click();
    await element.updateComplete;
    expect(removeButton().disabled).to.equal(false);
    const closed = oneEvent(dialog(), 'closed');
    removeButton().click();
    await closed;
    expect(dialog().open).to.equal(false);
    expect(events).to.have.lengthOf(1);
    if (element.doc !== undefined) {
      expect(detectCoordinateSystems(element.doc)).to.deep.equal({ sldv1: 0, sldpriv: 0, sxy: 0 });
    }
  });

  it('disables absent systems and requires acknowledgment even if only one system exists', async () => {
    element.doc = parse('<Substation name="S" xy:x="0"/>');
    await element.run();
    expect(checkbox(0).disabled).to.equal(true);
    expect(checkbox(1).disabled).to.equal(true);
    expect(checkbox(2).disabled).to.equal(false);
    checkbox(2).click();
    await element.updateComplete;
    expect(checkbox(3).checked).to.equal(false);
    expect(removeButton().disabled).to.equal(true);
  });

  it('keeps the extra confirmation checkbox full size when the warning wraps', async () => {
    for (const index of [0, 1, 2]) {
      checkbox(index).click();
      await element.updateComplete;
    }
    const extra = checkbox(3);
    const label = extra.parentElement;
    if (label === null) {
      throw new Error('Missing confirmation label');
    }
    label.style.width = '180px';
    await extra.updateComplete;
    const width = extra.getBoundingClientRect().width;
    expect(width).to.be.greaterThan(0);
    expect(width).to.equal(checkbox(0).getBoundingClientRect().width);
  });

  it('resets acknowledgment on selection changes and all selection on reopening', async () => {
    for (const index of [0, 1, 2, 3]) {
      checkbox(index).click();
      await element.updateComplete;
    }
    expect(removeButton().disabled).to.equal(false);
    checkbox(0).click();
    await element.updateComplete;
    checkbox(0).click();
    await element.updateComplete;
    expect(checkbox(3).checked).to.equal(false);
    expect(removeButton().disabled).to.equal(true);
    await element.run();
    expect(checkbox(0).checked).to.equal(false);
    expect(checkbox(1).checked).to.equal(false);
    expect(checkbox(2).checked).to.equal(false);
  });

  it('blocks stale confirmation after document version or identity changes', async () => {
    for (const changeDoc of [false, true]) {
      await element.run();
      checkbox(0).click();
      await element.updateComplete;
      if (changeDoc) {
        element.doc = parse('<Substation name="T" old:x="1"/>');
      } else {
        element.docVersion += 1;
      }
      await element.updateComplete;
      expect(removeButton().disabled).to.equal(true);
      removeButton().click();
      expect(events).to.have.lengthOf(0);
    }
  });

  it('cancels without deleting coordinates', async () => {
    checkbox(0).click();
    await element.updateComplete;
    const cancel = element.shadowRoot?.querySelector('oscd-text-button');
    if (cancel instanceof OscdTextButton) {
      cancel.click();
    }
    expect(events).to.have.lengthOf(0);
  });

  it('reports no supported coordinates and keeps removal disabled', async () => {
    element.doc = parse('<Substation name="S"/>');
    await element.run();
    expect(element.shadowRoot?.textContent).to.contain('No supported coordinate systems found');
    expect(removeButton().disabled).to.equal(true);
    for (const index of [0, 1, 2]) {
      expect(checkbox(index).disabled).to.equal(true);
    }
  });
});
