import { expect, fixture, html } from '@open-wc/testing';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';

import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';
import OscdMenuCopySldv1Sldpriv from './oscd-menu-copy-sldv1-sldpriv.js';
import { sldV1Ns } from './foundation/coordinate-systems.js';

customElements.define('test-copy-to-private', OscdMenuCopySldv1Sldpriv);

describe('SLDv1 to SLD Private menu', () => {
  const preferenceKey = 'oscd-coordinate-copy:oscd-menu-copy-sldv1-sldpriv:introductionDismissed';

  beforeEach(() => localStorage.removeItem(preferenceKey));
  afterEach(() => localStorage.removeItem(preferenceKey));

  it('hydrates a dismissed introduction before the scoped copier can overwrite the saved flag', async () => {
    localStorage.setItem(preferenceKey, 'true');
    const doc = new DOMParser().parseFromString(
      `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:old="${sldV1Ns}"><Substation name="S" old:x="1"/></SCL>`,
      'application/xml',
    );
    const menu = await fixture<OscdMenuCopySldv1Sldpriv>(
      html`<test-copy-to-private .doc=${doc}></test-copy-to-private>`,
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

  it('opens the shared copier with the document, version and import direction', async () => {
    const doc = new DOMParser().parseFromString('<SCL/>', 'application/xml');
    const menu = await fixture<OscdMenuCopySldv1Sldpriv>(
      html`<test-copy-to-private .doc=${doc} .docVersion=${4}></test-copy-to-private>`,
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
    expect(copier.direction).to.equal('to-private');
    expect(copier.id).to.equal('oscd-menu-copy-sldv1-sldpriv');
    menu.docVersion = 5;
    await menu.updateComplete;
    await copier.updateComplete;
    expect(copier.shadowRoot?.textContent).to.contain('document changed');
    await dialog.close();
  });
});
