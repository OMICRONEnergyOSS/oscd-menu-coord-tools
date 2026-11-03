import { msg, str } from '@lit/localize';
import { OscdFilledButton } from '@omicronenergy/oscd-ui/button/OscdFilledButton.js';
import { OscdTextButton } from '@omicronenergy/oscd-ui/button/OscdTextButton.js';
import { OscdCheckbox } from '@omicronenergy/oscd-ui/checkbox/OscdCheckbox.js';
import { localstorage } from '@omicronenergy/oscd-ui/decorators/localstorage.js';
import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';
import { OscdSnackbar } from '@omicronenergy/oscd-ui/snackbar/OscdSnackbar.js';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { newEditEventV2 } from '@openscd/oscd-api/utils.js';
import { css, html, LitElement, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';

import { copySldPrivatePlan, copySldV1Plan } from './foundation/coordinate-systems.js';

import type { CopyPlan } from './foundation/coordinate-systems.js';

export default class OscdCoordinateCopyDialog extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-dialog': OscdDialog,
    'oscd-checkbox': OscdCheckbox,
    'oscd-text-button': OscdTextButton,
    'oscd-filled-button': OscdFilledButton,
    'oscd-snackbar': OscdSnackbar,
  };

  @property({ attribute: false })
  doc?: XMLDocument;

  @property({ type: Number })
  docVersion = 0;

  @property({ attribute: false })
  direction: 'to-private' | 'to-sldv1' = 'to-private';

  @state()
  private plan?: CopyPlan;

  @state()
  private showIntroduction = true;

  // An initializer can overwrite saved data before hydration during scoped upgrades.
  @localstorage({ namespace: 'oscd-coordinate-copy', default: false })
  @state()
  private introductionDismissed?: boolean;

  @state()
  private hideIntroduction = false;

  @state()
  private preferenceError = '';

  @state()
  private copying = false;

  @query('oscd-dialog')
  private dialog?: OscdDialog;

  @query('oscd-snackbar')
  private snackbar?: OscdSnackbar;

  private snapshot?: { doc: XMLDocument; version: number };

  async run(): Promise<void> {
    if (this.copying) {
      return;
    }
    this.hideIntroduction = false;
    this.preferenceError = '';
    this.showIntroduction = this.introductionDismissed !== true;
    this.snapshot = this.doc === undefined ? undefined : { doc: this.doc, version: this.docVersion };
    this.plan = this.doc === undefined ? undefined : this.createPlan(this.doc);
    await this.updateComplete;
    this.snackbar?.close();
    if (this.doc === undefined || this.plan === undefined || this.plan.issues.length > 0 ||
        this.plan.conflicts > 0 || this.plan.notes.length > 0 || this.showIntroduction ||
        this.noChanges || this.isStale()) {
      await this.dialog?.show();
    } else {
      await this.handleCopy();
    }
  }

  private handleIntroductionChange(event: Event): void {
    if (event.target instanceof OscdCheckbox) {
      this.hideIntroduction = event.target.checked;
    }
  }

  private async handleCopy(overwrite = false): Promise<void> {
    if (!this.canCopy || this.copying || this.plan === undefined || this.doc === undefined) {
      return;
    }
    const plan = overwrite ? this.createPlan(this.doc, true) : this.plan;
    this.plan = plan;
    if (plan.issues.length > 0) {
      return;
    }
    this.copying = true;
    this.saveIntroductionPreference();
    if (plan.edits.length === 0 && this.preferenceError !== '') {
      this.copying = false;
      return;
    }
    if (plan.edits.length > 0) {
      this.dispatchEvent(newEditEventV2(plan.edits, { title: this.copyTitle }));
    }
    await this.dialog?.close();
    if (plan.edits.length > 0) {
      const skipped = overwrite ? 0 : plan.conflicts;
      const result = msg(str`Copied ${plan.copied} layout records; skipped ${skipped} differing destinations.`);
      this.snackbar?.show({
        message: `${this.copyTitle}: ${result}${this.preferenceError === '' ? '' : ` ${this.preferenceError}`}`,
        variant: this.preferenceError !== '' ? 'warning' : 'success',
        variantLabel: this.preferenceError !== '' ? msg('Warning:') : msg('Success:'),
        autoDismiss: this.preferenceError === '' ? true : false,
      });
    }
    this.copying = false;
  }

  private saveIntroductionPreference(): void {
    if (!this.canCopy || !this.showIntroduction || !this.hideIntroduction) {
      return;
    }
    this.introductionDismissed = true;
    let saved = false;
    try {
      saved = localStorage.getItem(`oscd-coordinate-copy:${this.id}:introductionDismissed`) === 'true';
    } catch (error) {
      if (!(error instanceof DOMException)) {
        throw error;
      }
    }
    if (!saved) {
      this.introductionDismissed = false;
      this.preferenceError = msg('The browser could not save your preference. The introduction will be shown again.');
    }
  }

  private createPlan(doc: XMLDocument, overwrite = false): CopyPlan {
    return this.direction === 'to-private'
      ? copySldV1Plan(doc, overwrite) : copySldPrivatePlan(doc, overwrite);
  }

  private isStale(): boolean {
    return this.snapshot !== undefined &&
      (this.snapshot.doc !== this.doc || this.snapshot.version !== this.docVersion);
  }

  private get copyTitle(): string {
    return this.direction === 'to-private'
      ? msg('Copy SLDv1 to SLD Private') : msg('Copy SLD Private to SLDv1');
  }

  private get noSourceMessage(): string {
    return this.direction === 'to-private'
      ? msg('No SLDv1 coordinates were found in this document. Nothing was changed.')
      : msg('No SLD Private coordinates were found in this document. Nothing was changed.');
  }

  private get noSource(): boolean {
    return this.noChanges && this.plan?.unchanged === 0;
  }

  private get noChanges(): boolean {
    return this.plan !== undefined && this.plan.issues.length === 0 &&
      this.plan.copied === 0 && this.plan.conflicts === 0;
  }

  private get canCopy(): boolean {
    return this.doc !== undefined && this.plan !== undefined &&
      this.plan.issues.length === 0 && !this.noChanges && !this.isStale();
  }

  private renderIntroduction() {
    return html`<p>${this.direction === 'to-private'
      ? msg('SLDv1 is the older OpenSCD single-line diagram layout format. This copies its positions and drawing information into SLD Private, the format used by the current SLD editor. The original SLDv1 data is kept.')
      : msg('SLD Private is the layout format used by the current OpenSCD single-line diagram editor. This copies its positions and drawing information into SLDv1, the older format. The original SLD Private data is kept.')}</p>`;
  }

  render() {
    return html`<oscd-dialog>
      <div slot="headline">${this.copyTitle}</div>
      <div slot="content">
        ${this.showIntroduction && this.canCopy ? this.renderIntroduction() : nothing}
        ${this.doc === undefined ? html`<p role="alert">${msg('Open a document first.')}</p>` : nothing}
        ${this.preferenceError !== '' ? html`<p role="alert">${this.preferenceError}</p>` : nothing}
        ${this.isStale() ? html`<p role="alert">${msg('The document changed. Close and reopen this plugin before copying.')}</p>` : nothing}
        ${this.noChanges ? html`<p>${this.noSource
          ? this.noSourceMessage
          : msg('No changes needed. Destination layout already matches the source.')}</p>` : nothing}
        ${this.plan === undefined || this.noSource ? nothing : html`
          ${this.canCopy ? html`<p>${msg('New layout records to copy:')} ${this.plan.copied}</p>` : nothing}
          ${this.plan.notes.map(note => html`<p role="note">${note}</p>`)}
          ${this.plan.issues.length > 0 ? html`
            <p role="alert">${msg('Nothing will be copied until these issues are resolved:')}</p>
            <ul>${this.plan.issues.map(issue => html`<li>${issue}</li>`)}</ul>
          ` : nothing}
          ${this.plan.conflicts > 0 ? html`
            <p>${msg(str`${this.plan.conflicts} destination layout records differ from the source.`)}</p>
            <p>${msg('Skip existing copies only missing destinations. Overwrite existing also updates every differing destination. Destination-only scalar fields are retained; connectivity paths are replaced as a complete set. Matching layouts remain unchanged. Each connectivity path set counts as one layout record.')}</p>
          ` : nothing}
        `}
        ${this.showIntroduction && this.canCopy ? html`
          <label class="introduction-preference">
            <oscd-checkbox .checked=${this.hideIntroduction} @change=${this.handleIntroductionChange}></oscd-checkbox>
            ${msg("Don't show this introduction again")}
          </label>
        ` : nothing}
      </div>
      <div slot="actions">
        <oscd-text-button @click=${() => this.dialog?.close()}>${this.canCopy ? msg('Cancel') : msg('Close')}</oscd-text-button>
        ${this.plan !== undefined && this.plan.issues.length === 0 && !this.noChanges ? html`
          ${this.plan.conflicts > 0 ? html`
            <oscd-text-button
              .disabled=${this.doc === undefined || this.isStale() || this.copying}
              @click=${() => this.handleCopy()}
            >${msg('Skip existing')}</oscd-text-button>
          ` : nothing}
          <oscd-filled-button
            .disabled=${this.doc === undefined || this.isStale() || this.copying}
            @click=${() => this.handleCopy((this.plan?.conflicts ?? 0) > 0)}
          >${this.plan.conflicts > 0 ? msg('Overwrite existing') : msg('Copy')}</oscd-filled-button>
        ` : nothing}
      </div>
    </oscd-dialog>
    <oscd-snackbar></oscd-snackbar>`;
  }

  static styles = css`
    oscd-snackbar {
      --oscd-snackbar-font-family: var(--oscd-theme-font-family, Roboto, sans-serif);
    }
    :host { display: block; }
    label { display: flex; align-items: center; gap: 12px; }
    .introduction-preference { margin-top: 24px; }
  `;
}
