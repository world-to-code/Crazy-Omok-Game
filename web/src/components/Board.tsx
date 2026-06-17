import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { COLORS, TEAM_COLORS } from "../types";

export default function Board() {
  const { state, send } = useGame();
  const { settings, board, winningLine, lastMove, currentTurn, currentTeam, myId, status, mode, votes, voteVoters, players } =
    state;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const n = settings?.board_size ?? 15;
  const isTeam = mode === "team";
  const palette = isTeam ? TEAM_COLORS : COLORS;

  const myTeam = players.find((p) => p.id === myId)?.team ?? null;
  const myTurn =
    status === "playing" &&
    (isTeam ? currentTeam != null && currentTeam === myTeam : currentTurn === myId);

  // 내가 찍은 위치(팀전). 차례가 바뀌면 초기화.
  const [myVote, setMyVote] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setMyVote(null);
  }, [currentTeam, state.deadlineMs]);

  const [cell, setCell] = useState(() => clamp(Math.floor(620 / n), 10, 36));
  useEffect(() => {
    setCell(clamp(Math.floor(620 / n), 10, 36));
  }, [n]);

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

    // 돌
    for (const [k, color] of board) {
      const [x, y] = k.split(",").map(Number);
      const cx = px(x);
      const cy = px(y);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = palette[color] ?? "#000";
      ctx.fill();
      // 흰색(방장) 돌은 테두리를 진하게 해 잘 보이도록.
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

    // 투표 히트맵 (팀전, 내 팀 차례에만 votes가 채워짐)
    if (isTeam && votes.size > 0) {
      const base = myTeam != null ? palette[myTeam] : "#457b9d";
      const denom = Math.max(voteVoters, 1);
      for (const [k, count] of votes) {
        const [x, y] = k.split(",").map(Number);
        const cx = px(x);
        const cy = px(y);
        const ratio = count / denom; // 선택률
        ctx.globalAlpha = 0.25 + 0.6 * Math.min(1, ratio);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = base;
        ctx.fill();
        ctx.globalAlpha = 1;
        // 내 선택 강조
        if (myVote && myVote.x === x && myVote.y === y) {
          ctx.beginPath();
          ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "#ffd60a";
          ctx.stroke();
        }
        // 선택률 % (칸이 충분히 클 때)
        if (cell >= 16) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.max(9, cell * 0.3)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${Math.round(ratio * 100)}%`, cx, cy);
        }
      }
    }
  }, [board, winningLine, lastMove, cell, n, dim, votes, myVote, voteVoters, isTeam, myTeam, palette]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!myTurn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - margin) / cell);
    const y = Math.round((e.clientY - rect.top - margin) / cell);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    if (board.has(`${x},${y}`)) return;
    if (isTeam) {
      send({ type: "Vote", x, y });
      setMyVote({ x, y });
    } else {
      send({ type: "PlaceStone", x, y });
    }
  }

  return (
    <div className="board-wrap">
      <div className="board-controls">
        <span>{n}×{n} 보드</span>
        <button onClick={() => setCell((c) => clamp(c - 4, 6, 60))}>축소 −</button>
        <button onClick={() => setCell((c) => clamp(c + 4, 6, 60))}>확대 +</button>
        {myTurn && (
          <span className="your-turn-badge">
            {isTeam ? "우리 팀 차례! 원하는 자리를 클릭(투표)하세요" : "내 차례! 빈 칸을 클릭하세요"}
          </span>
        )}
      </div>
      <div className="board-scroll">
        <canvas ref={canvasRef} onClick={onClick} style={{ cursor: myTurn ? "pointer" : "default" }} />
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
