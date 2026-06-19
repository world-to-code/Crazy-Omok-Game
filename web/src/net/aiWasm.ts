// 봇 AI WASM 연동.
// - 규칙/즉시 질의(체스 상태·합법수·수 적용)는 메인 스레드에서 동기 호출.
// - 무거운 탐색(오목/체스 AI)은 Web Worker에서 비동기로(최대 5초) 처리.
import init, {
  chess_apply,
  chess_moves_from,
  chess_start,
  chess_state,
} from "../wasm-ai/ai_wasm.js";

export type Level = 0 | 1 | 2 | 3; // 0 쉬움 · 1 중간 · 2 어려움 · 3 헬

export interface ChessPieceT {
  t: string;
  c: string;
}
export interface ChessStateT {
  board: (ChessPieceT | null)[][];
  turn: "w" | "b";
  check: boolean;
  status: "playing" | "checkmate" | "stalemate";
  winner: "w" | "b" | "draw" | null;
  pieces: [number, number][];
}
export interface ChessApplyT {
  ok: boolean;
  fen: string;
  san: string;
  from: [number, number];
  to: [number, number];
  state: ChessStateT;
}

let ready = false;
let initPromise: Promise<void> | null = null;

/** 메인 스레드 WASM 초기화(규칙 질의용). */
export function ensureAiWasm(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!initPromise) {
    initPromise = init()
      .then(() => {
        ready = true;
      })
      .catch((e) => {
        console.warn("ai wasm 로드 실패", e);
      });
  }
  return initPromise;
}

export function isAiReady() {
  return ready;
}

// ===== 체스 규칙(동기) =====
export function chessStart(): string {
  return chess_start();
}
export function chessState(fen: string): ChessStateT {
  return JSON.parse(chess_state(fen));
}
export function chessMovesFrom(fen: string, r: number, f: number): [number, number][] {
  return JSON.parse(chess_moves_from(fen, r, f));
}
export function chessApply(
  fen: string,
  fr: number,
  ff: number,
  tr: number,
  tf: number,
): ChessApplyT {
  return JSON.parse(chess_apply(fen, fr, ff, tr, tf));
}

// ===== AI 탐색(Worker) =====
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (res: number | string) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../bot/aiWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; res: number | string }>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data.res);
      }
    };
  }
  return worker;
}

/** 오목 최적 수(셀 인덱스). 둘 곳 없으면 -1. */
export function omokBestMove(
  board: Uint8Array,
  n: number,
  win: number,
  toMove: number,
  level: Level,
): Promise<number> {
  const id = ++seq;
  // Worker로 보내면 버퍼 소유권이 이전되므로 복사본 전송.
  const copy = board.slice();
  return new Promise((resolve) => {
    pending.set(id, (res) => resolve(res as number));
    getWorker().postMessage({ id, kind: "omok", board: copy, n, win, toMove, level }, [copy.buffer]);
  });
}

/** 체스 AI 수 계산 + 적용 결과. */
export function chessAi(fen: string, level: Level): Promise<ChessApplyT> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, (res) => resolve(JSON.parse(res as string)));
    getWorker().postMessage({ id, kind: "chess", fen, level });
  });
}
