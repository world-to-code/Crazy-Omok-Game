/* tslint:disable */
/* eslint-disable */

/**
 * AI 최적 수 계산 후 적용. level: 0 쉬움/1 중간/2 어려움/3 헬.
 */
export function checkers_ai(pos: string, level: number): string;

/**
 * (fr,fc)→(tr,tc) 수를 적용. 같은 끝칸에 여러 경로가 있으면 가장 많이 잡는 수.
 */
export function checkers_apply(pos: string, fr: number, fc: number, tr: number, tc: number): string;

/**
 * (r,c) 말의 합법 전체 수 목록 JSON: [{to,path,caps}].
 */
export function checkers_piece_moves(pos: string, r: number, c: number): string;

/**
 * 시작 위치 문자열.
 */
export function checkers_start(): string;

/**
 * 현재 상태 JSON.
 */
export function checkers_state(pos: string): string;

/**
 * AI 최적 수 계산 후 적용. level: 0 쉬움/1 중간/2 어려움/3 헬.
 */
export function chess_ai(fen: string, level: number): string;

/**
 * 한 수 적용. 합법수가 아니면 {"ok":false}.
 */
export function chess_apply(fen: string, fr_r: number, fr_f: number, to_r: number, to_f: number): string;

/**
 * (r,f) 기물의 합법 이동 목적지 목록 JSON: [[r,f],...].
 */
export function chess_moves_from(fen: string, r: number, f: number): string;

/**
 * 시작 위치 FEN.
 */
export function chess_start(): string;

/**
 * 현재 FEN의 상태 JSON.
 */
export function chess_state(fen: string): string;

/**
 * 오목 최적 수. board: 길이 n*n (0 빈/1 흑/2 백). to_move: 1|2. level: 0 쉬움/1 중간/2 어려움.
 * 반환: 둘 칸 인덱스(r*n+c). 둘 곳이 없으면 -1.
 */
export function omok_best_move(board: Uint8Array, n: number, win: number, to_move: number, level: number, renju: number): number;

/**
 * 렌주 금수(흑 전용) 빈칸 목록을 인덱스(r*n+c) 배열로 반환. renju=false면 빈 배열.
 */
export function omok_forbidden(board: Uint8Array, n: number, win: number): Uint32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly checkers_ai: (a: number, b: number, c: number) => [number, number];
    readonly checkers_apply: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly checkers_piece_moves: (a: number, b: number, c: number, d: number) => [number, number];
    readonly checkers_start: () => [number, number];
    readonly checkers_state: (a: number, b: number) => [number, number];
    readonly chess_ai: (a: number, b: number, c: number) => [number, number];
    readonly chess_apply: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly chess_moves_from: (a: number, b: number, c: number, d: number) => [number, number];
    readonly chess_start: () => [number, number];
    readonly chess_state: (a: number, b: number) => [number, number];
    readonly omok_best_move: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly omok_forbidden: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
