import { expect, fixture, html } from '@open-wc/testing';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';

import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';
import OscdMenuCopySxySldpriv from './oscd-menu-copy-sxy-sldpriv.js';
import { sxyNs } from './foundation/coordinate-systems.js';

customElements.define('test-copy-sxy-private', OscdMenuCopySxySldpriv);

describe('SXY to SLD Private menu', () => {
  const preference = 'oscd-coordinate-copy:oscd-menu-copy-sxy-sldpriv:introductionDismissed';

  afterEach(() => localStorage.removeItem(preference));

  it('forwards document/version/direction and hydrates its independent preference in a scoped copier', async () => {
    localStorage.setItem(preference, 'true');
    const doc = new DOMParser().parseFromString(
      `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:xy="${sxyNs}">
        <Substation name="S" xy:x="0" xy:y="0"/></SCL>`, 'application/xml',
    );
    const menu = await fixture<OscdMenuCopySxySldpriv>(
      html`<test-copy-sxy-private .doc=${doc} .docVersion=${3}></test-copy-sxy-private>`,
    );
    let transactions = 0;
    menu.addEventListener('oscd-edit-v2', () => {
      transactions += 1;
    });
    await menu.run();
    const copier = menu.shadowRoot?.querySelector('oscd-coordinate-copy-dialog');
    expect(copier).to.be.instanceOf(OscdCoordinateCopyDialog);
    if (!(copier instanceof OscdCoordinateCopyDialog)) {
      throw new Error('Copier did not upgrade');
    }
    expect(copier.doc).to.equal(doc);
    expect(copier.docVersion).to.equal(3);
    expect(copier.direction).to.equal('sxy-to-private');
    expect(copier.id).to.equal('oscd-menu-copy-sxy-sldpriv');
    const dialog = copier.shadowRoot?.querySelector('oscd-dialog');
    expect(dialog instanceof OscdDialog && dialog.open).to.equal(false);
    expect(localStorage.getItem(preference)).to.equal('true');
    expect(transactions).to.equal(1);
    menu.doc = undefined;
    await menu.updateComplete;
    await copier.updateComplete;
    expect(copier.doc).to.equal(undefined);
  });
});
