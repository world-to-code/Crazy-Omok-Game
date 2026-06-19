import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { ensureAiWasm, isAiReady, omokBestMove, type Level } from "../net/aiWasm";
import Countdown from "../components/Countdown";

const N = 15;
const WIN = 5;
const TURN_MS = 45_000;

const LEVEL_NAME = ["쉬움", "중간", "어려움", "헬"];
const BLACK = 1;
const WHITE = 2;

// (idx에 color를 둔 직후) 그 돌을 지나는 WIN목 라인 인덱스. 없으면 null.
function winLineThrough(board: number[], idx: number, color: number): number[] | null {
  const r = Math.floor(idx / N);
  const c = idx % N;
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    const line = [idx];
    for (let k = 1; ; k++) {
      const nr = r + dr * k;
      const nc = c + dc * k;
      if (nr < 0 || nc < 0 || nr >= N || nc >= N || board[nr * N + nc] !== color) break;
      line.push(nr * N + nc);
    }
    for (let k = 1; ; k++) {
      const nr = r - dr * k;
      const nc = c - dc * k;
      if (nr < 0 || nc < 0 || nr >= N || nc >= N || board[nr * N + nc] !== color) break;
      line.unshift(nr * N + nc);
    }
    if (line.length >= WIN) return line.slice(0, WIN);
  }
  return null;
}

