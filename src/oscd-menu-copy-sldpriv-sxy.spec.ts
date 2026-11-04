import { expect, fixture, html } from '@open-wc/testing';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';

import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';
import OscdMenuCopySldprivSxy from './oscd-menu-copy-sldpriv-sxy.js';
import { privType, sldNs } from './foundation/layout-util.js';

customElements.define('test-copy-private-sxy', OscdMenuCopySldprivSxy);

describe('SLD Private to SXY menu', () => {
  const preference = 'oscd-coordinate-copy:oscd-menu-copy-sldpriv-sxy:introductionDismissed';

  afterEach(() => localStorage.removeItem(preference));

  it('forwards document/version/direction and hydrates its independent preference in a scoped copier', async () => {
    localStorage.setItem(preference, 'true');
    const doc = new DOMParser().parseFromString(
      `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:n="${sldNs}">
        <Substation name="S"><Private type="${privType}"><n:SLDAttributes n:x="1" n:y="2"/></Private></Substation></SCL>`,
      'application/xml',
    );
    const menu = await fixture<OscdMenuCopySldprivSxy>(
      html`<test-copy-private-sxy .doc=${doc} .docVersion=${4}></test-copy-private-sxy>`,
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
    expect(copier.docVersion).to.equal(4);
    expect(copier.direction).to.equal('to-sxy');
    expect(copier.id).to.equal('oscd-menu-copy-sldpriv-sxy');
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
