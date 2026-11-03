import { LitElement } from 'lit';
import OscdCoordinateCopyDialog from './oscd-coordinate-copy-dialog.js';
declare const OscdMenuCopySldv1Sldpriv_base: typeof LitElement & import("@open-wc/dedupe-mixin").Constructor<import("@open-wc/scoped-elements/types.js").ScopedElementsHost> & import("@open-wc/scoped-elements/types.js").ScopedElementsHostConstructor;
export default class OscdMenuCopySldv1Sldpriv extends OscdMenuCopySldv1Sldpriv_base {
    static scopedElements: {
        'oscd-coordinate-copy-dialog': typeof OscdCoordinateCopyDialog;
    };
    doc?: XMLDocument;
    docVersion: number;
    private copier?;
    run(): Promise<void>;
    render(): import("lit-html").TemplateResult<1>;
}
export {};
