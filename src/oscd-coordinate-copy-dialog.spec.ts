import { expect, fixture, waitUntil } from '@open-wc/testing';
import { OscdCheckbox } from '@omicronenergy/oscd-ui/checkbox/OscdCheckbox.js';
import { OscdFilledButton } from '@omicronenergy/oscd-ui/button/OscdFilledButton.js';
import { OscdTextButton } from '@omicronenergy/oscd-ui/button/OscdTextButton.js';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';
import { OscdSnackbar } from '@omicronenergy/oscd-ui/snackbar/OscdSnackbar.js';
import { XMLEditor } from '@openscd/oscd-editor';

import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';
import { copySldPrivatePlan, copySldV1Plan, sldV1Ns } from './foundation/coordinate-systems.js';
import { privType, sldNs } from './foundation/layout-util.js';

import type { EditEventV2 } from '@openscd/oscd-api';

customElements.define('test-copy-sld', OscdCoordinateCopyDialog);

function documentWithConflicts(toPrivate: boolean): XMLDocument {
  return new DOMParser().parseFromString(
    `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:old="${sldV1Ns}" xmlns:n="${sldNs}">
      <Substation name="S" old:x="${toPrivate ? 1 : 9}"><Private type="${privType}"><n:SLDAttributes n:x="${toPrivate ? 9 : 1}"/></Private>
        <VoltageLevel name="V" old:x="${toPrivate ? 2 : 8}"><Private type="${privType}"><n:SLDAttributes n:x="${toPrivate ? 8 : 2}"/></Private>
          ${toPrivate ? '<Bay name="B" old:x="0"/>' : `<Bay name="B"><Private type="${privType}"><n:SLDAttributes n:x="0"/></Private></Bay>`}
        </VoltageLevel>
      </Substation>
    </SCL>`, 'application/xml',
  );
}

