import type { CopyPlan } from './coordinate-systems.js';
/** IEC Annex C positions are parent-relative; SLD Private positions are absolute. */
export declare function copySxyPlan(doc: XMLDocument, overwrite?: boolean): CopyPlan;
/** Export changes only explicit source positions, never compensating retained children. */
export declare function copyPrivateToSxyPlan(doc: XMLDocument, overwrite?: boolean): CopyPlan;
