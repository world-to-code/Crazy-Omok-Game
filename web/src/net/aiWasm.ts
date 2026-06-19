// 봇 AI WASM 연동.
// - 규칙/즉시 질의(체스 상태·합법수·수 적용)는 메인 스레드에서 동기 호출.
// - 무거운 탐색(오목/체스 AI)은 Web Worker에서 비동기로(최대 5초) 처리.
import init, {
  chess_apply,
  chess_moves_from,
  chess_start,
  chess_state,
  omok_forbidden,
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

/** 렌주 금수(흑) 칸 인덱스 목록(동기, 메인스레드). */
export function omokForbidden(board: Uint8Array, n: number, win: number): number[] {
  return Array.from(omok_forbidden(board, n, win));
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

/**
 * 봇 AI 워커를 즉시 종료한다(진행 중인 탐색도 강제 중단).
 * 방을 나가거나 페이지를 닫을 때 호출 — 백그라운드 계산이 남지 않게 한다.
 * 다음 요청 시 워커는 자동으로 새로 생성된다.
 */
export function terminateAiWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
}

// 탭/창을 닫거나 다른 페이지로 이동할 때도 워커를 정리.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", terminateAiWorker);
}

/** 오목 최적 수(셀 인덱스). 둘 곳 없으면 -1. renju=true면 흑 금수 적용. */
export function omokBestMove(
  board: Uint8Array,
  n: number,
  win: number,
  toMove: number,
  level: Level,
  renju: boolean,
): Promise<number> {
  const id = ++seq;
  // Worker로 보내면 버퍼 소유권이 이전되므로 복사본 전송.
  const copy = board.slice();
  return new Promise((resolve) => {
    pending.set(id, (res) => resolve(res as number));
    getWorker().postMessage(
      { id, kind: "omok", board: copy, n, win, toMove, level, renju: renju ? 1 : 0 },
      [copy.buffer],
    );
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