(['to-private', 'to-sldv1'] as const).forEach(direction => describe(`Coordinate copy dialog (${direction})`, () => {
  const toPrivate = direction === 'to-private';
  let element: OscdCoordinateCopyDialog;
  let editor: XMLEditor;
  let events: EditEventV2[];
  let dialog: OscdDialog;
  let snackbar: OscdSnackbar;
  const pluginId = toPrivate ? 'oscd-menu-copy-sldv1-sldpriv' : 'oscd-menu-copy-sldpriv-sldv1';
  const preferenceKey = `oscd-coordinate-copy:${pluginId}:introductionDismissed`;
  const otherPluginId = toPrivate ? 'oscd-menu-copy-sldpriv-sldv1' : 'oscd-menu-copy-sldv1-sldpriv';
  const otherPreferenceKey = `oscd-coordinate-copy:${otherPluginId}:introductionDismissed`;

  async function createCopier(doc: XMLDocument, id = pluginId) {
    const host = document.createElement('test-copy-sld');
    if (!(host instanceof OscdCoordinateCopyDialog)) {
      throw new Error('Copier did not upgrade');
    }
    host.id = id;
    host.doc = doc;
    host.direction = direction;
    host.addEventListener('oscd-edit-v2', (event) => {
      events.push(event);
      editor.commit(event.detail.edit);
    });
    return fixture<OscdCoordinateCopyDialog>(host);
  }

  async function clickAction(label: string) {
    const button = Array.from(element.shadowRoot?.querySelectorAll('oscd-filled-button, oscd-text-button') ?? [])
      .find(candidate => candidate.textContent?.trim() === label);
    if (!(button instanceof OscdFilledButton || button instanceof OscdTextButton)) {
      throw new Error(`Action not found: ${label}`);
    }
    button.click();
    await element.updateComplete;
  }

  async function dismissIntroduction() {
    const checkbox = element.shadowRoot?.querySelector('oscd-checkbox');
    if (!(checkbox instanceof OscdCheckbox)) {
      throw new Error('Introduction checkbox did not upgrade');
    }
    expect(checkbox.checked).to.equal(false);
    checkbox.click();
    await checkbox.updateComplete;
    await element.updateComplete;
  }

  async function notification() {
    await waitUntil(() => (snackbar.shadowRoot?.querySelector('[role="status"]:not(.closing)') ?? null) !== null);
    return snackbar.shadowRoot?.querySelector('[role="status"]:not(.closing)')?.textContent ?? '';
  }

  beforeEach(async () => {
    localStorage.removeItem(preferenceKey);
    localStorage.removeItem(otherPreferenceKey);
    editor = new XMLEditor();
    events = [];
    element = await createCopier(documentWithConflicts(toPrivate));
    const foundDialog = element.shadowRoot?.querySelector('oscd-dialog');
    const foundSnackbar = element.shadowRoot?.querySelector('oscd-snackbar');
    if (!(foundDialog instanceof OscdDialog) || !(foundSnackbar instanceof OscdSnackbar)) {
      throw new Error('Feedback components did not upgrade');
    }
    dialog = foundDialog;
    snackbar = foundSnackbar;
    dialog.quick = true;
    await element.run();
    expect(dialog.open).to.equal(true);
  });

  afterEach(async () => {
    await dialog.close();
    snackbar.close();
    localStorage.removeItem(preferenceKey);
    localStorage.removeItem(otherPreferenceKey);
  });

  for (const overwrite of [false, true]) {
    it(`${overwrite ? 'overwrites' : 'skips'} differing destinations in one transaction and closes with snackbar feedback`, async () => {
      expect(element.shadowRoot?.textContent).to.contain('2 destination layout records differ');
      const before = element.doc?.documentElement.cloneNode(true);
      await clickAction(overwrite ? 'Overwrite existing' : 'Skip existing');
      expect(await notification()).to.contain(`Copied ${overwrite ? 3 : 1} layout records; skipped ${overwrite ? 0 : 2}`);
      expect(dialog.open).to.equal(false);
      expect(events).to.have.lengthOf(1);
      expect(editor.past).to.have.lengthOf(1);
      const records = toPrivate
        ? Array.from(element.doc?.getElementsByTagNameNS(sldNs, 'SLDAttributes') ?? [])
        : Array.from(element.doc?.querySelectorAll('Substation, VoltageLevel, Bay') ?? []);
      const targetNs = toPrivate ? sldNs : sldV1Ns;
      expect(records[0].getAttributeNS(targetNs, 'x')).to.equal(overwrite ? '1' : '9');
      expect(records[1].getAttributeNS(targetNs, 'x')).to.equal(overwrite ? '2' : '8');
      expect(records[2].getAttributeNS(targetNs, 'x')).to.equal('0');
      const source = toPrivate ? element.doc?.querySelector('Substation')
        : element.doc?.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0];
      expect(source?.getAttributeNS(toPrivate ? sldV1Ns : sldNs, 'x')).to.equal('1');
      const after = element.doc?.documentElement.cloneNode(true);
      editor.undo();
      expect(element.doc?.documentElement.isEqualNode(before ?? null)).to.equal(true);
      editor.redo();
      expect(element.doc?.documentElement.isEqualNode(after ?? null)).to.equal(true);
    });
  }

  it('cancels without edits', async () => {
    await dismissIntroduction();
    await clickAction('Cancel');
    expect(events).to.have.lengthOf(0);
    expect(localStorage.getItem(preferenceKey)).not.to.equal('true');
    expect(element.doc?.getElementsByTagNameNS(sldNs, 'SLDAttributes')).to.have.lengthOf(toPrivate ? 2 : 3);
  });

  it('uses the theme font for snackbar feedback with a Material fallback', async () => {
    await clickAction('Skip existing');
    await notification();
    const message = snackbar.shadowRoot?.querySelector('[role="status"]');
    if (!(message instanceof HTMLElement)) {
      throw new Error('Snackbar message is unavailable');
    }
    expect(getComputedStyle(message).fontFamily).to.equal('Roboto, sans-serif');
    element.style.setProperty('--oscd-theme-font-family', 'monospace');
    expect(getComputedStyle(message).fontFamily).to.equal('monospace');
  });

  it('explains the selected formats and places the introduction preference after all content', () => {
    const content = element.shadowRoot?.querySelector('[slot="content"]');
    const introduction = content?.querySelector('p')?.textContent ?? '';
    expect(introduction).to.contain(toPrivate
      ? 'SLDv1 is the older OpenSCD single-line diagram layout format'
      : 'SLD Private is the layout format used by the current OpenSCD');
    expect(introduction).to.contain(toPrivate
      ? 'into SLD Private, the format used by the current SLD editor'
      : 'into SLDv1, the older format');
    expect(introduction).to.contain(`The original ${toPrivate ? 'SLDv1' : 'SLD Private'} data is kept`);
    const preference = content?.lastElementChild;
    expect(preference?.classList.contains('introduction-preference')).to.equal(true);
    expect(preference?.querySelector('oscd-checkbox') instanceof OscdCheckbox).to.equal(true);
    expect(preference instanceof HTMLElement && parseFloat(getComputedStyle(preference).marginTop) > 0).to.equal(true);
    expect(content?.textContent).not.to.contain('violates the SCL schema');
  });

  it('blocks a stale version and a replacement document', async () => {
    for (const changeDoc of [false, true]) {
      await element.run();
      if (changeDoc) {
        element.doc = documentWithConflicts(toPrivate);
      } else {
        element.docVersion += 1;
      }
      await element.updateComplete;
      const button = element.shadowRoot?.querySelector('oscd-filled-button');
      expect(button instanceof OscdFilledButton).to.equal(true);
      if (button instanceof OscdFilledButton) {
        expect(button.disabled).to.equal(true);
        button.click();
      }
      expect(element.shadowRoot?.textContent).to.contain('document changed');
      expect(events).to.have.lengthOf(0);
    }
  });

  it('remembers only the introduction using the plugin ID and still asks about later conflicts', async () => {
    await dismissIntroduction();
    await clickAction('Skip existing');
    await notification();
    expect(localStorage.getItem(preferenceKey)).to.equal('true');
    expect(localStorage.getItem(otherPreferenceKey)).not.to.equal('true');
    await element.run();
    expect(dialog.open).to.equal(true);
    expect(element.shadowRoot?.querySelector('oscd-checkbox')).to.equal(null);
    expect(element.shadowRoot?.textContent).to.contain('2 destination layout records differ');
    await clickAction('Overwrite existing');
    await notification();
    element.doc = documentWithConflicts(toPrivate);
    await element.run();
    expect(dialog.open).to.equal(true);
    await clickAction('Skip existing');
    expect(events).to.have.lengthOf(3);
    const target = toPrivate ? element.doc.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0]
      : element.doc.querySelector('Substation');
    expect(target?.getAttributeNS(toPrivate ? sldNs : sldV1Ns, 'x')).to.equal('9');
  });

  it('does not suppress the introduction unless the checkbox was selected', async () => {
    await clickAction('Overwrite existing');
    await notification();
    element.doc = documentWithConflicts(toPrivate);
    await element.run();
    expect(dialog.open).to.equal(true);
    expect(element.shadowRoot?.querySelector('oscd-checkbox')).to.be.instanceOf(OscdCheckbox);
  });

  it('shows matching destinations as Close-only after remounting', async () => {
    await dismissIntroduction();
    await clickAction('Overwrite existing');
    await notification();
    await element.run();
    expect(dialog.open).to.equal(true);
    expect(element.shadowRoot?.textContent).to.contain('already matches');
    await clickAction('Close');
    await waitUntil(() => !dialog.open);
    expect(events).to.have.lengthOf(1);
    const samePlugin = await createCopier(element.doc ?? documentWithConflicts(toPrivate));
    const sameDialog = samePlugin.shadowRoot?.querySelector('oscd-dialog');
    if (!(sameDialog instanceof OscdDialog)) {
      throw new Error('Dialog did not upgrade');
    }
    sameDialog.quick = true;
    await samePlugin.run();
    expect(sameDialog.open).to.equal(true);
    expect(samePlugin.shadowRoot?.querySelectorAll('[slot="actions"] > *').length).to.equal(1);
    expect(samePlugin.shadowRoot?.querySelector('oscd-text-button')?.textContent?.trim()).to.equal('Close');
    await sameDialog.close();
    const differentPlugin = await createCopier(documentWithConflicts(toPrivate), otherPluginId);
    const differentDialog = differentPlugin.shadowRoot?.querySelector('oscd-dialog');
    if (!(differentDialog instanceof OscdDialog)) {
      throw new Error('Dialog did not upgrade');
    }
    differentDialog.quick = true;
    await differentPlugin.run();
    expect(differentDialog.open).to.equal(true);
    expect(differentPlugin.shadowRoot?.querySelector('oscd-checkbox')).to.be.instanceOf(OscdCheckbox);
    await differentDialog.close();
  });

  it('automatically copies missing destinations once the introduction is dismissed', async () => {
    await dismissIntroduction();
    await clickAction('Overwrite existing');
    await notification();
    const next = documentWithConflicts(toPrivate);
    if (toPrivate) {
      next.querySelectorAll('Private').forEach(section => section.remove());
    } else {
      next.querySelectorAll('*').forEach(owner => owner.removeAttributeNS(sldV1Ns, 'x'));
    }
    element.doc = next;
    await element.run();
    expect(dialog.open).to.equal(false);
    expect(await notification()).to.contain('Copied 3 layout records; skipped 0');
    expect(events).to.have.lengthOf(2);
  });

  it('closes silently when every conflict is skipped without dispatching edits or showing a snackbar', async () => {
    element.doc?.querySelector('Bay')?.remove();
    await element.run();
    let notifications = 0;
    const show = snackbar.show;
    snackbar.show = (options) => {
      notifications += 1;
      return show.call(snackbar, options);
    };
    try {
      await clickAction('Skip existing');
      await waitUntil(() => !dialog.open);
      expect(notifications).to.equal(0);
      expect(events).to.have.lengthOf(0);
    } finally {
      snackbar.show = show;
    }
  });

  it('ignores repeated submit clicks while completing a copy', async () => {
    const button = element.shadowRoot?.querySelector('oscd-filled-button');
    if (!(button instanceof OscdFilledButton)) {
      throw new Error('Copy button did not upgrade');
    }
    button.click();
    button.click();
    await notification();
    expect(events).to.have.lengthOf(1);
  });

  it('reports an unsaved introduction preference instead of claiming it was retained', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
    try {
      await dismissIntroduction();
      await clickAction('Overwrite existing');
      expect(await notification()).to.contain('could not save your preference');
      element.doc = documentWithConflicts(toPrivate);
      await element.run();
      expect(dialog.open).to.equal(true);
      expect(element.shadowRoot?.querySelector('oscd-checkbox')).to.be.instanceOf(OscdCheckbox);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('keeps a failed preference save visible in the dialog without a snackbar when all conflicts are skipped', async () => {
    element.doc?.querySelector('Bay')?.remove();
    await element.run();
    const original = Storage.prototype.setItem;
    const show = snackbar.show;
    let notifications = 0;
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
    snackbar.show = (options) => {
      notifications += 1;
      return show.call(snackbar, options);
    };
    try {
      await dismissIntroduction();
      await clickAction('Skip existing');
      expect(dialog.open).to.equal(true);
      expect(element.shadowRoot?.querySelector('[role="alert"]')?.textContent)
        .to.contain('could not save your preference');
      expect(events.length).to.equal(0);
      expect(notifications).to.equal(0);
    } finally {
      Storage.prototype.setItem = original;
      snackbar.show = show;
    }
  });

  it('reports ambiguity and prevents partial copies', async () => {
    await dismissIntroduction();
    await clickAction('Skip existing');
    await notification();
    const source = toPrivate ? element.doc?.querySelector('Substation')
      : element.doc?.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0];
    source?.setAttributeNS(toPrivate ? sldV1Ns : sldNs, 'unknown:unknown', '1');
    await element.run();
    expect(element.shadowRoot?.querySelector('oscd-filled-button')).to.equal(null);
    expect(element.shadowRoot?.textContent).to.contain('Unsupported');
    expect(events).to.have.lengthOf(1);
  });

  it('does not show an introduction or dismissal checkbox for blocking issues before onboarding', async () => {
    const source = toPrivate ? element.doc?.querySelector('Substation')
      : element.doc?.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0];
    source?.setAttributeNS(toPrivate ? sldV1Ns : sldNs, 'unknown:unknown', '1');
    await element.run();
    expect(dialog.open).to.equal(true);
    expect(element.shadowRoot?.textContent).to.contain('Unsupported');
    expect(element.shadowRoot?.textContent).not.to.contain('The original');
    expect(element.shadowRoot?.querySelector('oscd-checkbox') === null).to.equal(true);
    expect(element.shadowRoot?.querySelector('oscd-filled-button') === null).to.equal(true);
    await clickAction('Close');
    expect(events.length).to.equal(0);
    expect(localStorage.getItem(preferenceKey)).not.to.equal('true');
  });

  if (toPrivate) {
    it('shows Text compatibility information separately even after introduction dismissal, but not for a matching rerun', async () => {
      await dismissIntroduction();
      await clickAction('Overwrite existing');
      await notification();
      element.doc = new DOMParser().parseFromString(
        `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:old="${sldV1Ns}">
          <Substation name="S"><Text old:x="1" old:y="2">Annotation</Text></Substation>
        </SCL>`, 'application/xml',
      );
      await element.run();
      expect(dialog.open).to.equal(true);
      expect(element.shadowRoot?.querySelector('[role="note"]')?.textContent).to.contain('violates the SCL schema');
      expect(element.shadowRoot?.querySelector('oscd-checkbox') === null).to.equal(true);
      await clickAction('Copy');
      await notification();
      await element.run();
      expect(dialog.open).to.equal(true);
      expect(element.shadowRoot?.textContent).to.contain('already matches');
      expect(element.shadowRoot?.querySelector('[role="note"]') === null).to.equal(true);
      expect(element.shadowRoot?.querySelectorAll('[slot="actions"] > *').length).to.equal(1);
      expect(element.shadowRoot?.querySelector('oscd-text-button')?.textContent?.trim()).to.equal('Close');
    });

    it('shows retained Coords as an informational note and allows copying linked placements', async () => {
      element.doc = new DOMParser().parseFromString(
        `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:old="${sldV1Ns}">
          <Substation name="S"><Private type="OpenSCD-Linked-IEDs">
            <old:IEDName old:name="A" old:x="1" old:y="2" old:lx="3" old:ly="4"/>
          </Private></Substation><IED name="A"><Private type="OpenSCD-Coords">
            <old:Coords old:lx="8" old:ly="9"/>
          </Private></IED>
        </SCL>`, 'application/xml',
      );
      await element.run();
      expect(element.shadowRoot?.querySelector('[role="note"]')?.textContent)
        .to.contain('1 legacy Coords record(s)');
      expect(element.shadowRoot?.querySelector('[role="alert"]')).to.equal(null);
      const button = element.shadowRoot?.querySelector('oscd-filled-button');
      if (!(button instanceof OscdFilledButton)) {
        throw new Error('Copy button did not upgrade');
      }
      expect(button.disabled).to.equal(false);
      await dismissIntroduction();
      button.click();
      await notification();
      expect(events).to.have.lengthOf(1);
      expect(element.doc.getElementsByTagNameNS(sldNs, 'SLDAttributes')[0].getAttributeNS(sldNs, 'lx')).to.equal('3');
      expect(element.doc.getElementsByTagNameNS(sldV1Ns, 'Coords')[0].getAttributeNS(sldV1Ns, 'lx')).to.equal('8');
      await element.run();
      expect(dialog.open).to.equal(true);
      expect(element.shadowRoot?.querySelector('oscd-checkbox')).to.equal(null);
      expect(element.shadowRoot?.querySelector('[role="note"]')?.textContent)
        .to.contain('1 legacy Coords record(s)');
    });
  }

  for (const dismissed of [false, true]) {
    it(`shows already-matching layouts with Close only and no snackbar when the introduction is ${dismissed ? 'dismissed' : 'not yet dismissed'}`, async () => {
      if (dismissed) {
        await dismissIntroduction();
        await clickAction('Overwrite existing');
        await notification();
      }
      const doc = documentWithConflicts(toPrivate);
      const copy = toPrivate ? copySldV1Plan : copySldPrivatePlan;
      new XMLEditor().commit(copy(doc, true).edits);
      element.doc = doc;
      const before = new XMLSerializer().serializeToString(doc);
      const beforeEvents = events.length;
      const preference = localStorage.getItem(preferenceKey);
      let notifications = 0;
      const show = snackbar.show;
      snackbar.show = (options) => {
        notifications += 1;
        return show.call(snackbar, options);
      };
      try {
        await element.run();
        expect(dialog.open).to.equal(true);
        const content = element.shadowRoot?.querySelector('[slot="content"]');
        expect(content?.textContent?.trim()).to.equal('No changes needed. Destination layout already matches the source.');
        expect(content?.children.length).to.equal(1);
        expect(element.shadowRoot?.querySelector('oscd-checkbox') === null).to.equal(true);
        expect(element.shadowRoot?.querySelector('oscd-filled-button') === null).to.equal(true);
        expect(element.shadowRoot?.querySelectorAll('[slot="actions"] > *').length).to.equal(1);
        expect(element.shadowRoot?.querySelector('oscd-text-button')?.textContent?.trim()).to.equal('Close');
        await clickAction('Close');
        await waitUntil(() => !dialog.open);
        expect(notifications).to.equal(0);
        expect(events.length).to.equal(beforeEvents);
        expect(new XMLSerializer().serializeToString(doc)).to.equal(before);
        expect(localStorage.getItem(preferenceKey)).to.equal(preference);
      } finally {
        snackbar.show = show;
      }
    });

    it(`shows only empty-input feedback and Close with the introduction ${dismissed ? 'dismissed' : 'not yet dismissed'}`, async () => {
      if (dismissed) {
        await dismissIntroduction();
        await clickAction('Overwrite existing');
        await notification();
      }
      const preference = localStorage.getItem(preferenceKey);
      const beforeEvents = events.length;
      element.doc = new DOMParser().parseFromString(
        `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:old="${sldV1Ns}" xmlns:n="${sldNs}">
          <Substation name="S" ${toPrivate ? '' : 'old:x="8"'}>
            ${toPrivate ? `<Private type="${privType}"><n:SLDAttributes n:x="8"/></Private>` : ''}
          </Substation>
        </SCL>`, 'application/xml',
      );
      const before = new XMLSerializer().serializeToString(element.doc);
      await element.run();
      expect(dialog.open).to.equal(true);
      const content = element.shadowRoot?.querySelector('[slot="content"]');
      expect(content?.textContent?.trim()).to.equal(
        `No ${toPrivate ? 'SLDv1' : 'SLD Private'} coordinates were found in this document. Nothing was changed.`,
      );
      expect(content?.children.length).to.equal(1);
      expect(element.shadowRoot?.querySelector('oscd-checkbox') === null).to.equal(true);
      expect(element.shadowRoot?.querySelector('oscd-filled-button') === null).to.equal(true);
      expect(element.shadowRoot?.querySelectorAll('oscd-text-button').length).to.equal(1);
      expect(element.shadowRoot?.querySelector('oscd-text-button')?.textContent?.trim()).to.equal('Close');
      await clickAction('Close');
      await waitUntil(() => !dialog.open);
      expect(events.length).to.equal(beforeEvents);
      expect(new XMLSerializer().serializeToString(element.doc)).to.equal(before);
      expect(localStorage.getItem(preferenceKey)).to.equal(preference);
      element.doc = documentWithConflicts(toPrivate);
      await element.run();
      expect(element.shadowRoot?.querySelector('oscd-checkbox') instanceof OscdCheckbox).to.equal(!dismissed);
    });
  }

  it('reports a missing document without onboarding, a checkbox, or copy actions', async () => {
    element.doc = undefined;
    await element.run();
    expect(element.shadowRoot?.textContent).to.contain('Open a document first');
    expect(element.shadowRoot?.textContent).not.to.contain('The original');
    expect(element.shadowRoot?.querySelector('oscd-checkbox') === null).to.equal(true);
    expect(element.shadowRoot?.querySelector('oscd-filled-button') === null).to.equal(true);
    expect(element.shadowRoot?.querySelector('oscd-text-button')?.textContent?.trim()).to.equal('Close');
    expect(events.length).to.equal(0);
  });
}));
