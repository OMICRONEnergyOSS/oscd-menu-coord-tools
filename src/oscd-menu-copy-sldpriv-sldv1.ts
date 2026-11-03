import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { html, LitElement } from 'lit';
import { property, query } from 'lit/decorators.js';

import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';

export default class OscdMenuCopySldprivSldv1 extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-coordinate-copy-dialog': OscdCoordinateCopyDialog,
  };

  @property({ attribute: false })
  doc?: XMLDocument;

  @property({ type: Number })
  docVersion = 0;

  @query('oscd-coordinate-copy-dialog')
  private copier?: OscdCoordinateCopyDialog;

  async run(): Promise<void> {
    await this.updateComplete;
    if (this.copier === undefined) {
      throw new Error('The coordinate copy dialog is unavailable.');
    }
    await this.copier.run();
  }

  render() {
    return html`<oscd-coordinate-copy-dialog
      id="oscd-menu-copy-sldpriv-sldv1"
      .doc=${this.doc} .docVersion=${this.docVersion} .direction=${'to-sldv1'}
    ></oscd-coordinate-copy-dialog>`;
  }
}
