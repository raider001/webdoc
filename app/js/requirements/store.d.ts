import type { RequirementEntry, TestCaseEntry } from '../requirements.js';
import type { ReqOrTestBlock } from './parse.js';
import type { CoverageStatus } from '../coverage.js';
/** requirement id -> record */
export declare const index: Map<string, RequirementEntry>;
/** test id -> record */
export declare const testIndex: Map<string, TestCaseEntry>;
/** docId -> blocks (requirement group OR test case, in document order) */
export declare const groupsByDoc: Map<string, ReqOrTestBlock[]>;
/**
 * Subscribe to coverage-status replacements.
 * @param fn - called AFTER the new map is in place, so a callback that
 *   immediately calls statusOf() sees the new values, never the old ones
 * @returns unsubscribe; safe to call more than once
 */
export declare function onStatusChange(fn: () => void): () => void;
export declare function setCoverageStatus(m: Map<string, CoverageStatus> | Record<string, CoverageStatus> | null): void;
/**
 * @param id - a requirement or test id
 * @returns null if no coverage status is set at all; undefined if it is set but
 *   has no entry for this id
 */
export declare function statusOf(id: string): CoverageStatus | null | undefined;
/** @param map - source name -> component id */
export declare function setComponentBySource(map: Record<string, string>): void;
/** @returns the component id, or undefined if the source is unknown */
export declare function componentOf(source: string): string | undefined;
