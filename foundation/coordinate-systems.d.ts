import type { EditV2 } from '@openscd/oscd-api';
export declare const sldV1Ns = "https://transpower.co.nz/SCL/SSD/SLD/v0";
export declare const sxyNs = "http://www.iec.ch/61850/2003/SCLcoordinates";
export declare const coordinateSystems: readonly ["sldv1", "sldpriv", "sxy"];
export type CoordinateSystem = typeof coordinateSystems[number];
export declare function detectCoordinateSystems(doc: XMLDocument): Record<CoordinateSystem, number>;
export type CoordinatePlan = {
    edits: EditV2[];
    issues: string[];
};
export declare function cleanCoordinatePlan(doc: XMLDocument, systems: readonly CoordinateSystem[]): CoordinatePlan;
export type CopyPlan = CoordinatePlan & {
    conflicts: number;
    copied: number;
    unchanged: number;
    notes: string[];
};
export declare function privateReference(container: Element): Node | null;
export declare function unusedPrefix(elements: Element[], base: string): string;
/** Copies into detached layout sections, so planning cannot change the live document. */
export declare function copySldV1Plan(doc: XMLDocument, overwrite?: boolean): CopyPlan;
/** Exports existing geometry without repositioning elements or removing source data. */
export declare function copySldPrivatePlan(doc: XMLDocument, overwrite?: boolean): CopyPlan;
