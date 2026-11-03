import { msg } from '@lit/localize';
import { OscdFilledButton } from '@omicronenergy/oscd-ui/button/OscdFilledButton.js';
import { OscdTextButton } from '@omicronenergy/oscd-ui/button/OscdTextButton.js';
import { OscdCheckbox } from '@omicronenergy/oscd-ui/checkbox/OscdCheckbox.js';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { newEditEventV2 } from '@openscd/oscd-api/utils.js';
import { css, html, LitElement, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';

import {
  cleanCoordinatePlan, coordinateSystems, detectCoordinateSystems,
} from './foundation/coordinate-systems.js';

import type { CoordinateSystem } from './foundation/coordinate-systems.js';

export default class OscdMenuSldCoordsCleaner extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-dialog': OscdDialog,
    'oscd-checkbox': OscdCheckbox,
    'oscd-text-button': OscdTextButton,
    'oscd-filled-button': OscdFilledButton,
  };

  @property({ attribute: false })
  doc?: XMLDocument;

  @property({ type: Number })
  docVersion = 0;

  @state()
  private counts = { sldv1: 0, sldpriv: 0, sxy: 0 };

  @state()
  private selected: CoordinateSystem[] = [];

  @state()
  private acknowledged = false;

  @state()
  private result = '';

  @state()
  private issues: string[] = [];

  @query('oscd-dialog')
  private dialog?: OscdDialog;

  private snapshot?: { doc: XMLDocument; version: number };

  async run(): Promise<void> {
    this.selected = [];
    this.acknowledged = false;
    this.result = '';
    this.issues = [];
    this.snapshot = this.doc === undefined ? undefined : { doc: this.doc, version: this.docVersion };
    this.counts = this.doc === undefined ? { sldv1: 0, sldpriv: 0, sxy: 0 } : detectCoordinateSystems(this.doc);
    await this.updateComplete;
    await this.dialog?.show();
  }

  private handleSelection(system: CoordinateSystem, event: Event): void {
    if (event.target instanceof OscdCheckbox && this.counts[system] > 0) {
      this.selected = event.target.checked
        ? [...this.selected.filter(value => value !== system), system]
        : this.selected.filter(value => value !== system);
      this.acknowledged = false;
      this.issues = [];
    }
  }

  private handleAcknowledgment(event: Event): void {
    if (event.target instanceof OscdCheckbox) {
      this.acknowledged = event.target.checked;
    }
  }

  private async handleRemove(): Promise<void> {
    if (this.doc === undefined || this.isStale() || this.result !== '' ||
        this.selected.length === 0 || (this.removesAll() && !this.acknowledged)) {
      return;
    }
    const plan = cleanCoordinatePlan(this.doc, this.selected);
    this.issues = plan.issues;
    if (plan.issues.length > 0) {
      return;
    }
    if (plan.edits.length === 0) {
      this.result = msg('No coordinates found to remove.');
      return;
    }
    this.dispatchEvent(newEditEventV2(plan.edits, { title: msg('Remove selected SLD coordinates') }));
    this.result = msg('Selected coordinates removed. Unselected systems were retained.');
    await this.dialog?.close();
  }

  private isStale(): boolean {
    return this.snapshot !== undefined &&
      (this.snapshot.doc !== this.doc || this.snapshot.version !== this.docVersion);
  }

  private removesAll(): boolean {
    const found = coordinateSystems.filter(system => this.counts[system] > 0);
    return found.length > 0 && found.every(system => this.selected.includes(system));
  }

  render() {
    return html`<oscd-dialog>
      <div slot="headline">${msg('SLD Coords cleaner')}</div>
      <div slot="content">
        <p>${msg('Remove selected coordinate systems, including their layout Private sections. This operation can be undone.')}</p>
        ${this.doc === undefined ? html`<p role="alert">${msg('Open a document first.')}</p>` : nothing}
        ${this.doc !== undefined && coordinateSystems.every(system => this.counts[system] === 0)
          ? html`<p>${msg('No supported coordinate systems found.')}</p>` : nothing}
        ${this.result !== '' ? html`<p role="status">${this.result}</p>` : nothing}
        ${this.result === '' && this.isStale() ? html`<p role="alert">${msg('The document changed. Close and reopen this plugin before removing coordinates.')}</p>` : nothing}
        ${coordinateSystems.map(system => html`
          <label>
            <oscd-checkbox
              .disabled=${this.counts[system] === 0 || this.result !== ''}
              .checked=${this.selected.includes(system)}
              @change=${(event: Event) => this.handleSelection(system, event)}
            ></oscd-checkbox>
            ${system === 'sldv1' ? msg('SLDv1') : system === 'sldpriv' ? msg('SLD Private') : msg('SXY')}
          </label>
        `)}
        ${this.removesAll() && this.result === '' ? html`
          <label>
            <oscd-checkbox .checked=${this.acknowledged} @change=${this.handleAcknowledgment}></oscd-checkbox>
            ${msg('Are you sure? Removing all coordinates means nothing will appear on the SLD Designer canvas')}
          </label>
        ` : nothing}
        ${this.issues.length > 0 ? html`<ul role="alert">${this.issues.map(issue => html`<li>${issue}</li>`)}</ul>` : nothing}
      </div>
      <div slot="actions">
        <oscd-text-button @click=${() => this.dialog?.close()}>${this.result === '' ? msg('Cancel') : msg('Close')}</oscd-text-button>
        ${this.result !== '' ? nothing : html`
          <oscd-filled-button
            .disabled=${this.doc === undefined || this.isStale() || this.selected.length === 0 ||
              (this.removesAll() && !this.acknowledged)}
            @click=${this.handleRemove}
          >${msg('Remove coordinates')}</oscd-filled-button>
        `}
      </div>
    </oscd-dialog>`;
  }

  static styles = css`
    :host { display: block; }
    label { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    oscd-checkbox { flex: none; }
  `;
}
