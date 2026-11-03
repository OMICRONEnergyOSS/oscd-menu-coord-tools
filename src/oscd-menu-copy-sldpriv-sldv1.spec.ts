import { expect, fixture, html } from '@open-wc/testing';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';

import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';
import OscdMenuCopySldprivSldv1 from './oscd-menu-copy-sldpriv-sldv1.js';
import { privType, sldNs } from './foundation/layout-util.js';

customElements.define('test-copy-to-sldv1', OscdMenuCopySldprivSldv1);

describe('SLD Private to SLDv1 menu', () => {
  const preferenceKey = 'oscd-coordinate-copy:oscd-menu-copy-sldpriv-sldv1:introductionDismissed';

  beforeEach(() => localStorage.removeItem(preferenceKey));
  afterEach(() => localStorage.removeItem(preferenceKey));

  it('hydrates a dismissed introduction before the scoped copier can overwrite the saved flag', async () => {
    localStorage.setItem(preferenceKey, 'true');
    const doc = new DOMParser().parseFromString(
      `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:n="${sldNs}"><Substation name="S">
        <Private type="${privType}"><n:SLDAttributes n:x="1"/></Private></Substation></SCL>`,
      'application/xml',
    );
    const menu = await fixture<OscdMenuCopySldprivSldv1>(
      html`<test-copy-to-sldv1 .doc=${doc}></test-copy-to-sldv1>`,
    );
    let transactions = 0;
    menu.addEventListener('oscd-edit-v2', () => {
      transactions += 1;
    });
    await menu.run();
    const copier = menu.shadowRoot?.querySelector('oscd-coordinate-copy-dialog');
    const dialog = copier?.shadowRoot?.querySelector('oscd-dialog');
    expect(dialog instanceof OscdDialog && dialog.open).to.equal(false);
    expect(localStorage.getItem(preferenceKey)).to.equal('true');
    expect(transactions).to.equal(1);
  });

  it('opens the shared copier with the document, version and export direction', async () => {
    const doc = new DOMParser().parseFromString('<SCL/>', 'application/xml');
    const menu = await fixture<OscdMenuCopySldprivSldv1>(
      html`<test-copy-to-sldv1 .doc=${doc} .docVersion=${4}></test-copy-to-sldv1>`,
    );
    const copier = menu.shadowRoot?.querySelector('oscd-coordinate-copy-dialog');
    expect(copier).to.be.instanceOf(OscdCoordinateCopyDialog);
    if (!(copier instanceof OscdCoordinateCopyDialog)) {
      throw new Error('Copier did not upgrade');
    }
    await copier.updateComplete;
    const dialog = copier.shadowRoot?.querySelector('oscd-dialog');
    if (!(dialog instanceof OscdDialog)) {
      throw new Error('Dialog did not upgrade');
    }
    dialog.quick = true;
    await menu.run();
    expect(dialog.open).to.equal(true);
    expect(copier.doc).to.equal(doc);
    expect(copier.docVersion).to.equal(4);
    expect(copier.direction).to.equal('to-sldv1');
    expect(copier.id).to.equal('oscd-menu-copy-sldpriv-sldv1');
    menu.doc = undefined;
    await menu.updateComplete;
    await copier.updateComplete;
    expect(copier.shadowRoot?.textContent).to.contain('Open a document first');
    await dialog.close();
  });
});
