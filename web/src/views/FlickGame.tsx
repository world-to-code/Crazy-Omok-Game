import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { POWER_INFO, playerColor } from "../types";
import type { FlickMarble } from "../types";
import Countdown from "../components/Countdown";
import Chat from "../components/Chat";
import { ensureFlickWasm, predictPath } from "../net/flickWasm";

const VIEW_SPAN = 1300; // 화면에 보이는 월드 폭(맵이 넓어 카메라가 따라감)

export default function FlickGame() {
  const { state, send, leave, setScreen } = useGame();
  const { marbles, currentTurn, myId, status, winner, players, drafting, draftOptions } = state;

  const myTurn = status === "playing" && !drafting && currentTurn === myId;
  const winName = players.find((p) => p.id === winner)?.nickname;

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
    <div className={`flick${myTurn ? " my-turn" : ""}`}>
      <div className="flick-bar card">
        <button className="back" onClick={leave}>← 나가기</button>
        <FlickTurnInfo />
        <Countdown deadlineMs={state.deadlineMs} />
      </div>
      <div className="flick-body">
        <div className="flick-arena-wrap">
          <Arena />
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
        <span>👀 {turnP ? `${turnP.nickname} 님 차례` : "대기 중"}</span>
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

function Arena() {
  const { state, send } = useGame();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(560);

  // 최신 상태를 프레임 루프에서 읽기 위한 refs
  const marblesRef = useRef(state.marbles);
  marblesRef.current = state.marbles;
  const arenaRRef = useRef(state.arenaR);
  arenaRRef.current = state.arenaR;
  const myId = state.myId;
  const myTurn = state.status === "playing" && !state.drafting && state.currentTurn === myId;
  const myTurnRef = useRef(myTurn);
  myTurnRef.current = myTurn;
  const currentTurnRef = useRef(state.currentTurn);
  currentTurnRef.current = state.currentTurn;
  const othersAimRef = useRef(state.othersAim);
  othersAimRef.current = state.othersAim;

  const aimRef = useRef<{ angle: number; power: number } | null>(null);
  const trajRef = useRef<Float32Array | null>(null);
  const animRef = useRef<Record<string, [number, number]> | null>(null);
  const camRef = useRef<{ x: number; y: number } | null>(null);
  const shakeRef = useRef<{ until: number; mag: number }>({ until: 0, mag: 0 });
  const prevHpRef = useRef<Record<string, number>>({});
  const lastAimSentRef = useRef(0);

  useEffect(() => {
    ensureFlickWasm();
  }, []);

  // 크기 측정
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 24);
      setSize(Math.max(320, Math.min(w, h)));
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

  // 발사 결과 재생 + 피격 흔들림
  useEffect(() => {
    const fr = state.flickResolve;
    if (!fr) return;
    // 피해 감지 → 흔들림
    let myDrop = 0;
    let anyDrop = 0;
    for (const m of state.marbles) {
      const prev = prevHpRef.current[m.owner];
      if (prev != null && m.hp < prev) {
        const d = prev - m.hp;
        anyDrop = Math.max(anyDrop, d);
        if (m.owner === myId) myDrop = Math.max(myDrop, d);
      }
    }
    // 재생 시작
    const ids = fr.ids;
    const timeline = fr.timeline;
    const start = performance.now();
    const FRAME_MS = 33;
    let raf = 0;
    const step = () => {
      const t = performance.now() - start;
      const frame = Math.floor(t / FRAME_MS);
      if (frame >= timeline.length) {
        animRef.current = null;
        // 재생 끝난 시점에 흔들림(피격 임팩트 느낌)
        if (anyDrop > 0) {
          shakeRef.current = { until: performance.now() + (myDrop > 0 ? 480 : 300), mag: myDrop > 0 ? 16 : 8 };
        }
        prevHpRef.current = Object.fromEntries(state.marbles.map((m) => [m.owner, m.hp]));
        return;
      }
      const positions: Record<string, [number, number]> = {};
      timeline[frame].forEach((p, i) => {
        if (ids[i]) positions[ids[i]] = [p[0], p[1]];
      });
      animRef.current = positions;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flickResolve?.seq]);

  // 스냅샷 갱신 시 prevHp 동기화(재생 없는 경우)
  useEffect(() => {
    if (!state.flickResolve) {
      prevHpRef.current = Object.fromEntries(state.marbles.map((m) => [m.owner, m.hp]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.marbles]);

  // 렌더 루프 (카메라 부드러운 추적)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const marbles = marblesRef.current;
      const arenaR = arenaRRef.current;
      const zoom = size / VIEW_SPAN;
      const anim = animRef.current;

      // 카메라 타겟 = 현재 차례 플레이어 알(없으면 내 알)
      const focusId = currentTurnRef.current ?? myId;
      const focus = marbles.find((m) => m.owner === focusId) ?? marbles.find((m) => m.owner === myId);
      const target = focus ? (anim?.[focus.owner] ?? [focus.x, focus.y]) : [0, 0];
      if (!camRef.current) camRef.current = { x: target[0], y: target[1] };
      const cam = camRef.current;
      cam.x += (target[0] - cam.x) * 0.12;
      cam.y += (target[1] - cam.y) * 0.12;

      // 흔들림
      let shx = 0;
      let shy = 0;
      const sh = shakeRef.current;
      if (performance.now() < sh.until) {
        shx = (Math.random() - 0.5) * sh.mag;
        shy = (Math.random() - 0.5) * sh.mag;
      }

      const toS = (wx: number, wy: number): [number, number] => [
        size / 2 + (wx - cam.x) * zoom + shx,
        size / 2 + (wy - cam.y) * zoom + shy,
      ];

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#0a0c1e";
      ctx.fillRect(0, 0, size, size);

      // 아레나
      const [acx, acy] = toS(0, 0);
      ctx.beginPath();
      ctx.arc(acx, acy, arenaR * zoom, 0, Math.PI * 2);
      ctx.fillStyle = "#16306b";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#ffd60a";
      ctx.stroke();

      // 마블
      for (const m of marbles) {
        if (!m.alive && !anim) continue;
        const pos = anim?.[m.owner] ?? [m.x, m.y];
        const [sx, sy] = toS(pos[0], pos[1]);
        const r = Math.max(4, m.r * zoom);
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
        if (m.alive) {
          const bw = r * 2.2;
          const ratio = Math.max(0, m.hp / m.max_hp);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - bw / 2, sy - r - 10, bw, 5);
          ctx.fillStyle = ratio > 0.4 ? "#4ade80" : "#f87171";
          ctx.fillRect(sx - bw / 2, sy - r - 10, bw * ratio, 5);
        }
      }

      // 내 조준: 궤적 점선(WASM) + 화살표
      if (myTurnRef.current && aimRef.current && !anim) {
        const me = marbles.find((mm) => mm.owner === myId && mm.alive);
        if (me) {
          const traj = trajRef.current;
          if (traj && traj.length >= 4) {
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            for (let i = 0; i < traj.length; i += 2) {
              const [px, py] = toS(traj[i], traj[i + 1]);
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = "rgba(255,214,10,0.8)";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
          }
          drawAimArrow(ctx, toS, me.x, me.y, aimRef.current.angle, aimRef.current.power, arenaR, zoom, "#ffd60a");
        }
      }

      // 상대 조준 미리보기
      const oa = othersAimRef.current;
      if (oa && !anim) {
        const om = marbles.find((mm) => mm.owner === oa.owner && mm.alive);
        if (om) {
          drawAimArrow(ctx, toS, om.x, om.y, oa.angle, oa.power, arenaR, zoom, "#fb7185");
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, myId]);

  // 포인터 → 조준
  function pointerWorld(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const zoom = size / VIEW_SPAN;
    const cam = camRef.current ?? { x: 0, y: 0 };
    return [cam.x + (px - size / 2) / zoom, cam.y + (py - size / 2) / zoom];
  }
  function updateAim(e: React.PointerEvent<HTMLCanvasElement>) {
    const me = marblesRef.current.find((m) => m.owner === myId && m.alive);
    if (!me) return;
    const [wx, wy] = pointerWorld(e);
    const dx = wx - me.x;
    const dy = wy - me.y;
    const angle = Math.atan2(dy, dx);
    const power = Math.min(1, Math.hypot(dx, dy) / (arenaRRef.current * 0.9));
    aimRef.current = { angle, power };
    // 궤적 예측 (WASM)
    const others: number[] = [];
    for (const m of marblesRef.current) {
      if (m.owner !== myId && m.alive) others.push(m.x, m.y, m.r);
    }
    const mult = me.power === "slingshot" ? 1.4 : 1.0;
    trajRef.current = predictPath(me.x, me.y, angle, power, mult, arenaRRef.current, me.r, new Float32Array(others));
    // 조준 공유(스로틀)
    const now = performance.now();
    if (now - lastAimSentRef.current > 60) {
      lastAimSentRef.current = now;
      send({ type: "FlickAiming", angle, power });
    }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!myTurnRef.current || animRef.current) return;
    if (!marblesRef.current.find((m) => m.owner === myId && m.alive)) return;
    updateAim(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!aimRef.current) return;
    updateAim(e);
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = aimRef.current;
    aimRef.current = null;
    trajRef.current = null;
    if (a && a.power > 0.05) send({ type: "FlickAim", angle: a.angle, power: a.power });
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
      {myTurn && <div className="aim-hint">내 알에서 원하는 방향으로 드래그 → 놓으면 발사 (점선=예상 경로, 멀수록 강함)</div>}
    </div>
  );
}

function drawAimArrow(
  ctx: CanvasRenderingContext2D,
  toS: (x: number, y: number) => [number, number],
  wx: number,
  wy: number,
  angle: number,
  power: number,
  arenaR: number,
  zoom: number,
  color: string,
) {
  const [mx, my] = toS(wx, wy);
  const len = power * arenaR * 0.9 * zoom;
  const ex = mx + Math.cos(angle) * len;
  const ey = my + Math.sin(angle) * len;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ex, ey, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
