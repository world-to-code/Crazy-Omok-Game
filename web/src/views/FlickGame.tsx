import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { POWER_INFO, OBSTACLE_INFO, playerColor } from "../types";
import type { FlickMarble } from "../types";
import Countdown from "../components/Countdown";
import Chat from "../components/Chat";
import { ensureFlickWasm, predictPath } from "../net/flickWasm";

const VIEW_SPAN = 1050; // 화면에 보이는 월드 폭(맵이 넓어 카메라가 따라감)

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
  const { state, send, applyFlick } = useGame();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(560);

  // 최신 상태를 프레임 루프에서 읽기 위한 refs
  const marblesRef = useRef(state.marbles);
  marblesRef.current = state.marbles;
  const arenaRRef = useRef(state.arenaR);
  arenaRRef.current = state.arenaR;
  const obstaclesRef = useRef(state.obstacles);
  obstaclesRef.current = state.obstacles;
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
  const particlesRef = useRef<{ x: number; y: number; kind: string; t0: number }[]>([]);
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
      const h = el.clientHeight - 34; // 조준 힌트 공간 확보
      setSize(Math.max(240, Math.min(w, h)));
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

  // 발사 결과 재생: 타임라인을 따라 알을 움직이고, 충돌 이벤트 시점에 이펙트+흔들림.
  // 재생이 끝나면(돌이 완전히 멈춘 뒤) 다음 차례를 적용(applyFlick).
  useEffect(() => {
    const fr = state.flickResolve;
    if (!fr) return;
    const { ids, timeline } = fr;
    const events = [...fr.events].sort((a, b) => a.frame - b.frame);
    const FRAME_MS = 33;
    const start = performance.now();
    let evIdx = 0;
    let raf = 0;

    const fireEvent = (kind: string, x: number, y: number) => {
      particlesRef.current.push({ x, y, kind, t0: performance.now() });
      const strong = kind === "explode" || kind === "ko";
      shakeRef.current = {
        until: performance.now() + (strong ? 460 : 260),
        mag: strong ? 16 : kind === "spike" ? 10 : 7,
      };
    };

    const step = () => {
      const frame = Math.floor((performance.now() - start) / FRAME_MS);
      while (evIdx < events.length && events[evIdx].frame <= frame) {
        const e = events[evIdx++];
        fireEvent(e.kind, e.x, e.y);
      }
      if (frame >= timeline.length) {
        // 남은 이벤트 마저 발생
        while (evIdx < events.length) {
          const e = events[evIdx++];
          fireEvent(e.kind, e.x, e.y);
        }
        animRef.current = null;
        applyFlick(); // 돌이 멈춘 뒤 차례 전환
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

      // 바닥 그리드(이동감/공간감) — 아레나 원 안쪽에만
      ctx.save();
      ctx.beginPath();
      ctx.arc(acx, acy, arenaR * zoom, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      const GRID = 200;
      const x0 = Math.floor((cam.x - VIEW_SPAN) / GRID) * GRID;
      const y0 = Math.floor((cam.y - VIEW_SPAN) / GRID) * GRID;
      ctx.beginPath();
      for (let gx = x0; gx <= cam.x + VIEW_SPAN; gx += GRID) {
        const [a] = toS(gx, 0);
        ctx.moveTo(a, 0);
        ctx.lineTo(a, size);
      }
      for (let gy = y0; gy <= cam.y + VIEW_SPAN; gy += GRID) {
        const [, b] = toS(0, gy);
        ctx.moveTo(0, b);
        ctx.lineTo(size, b);
      }
      ctx.stroke();
      ctx.restore();

      // 장애물/필드
      for (const ob of obstaclesRef.current) {
        const info = OBSTACLE_INFO[ob.kind];
        if (!info) continue;
        const [ox, oy] = toS(ob.x, ob.y);
        ctx.fillStyle = info.fill;
        ctx.strokeStyle = info.stroke;
        ctx.lineWidth = info.solid ? 2.5 : 1.5;
        if (ob.shape === "circle") {
          ctx.beginPath();
          ctx.arc(ox, oy, ob.r * zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const w = ob.w * zoom;
          const h = ob.h * zoom;
          ctx.fillRect(ox - w / 2, oy - h / 2, w, h);
          ctx.strokeRect(ox - w / 2, oy - h / 2, w, h);
        }
        // 돌풍 방향 화살표
        if (ob.kind === "wind") {
          const a = ob.dir;
          ctx.beginPath();
          ctx.moveTo(ox - Math.cos(a) * 20, oy - Math.sin(a) * 20);
          ctx.lineTo(ox + Math.cos(a) * 20, oy + Math.sin(a) * 20);
          ctx.strokeStyle = info.stroke;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        // 라벨(충분히 클 때)
        const labelSize = ob.shape === "circle" ? ob.r * zoom : Math.min(ob.w, ob.h) * zoom;
        if (labelSize > 26) {
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.font = `${Math.min(16, labelSize * 0.35)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(info.emoji, ox, oy);
        }
      }

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

      // 충돌 이펙트(파티클)
      const nowp = performance.now();
      const live: typeof particlesRef.current = [];
      for (const pt of particlesRef.current) {
        const life = pt.kind === "explode" ? 600 : pt.kind === "ko" ? 750 : pt.kind === "spike" ? 420 : 340;
        const age = nowp - pt.t0;
        if (age > life) continue;
        live.push(pt);
        const t = age / life;
        const [px, py] = toS(pt.x, pt.y);
        drawParticle(ctx, pt.kind, px, py, t, zoom);
      }
      particlesRef.current = live;

      // 미니맵(전체 전장 파악) — 우상단, 카메라와 무관한 화면 좌표
      const MS = Math.min(150, size * 0.26);
      const mx0 = size - MS - 12;
      const my0 = 12;
      const mscale = MS / (arenaR * 2);
      const mc = (wx: number, wy: number): [number, number] => [
        mx0 + MS / 2 + wx * mscale,
        my0 + MS / 2 + wy * mscale,
      ];
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = "rgba(8,10,24,0.7)";
      ctx.beginPath();
      ctx.arc(mx0 + MS / 2, my0 + MS / 2, MS / 2 + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffd60a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx0 + MS / 2, my0 + MS / 2, (arenaR * mscale), 0, Math.PI * 2);
      ctx.stroke();
      for (const ob of obstaclesRef.current) {
        const oi = OBSTACLE_INFO[ob.kind];
        if (!oi) continue;
        const [ox, oy] = mc(ob.x, ob.y);
        ctx.fillStyle = oi.solid ? oi.stroke : oi.fill;
        ctx.beginPath();
        ctx.arc(ox, oy, oi.solid ? 2.5 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const m of marbles) {
        if (!m.alive) continue;
        const pos = anim?.[m.owner] ?? [m.x, m.y];
        const [dx, dy] = mc(pos[0], pos[1]);
        ctx.beginPath();
        ctx.arc(dx, dy, m.owner === currentTurnRef.current ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = playerColor(m.color_index);
        ctx.fill();
        if (m.owner === myId) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (m.owner === currentTurnRef.current) {
          ctx.strokeStyle = "#ffd60a";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.restore();

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
    // 궤적 예측 (WASM) — 다른 알 + 솔리드 장애물(원형)을 장애물로 전달
    const others: number[] = [];
    for (const m of marblesRef.current) {
      if (m.owner !== myId && m.alive) others.push(m.x, m.y, m.r);
    }
    for (const ob of obstaclesRef.current) {
      if (OBSTACLE_INFO[ob.kind]?.solid && ob.shape === "circle") others.push(ob.x, ob.y, ob.r);
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

// 충돌/효과 파티클 그리기. t: 0~1 진행도.
function drawParticle(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, t: number, zoom: number) {
  const fade = 1 - t;
  ctx.save();
  if (kind === "explode" || kind === "ko") {
    const big = kind === "ko";
    const maxR = (big ? 160 : 110) * zoom;
    // 확장 링
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, maxR * t, 0, Math.PI * 2);
    ctx.strokeStyle = big ? "#fca5a5" : "#fb923c";
    ctx.lineWidth = (big ? 6 : 4) * (1 - t * 0.5);
    ctx.stroke();
    // 내부 플래시
    ctx.globalAlpha = fade * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, maxR * 0.5 * (1 - t), 0, Math.PI * 2);
    ctx.fillStyle = big ? "#ef4444" : "#f59e0b";
    ctx.fill();
    // 스파크
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = 2;
    const spikes = big ? 12 : 8;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const r0 = maxR * 0.4 * t;
      const r1 = maxR * (0.7 + 0.3 * t);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.stroke();
    }
  } else if (kind === "spike") {
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 2.5;
    const r = 26 * zoom * (0.5 + t);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.stroke();
    }
  } else {
    // hit: 노란 플래시 + 작은 링
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, 30 * zoom * t, 0, Math.PI * 2);
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 3 * fade;
    ctx.stroke();
    ctx.globalAlpha = fade * 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 10 * zoom * (1 - t), 0, Math.PI * 2);
    ctx.fillStyle = "#fef08a";
    ctx.fill();
  }
  ctx.restore();
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
