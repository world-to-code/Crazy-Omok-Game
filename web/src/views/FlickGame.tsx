import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { POWER_INFO, playerColor } from "../types";
import type { FlickMarble } from "../types";
import Countdown from "../components/Countdown";
import Chat from "../components/Chat";

export default function FlickGame() {
  const { state, send, leave, setScreen } = useGame();
  const { marbles, arenaR, currentTurn, myId, status, winner, players, drafting, draftOptions } = state;

  const myTurn = status === "playing" && !drafting && currentTurn === myId;
  const winName = players.find((p) => p.id === winner)?.nickname;

  // ===== 드래프트 화면 =====
  if (status === "playing" && drafting) {
    return (
      <div className="flick">
        <div className="flick-bar card">
          <button className="back" onClick={leave}>← 나가기</button>
          <div className="turn-info">초능력 선택</div>
          <Countdown deadlineMs={state.deadlineMs} />
        </div>
        <div className="draft card">
          <h2>초능력을 고르세요</h2>
          {draftOptions ? (
            <div className="draft-cards">
              {draftOptions.map((p) => {
                const info = POWER_INFO[p] ?? { name: p, emoji: "✨", desc: "" };
                return (
                  <button key={p} className="draft-card" onClick={() => send({ type: "FlickDraftPick", power: p })}>
                    <div className="draft-emoji">{info.emoji}</div>
                    <div className="draft-name">{info.name}</div>
                    <div className="draft-desc">{info.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p>다른 참가자를 기다리는 중…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flick">
      <div className="flick-bar card">
        <button className="back" onClick={leave}>← 나가기</button>
        <FlickTurnInfo />
        <Countdown deadlineMs={state.deadlineMs} />
      </div>
      <div className="flick-body">
        <div className="flick-arena-wrap">
          <Arena
            marbles={marbles}
            arenaR={arenaR}
            myTurn={myTurn}
            myId={myId}
            onFlick={(angle, power) => send({ type: "FlickAim", angle, power })}
          />
        </div>
        <div className="flick-side">
          <MarbleList marbles={marbles} currentTurn={currentTurn} myId={myId} players={players} />
          <Chat />
        </div>
      </div>

      {status === "finished" && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>🏆 게임 종료</h2>
            {winName ? <p><b>{winName}</b> 님 승리!</p> : <p>무승부</p>}
            <button className="primary big" onClick={() => setScreen("lobby")}>로비로</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FlickTurnInfo() {
  const { state } = useGame();
  const { currentTurn, myId, players, status } = state;
  if (status !== "playing") return <div className="turn-info">대기 중</div>;
  const turnP = players.find((p) => p.id === currentTurn);
  const mine = currentTurn === myId;
  return (
    <div className="turn-info">
      {mine ? (
        <span className="turn-me">🎯 내 차례! 알을 드래그해 발사</span>
      ) : (
        <span>{turnP ? `${turnP.nickname} 님 차례` : "대기 중"}</span>
      )}
    </div>
  );
}

function MarbleList({
  marbles,
  currentTurn,
  myId,
  players,
}: {
  marbles: FlickMarble[];
  currentTurn: string | null;
  myId: string | null;
  players: { id: string; nickname: string }[];
}) {
  return (
    <div className="players">
      <div className="players-title">참가자 ({marbles.filter((m) => m.alive).length}명 생존)</div>
      <ul>
        {marbles.map((m) => {
          const name = players.find((p) => p.id === m.owner)?.nickname ?? "?";
          const info = POWER_INFO[m.power];
          const turn = currentTurn === m.owner;
          return (
            <li key={m.owner} className={`player-row${turn ? " turn" : ""}${m.alive ? "" : " dead"}`}>
              <span className="color-dot" style={{ background: playerColor(m.color_index) }} />
              <span className="player-name">
                {name}
                {m.owner === myId && " (나)"}
                <span className="marble-stats">
                  {info ? `${info.emoji}${info.name}` : ""} · ❤️{m.hp}/{m.max_hp} ⚔️{m.atk} 🛡️{m.def}
                  {m.shield ? " 🔰" : ""}
                </span>
              </span>
              {!m.alive && <span className="tag off">탈락</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Arena({
  marbles,
  arenaR,
  myTurn,
  myId,
  onFlick,
}: {
  marbles: FlickMarble[];
  arenaR: number;
  myTurn: boolean;
  myId: string | null;
  onFlick: (angle: number, power: number) => void;
}) {
  const { state } = useGame();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(560);
  // 재생용 위치 (owner -> [x,y]). null이면 정적(state.marbles 위치).
  const [anim, setAnim] = useState<Record<string, [number, number]> | null>(null);
  const animatingRef = useRef(false);
  // 조준 상태
  const aimRef = useRef<{ ax: number; ay: number } | null>(null);
  const [aim, setAim] = useState<{ angle: number; power: number } | null>(null);

  const margin = 24;
  const scale = (size - margin * 2) / (arenaR * 2);
  const toScreen = (x: number, y: number): [number, number] => [size / 2 + x * scale, size / 2 + y * scale];
  const toWorld = (sx: number, sy: number): [number, number] => [(sx - size / 2) / scale, (sy - size / 2) / scale];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = Math.max(280, window.innerHeight - el.getBoundingClientRect().top - 24);
      setSize(Math.max(280, Math.min(w, h)));
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

  // 발사 결과 타임라인 재생
  useEffect(() => {
    const fr = state.flickResolve;
    if (!fr) return;
    animatingRef.current = true;
    let frame = 0;
    const ids = fr.ids;
    const timeline = fr.timeline;
    const tick = () => {
      if (frame >= timeline.length) {
        animatingRef.current = false;
        setAnim(null);
        return;
      }
      const positions: Record<string, [number, number]> = {};
      timeline[frame].forEach((p, i) => {
        if (ids[i]) positions[ids[i]] = [p[0], p[1]];
      });
      setAnim(positions);
      frame++;
      timer = window.setTimeout(tick, 33);
    };
    let timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flickResolve?.seq]);

  // 렌더
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // 아레나
    const [ccx, ccy] = toScreen(0, 0);
    ctx.beginPath();
    ctx.arc(ccx, ccy, arenaR * scale, 0, Math.PI * 2);
    ctx.fillStyle = "#16306b";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffd60a";
    ctx.stroke();

    // 마블
    for (const m of marbles) {
      if (!m.alive && !anim) continue; // 탈락한 알은 정적 화면에서 숨김
      const pos = anim?.[m.owner] ?? [m.x, m.y];
      const [sx, sy] = toScreen(pos[0], pos[1]);
      const r = m.r * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = m.alive ? playerColor(m.color_index) : "rgba(120,120,120,0.4)";
      ctx.fill();
      ctx.lineWidth = m.color_index === 0 ? 2 : 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.stroke();
      if (m.shield) {
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#7dd3fc";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // 체력바
      if (m.alive && !anim) {
        const bw = r * 2;
        const ratio = Math.max(0, m.hp / m.max_hp);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(sx - r, sy - r - 9, bw, 5);
        ctx.fillStyle = ratio > 0.4 ? "#4ade80" : "#f87171";
        ctx.fillRect(sx - r, sy - r - 9, bw * ratio, 5);
      }
    }

    // 조준 화살표
    if (aim && myTurn && !anim) {
      const me = marbles.find((m) => m.owner === myId && m.alive);
      if (me) {
        const [mx, my] = toScreen(me.x, me.y);
        const len = aim.power * arenaR * scale * 0.9;
        const ex = mx + Math.cos(aim.angle) * len;
        const ey = my + Math.sin(aim.angle) * len;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = "#ffd60a";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffd60a";
        ctx.fill();
      }
    }
  }, [marbles, anim, aim, size, scale, arenaR, myTurn, myId]);

  // 조준 입력
  function pointerPos(e: React.PointerEvent): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!myTurn || animatingRef.current) return;
    const me = marbles.find((m) => m.owner === myId && m.alive);
    if (!me) return;
    aimRef.current = { ax: 0, ay: 0 };
    move(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!aimRef.current || !myTurn) return;
    const me = marbles.find((m) => m.owner === myId && m.alive);
    if (!me) return;
    const [px, py] = pointerPos(e);
    const [wx, wy] = toWorld(px, py);
    const dx = wx - me.x;
    const dy = wy - me.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const power = Math.min(1, dist / arenaR);
    setAim({ angle, power });
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!aimRef.current) return;
    aimRef.current = null;
    if (aim && aim.power > 0.05) {
      onFlick(aim.angle, aim.power);
    }
    setAim(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flick-arena" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        style={{ cursor: myTurn ? "crosshair" : "default", touchAction: "none" }}
      />
      {myTurn && <div className="aim-hint">내 알에서 원하는 방향으로 드래그 → 놓으면 발사 (멀수록 강함)</div>}
    </div>
  );
}
