import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { TEAM_COLORS, playerColor } from "../types";

export default function Board() {
  const { state, send } = useGame();
  const { settings, board, winningLine, lastMove, currentTurn, currentTeam, myId, status, mode, votes, voteVoters, players } =
    state;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const n = settings?.board_size ?? 15;
  const isTeam = mode === "team";
  const colorOf = (c: number) => (isTeam ? TEAM_COLORS[c] ?? "#000" : playerColor(c));

  const myTeam = players.find((p) => p.id === myId)?.team ?? null;
  const myTurn =
    status === "playing" &&
    (isTeam ? currentTeam != null && currentTeam === myTeam : currentTurn === myId);

  // 보드 영역의 가용 가로/세로를 측정해, 둘 다 화면에 들어가도록 칸 크기를 맞춘다.
  const [avail, setAvail] = useState({ w: 700, h: 500 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(200, el.clientWidth - 24);
      // 보드 영역 위쪽 끝부터 화면 아래까지를 세로 가용 높이로 (페이지 스크롤 방지).
      const top = el.getBoundingClientRect().top;
      const h = Math.max(200, window.innerHeight - top - 16);
      setAvail((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // 확대/축소 배율 (기본 1 = 화면에 꽉 채우되 가로·세로 모두 안 넘침)
  const [zoom, setZoom] = useState(1);
  const fitCell = Math.min(avail.w, avail.h) / (n + 1);
  const cell = clamp(Math.round(fitCell * zoom), 6, 200);

  const margin = Math.max(cell * 0.7, 10);
  const px = (i: number) => margin + i * cell;
  const dim = margin * 2 + (n - 1) * cell;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dim * dpr;
    canvas.height = dim * dpr;
    canvas.style.width = `${dim}px`;
    canvas.style.height = `${dim}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#e9c489";
    ctx.fillRect(0, 0, dim, dim);

    ctx.strokeStyle = "rgba(80,50,10,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(px(0), px(i));
      ctx.lineTo(px(n - 1), px(i));
      ctx.moveTo(px(i), px(0));
      ctx.lineTo(px(i), px(n - 1));
    }
    ctx.stroke();

    const r = Math.max(cell * 0.42, 3);

    for (const [k, color] of board) {
      const [x, y] = k.split(",").map(Number);
      const cx = px(x);
      const cy = px(y);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(color);
      ctx.fill();
      const light = !isTeam && color === 0;
      ctx.lineWidth = light ? 1.5 : 1;
      ctx.strokeStyle = light ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.35)";
      ctx.stroke();

      if (lastMove && lastMove.x === x && lastMove.y === y) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = light ? "#000" : "#fff";
        ctx.fill();
      }
      if (winningLine.has(k)) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffd60a";
        ctx.stroke();
      }
    }

    if (isTeam && votes.size > 0) {
      const base = myTeam != null ? colorOf(myTeam) : "#457b9d";
      const denom = Math.max(voteVoters, 1);
      for (const [k, count] of votes) {
        const [x, y] = k.split(",").map(Number);
        const cx = px(x);
        const cy = px(y);
        const ratio = count / denom;
        ctx.globalAlpha = 0.25 + 0.6 * Math.min(1, ratio);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = base;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (cell >= 16) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.max(9, cell * 0.3)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${Math.round(ratio * 100)}%`, cx, cy);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, winningLine, lastMove, cell, n, dim, votes, voteVoters, isTeam, myTeam]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!myTurn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - margin) / cell);
    const y = Math.round((e.clientY - rect.top - margin) / cell);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    if (board.has(`${x},${y}`)) return;
    if (isTeam) {
      send({ type: "Vote", x, y });
    } else {
      send({ type: "PlaceStone", x, y });
    }
  }

  return (
    <div className="board-wrap">
      <div className="board-controls">
        <span>{n}×{n} 보드</span>
        <button onClick={() => setZoom((z) => clamp(z * 0.8, 0.3, 4))}>축소 −</button>
        <button onClick={() => setZoom((z) => clamp(z * 1.25, 0.3, 4))}>확대 +</button>
        <button onClick={() => setZoom(1)}>맞춤</button>
        {myTurn && (
          <span className="your-turn-badge">
            {isTeam ? "우리 팀 차례! 원하는 자리를 클릭(투표)하세요" : "내 차례! 빈 칸을 클릭하세요"}
          </span>
        )}
      </div>
      <div className={`board-scroll${myTurn ? " my-turn" : ""}`} ref={scrollRef} style={{ maxHeight: avail.h }}>
        <canvas ref={canvasRef} onClick={onClick} style={{ cursor: myTurn ? "pointer" : "default" }} />
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
