// 봇 AI 탐색 전용 Web Worker. 어려움은 최대 5초 동안 메인 스레드를 막지 않도록
// 무거운 탐색(오목/체스)을 여기서 돌린다.
import init, { omok_best_move, chess_ai } from "../wasm-ai/ai_wasm.js";

let ready: Promise<unknown> | null = null;

type Req =
  | { id: number; kind: "omok"; board: Uint8Array; n: number; win: number; toMove: number; level: number }
  | { id: number; kind: "chess"; fen: string; level: number };

self.onmessage = async (e: MessageEvent<Req>) => {
  if (!ready) ready = init();
  await ready;
  const m = e.data;
  let res: number | string;
  if (m.kind === "omok") {
    res = omok_best_move(m.board, m.n, m.win, m.toMove, m.level);
  } else {
    res = chess_ai(m.fen, m.level);
  }
  (self as unknown as Worker).postMessage({ id: m.id, res });
};