export default function BotOmok() {
  const { state, setScreen } = useGame();
  const cfg = state.bot!;
  const level = cfg.level as Level;
  const human = cfg.humanFirst ? BLACK : WHITE;
  const bot = human === BLACK ? WHITE : BLACK;

  const [board, setBoard] = useState<number[]>(() => Array(N * N).fill(0));
  const [turn, setTurn] = useState<number>(BLACK); // 흑 선
  const [winner, setWinner] = useState<number>(0); // 0 none · 1 흑 · 2 백 · 3 무
  const [winLine, setWinLine] = useState<number[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [ready, setReady] = useState(isAiReady());
  const botBusy = useRef(false);

  useEffect(() => {
    ensureAiWasm().then(() => setReady(true));
  }, []);

  const place = useCallback(
    (cur: number[], idx: number, color: number) => {
      const nb = cur.slice();
      nb[idx] = color;
      setBoard(nb);
      setLast(idx);
      const line = winLineThrough(nb, idx, color);
      if (line) {
        setWinner(color);
        setWinLine(line);
        setTurn(0);
        setDeadline(null);
      } else if (nb.every((v) => v !== 0)) {
        setWinner(3);
        setTurn(0);
        setDeadline(null);
      } else {
        setTurn(color === BLACK ? WHITE : BLACK);
      }
    },
    [],
  );

  // 봇 차례 자동 착수.
  useEffect(() => {
    if (!ready || winner !== 0 || turn !== bot || botBusy.current) return;
    botBusy.current = true;
    setThinking(true);
    const snapshot = board;
    const buf = Uint8Array.from(snapshot);
    omokBestMove(buf, N, WIN, bot, level).then((idx) => {
      botBusy.current = false;
      setThinking(false);
      if (idx >= 0 && idx < N * N && snapshot[idx] === 0) {
        place(snapshot, idx, bot);
      }
    });
  }, [ready, winner, turn, bot, board, level, place]);

  // 사람 차례면 45초 카운트다운(표시용, 강제 없음).
  useEffect(() => {
    if (winner === 0 && turn === human) setDeadline(Date.now() + TURN_MS);
    else setDeadline(null);
  }, [turn, winner, human]);

  function onCellClick(idx: number) {
    if (winner !== 0 || turn !== human || board[idx] !== 0 || thinking) return;
    place(board, idx, human);
  }

  function restart() {
    botBusy.current = false;
    setBoard(Array(N * N).fill(0));
    setTurn(BLACK);
    setWinner(0);
    setWinLine([]);
    setLast(null);
    setThinking(false);
    // bot 선공이면 다음 effect에서 자동 착수.
  }

  const myTurn = winner === 0 && turn === human && !thinking;
  const winLineSet = new Set(winLine);

  return (
    <div className="game">
      <div className="game-bar card">
        <button className="back" onClick={() => setScreen("home")}>
          ← 나가기
        </button>
        <div className="turn-info">
          {winner !== 0 ? (
            <span>게임 종료</span>
          ) : thinking ? (
            <span>🤖 봇이 생각 중…</span>
          ) : myTurn ? (
            <span className="turn-me">
              <span className="color-dot" style={{ background: human === BLACK ? "#111" : "#fff", border: "1px solid #888" }} />
              내 차례
            </span>
          ) : (
            <span>봇 차례</span>
          )}
        </div>
        <Countdown deadlineMs={deadline} />
        <div className="rule-info">
          🤖 {LEVEL_NAME[level]} · {WIN}목
        </div>
      </div>

      <div className="game-body">
        <div className="game-board">
          <BotGoban
            board={board}
            last={last}
            winLine={winLineSet}
            clickable={myTurn}
            onCell={onCellClick}
          />
        </div>
      </div>

      {winner !== 0 && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>🏆 게임 종료</h2>
            {winner === 3 ? (
              <p>무승부입니다.</p>
            ) : winner === human ? (
              <p>
                🎉 <b>당신</b>이 이겼습니다!
              </p>
            ) : (
              <p>
                🤖 <b>봇({LEVEL_NAME[level]})</b> 승리. 다시 도전해보세요!
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button className="primary big" onClick={restart}>
                다시하기
              </button>
              <button className="big" onClick={() => setScreen("botSetup")}>
                난이도 변경
              </button>
              <button className="big" onClick={() => setScreen("home")}>
                홈으로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 캔버스 바둑판 =====
function BotGoban({
  board,
  last,
  winLine,
  clickable,
  onCell,
}: {
  board: number[];
  last: number | null;
  winLine: Set<number>;
  clickable: boolean;
  onCell: (idx: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(560);

  useEffect(() => {
    const update = () => {
      const w = wrapRef.current?.clientWidth ?? 560;
      const top = wrapRef.current?.getBoundingClientRect().top ?? 120;
      const h = window.innerHeight - top - 24;
      setSize(Math.max(260, Math.min(w, h, 640)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const margin = size / (N + 1);
    const cell = (size - margin * 2) / (N - 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = (i: number) => margin + i * cell;

    ctx.fillStyle = "#e9c489";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(80,50,10,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      ctx.moveTo(px(0), px(i));
      ctx.lineTo(px(N - 1), px(i));
      ctx.moveTo(px(i), px(0));
      ctx.lineTo(px(i), px(N - 1));
    }
    ctx.stroke();
    // 화점.
    ctx.fillStyle = "rgba(50,30,5,0.8)";
    for (const [r, c] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
      ctx.beginPath();
      ctx.arc(px(c), px(r), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const rad = cell * 0.44;
    for (let idx = 0; idx < N * N; idx++) {
      const v = board[idx];
      if (!v) continue;
      const r = Math.floor(idx / N);
      const c = idx % N;
      const cx = px(c);
      const cy = px(r);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = v === BLACK ? "#1a1a1a" : "#fafafa";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.stroke();
      if (last === idx) {
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = v === BLACK ? "#ffd60a" : "#d00";
        ctx.fill();
      }
      if (winLine.has(idx)) {
        ctx.beginPath();
        ctx.arc(cx, cy, rad + 3, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ff3b30";
        ctx.stroke();
      }
    }
  }, [board, last, winLine, size]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!clickable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const margin = size / (N + 1);
    const cell = (size - margin * 2) / (N - 1);
    const c = Math.round((e.clientX - rect.left - margin) / cell);
    const r = Math.round((e.clientY - rect.top - margin) / cell);
    if (r < 0 || c < 0 || r >= N || c >= N) return;
    onCell(r * N + c);
  }

  return (
    <div ref={wrapRef} style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <canvas
        ref={canvasRef}
        onClick={onClick}
        style={{ cursor: clickable ? "pointer" : "default", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,.3)" }}
      />
    </div>
  );
}
