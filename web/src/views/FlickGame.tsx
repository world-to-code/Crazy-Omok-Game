import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { POWER_INFO, OBSTACLE_INFO, ITEM_INFO, playerColor } from "../types";
import Countdown from "../components/Countdown";
import Chat from "../components/Chat";
import { ensureFlickWasm, predictPath } from "../net/flickWasm";

const VIEW_SPAN = 1050; // 화면에 보이는 월드 폭(맵이 넓어 카메라가 따라감)

export default function FlickGame() {
  const { state, send, leave, returnToLobby } = useGame();
  const { currentTurn, myId, status, winner, players, drafting, draftOptions } = state;

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
        <MyStats />
        <Countdown deadlineMs={state.deadlineMs} />
      </div>
      <div className="flick-body">
        <div className="flick-arena-wrap">
          <Arena />
        </div>
        <div className="flick-side">
          <Chat />
        </div>
      </div>

      {status === "finished" && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>🏆 게임 종료</h2>
            {winName ? <p><b>{winName}</b> 님 승리!</p> : <p>무승부</p>}
            <button className="primary big" onClick={returnToLobby}>로비로</button>
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

// 내 알의 능력/공격력/방어력 — 본인 화면에서만 보임.
function MyStats() {
  const { state } = useGame();
  const me = state.marbles.find((m) => m.owner === state.myId);
  if (!me) return null;
  const info = POWER_INFO[me.power];
  return (
    <div className="my-stats">
      <span className="color-dot" style={{ background: playerColor(me.color_index) }} />
      {info && <span className="ms-power">{info.emoji} {info.name}</span>}
      <span className="ms-stat">❤️ {me.hp}/{me.max_hp}</span>
      <span className="ms-stat">⚔️ {me.atk}</span>
      <span className="ms-stat">🛡️ {me.def}</span>
      {me.shield && <span className="ms-stat">🔰</span>}
      <span className="ms-alive">생존 {state.marbles.filter((m) => m.alive).length}명</span>
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
  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;
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
  const dmgTextsRef = useRef<{ x: number; y: number; amount: number; ko: boolean; t0: number }[]>([]);
  // 재생 중 즉시 반영할 체력(이벤트 시점마다 갱신). 재생 끝나면 비움.
  const displayHpRef = useRef<Record<string, number>>({});
  // 재생 중 표시할 아이템(획득하면 제거). null이면 state.items 사용.
  const displayItemsRef = useRef<typeof state.items | null>(null);
  const pickTextsRef = useRef<{ x: number; y: number; kind: string; t0: number }[]>([]);
  const trailsRef = useRef<Record<string, [number, number][]>>({});
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
    displayHpRef.current = {}; // 이번 발사 재생용 체력 누적 초기화
    displayItemsRef.current = itemsRef.current.map((it) => ({ ...it })); // 재생용 아이템 사본

    const NIL = "00000000-0000-0000-0000-000000000000";
    const fireEvent = (
      kind: string,
      x: number,
      y: number,
      amount: number,
      owner: string,
      hp: number,
    ) => {
      const now = performance.now();
      if (owner && owner !== NIL && hp >= 0) displayHpRef.current[owner] = hp; // 즉시 체력 반영
      // 아이템 획득 이벤트("item:<kind>")
      if (kind.startsWith("item:")) {
        const ik = kind.slice(5);
        pickTextsRef.current.push({ x, y, kind: ik, t0: now });
        // 표시 아이템에서 가장 가까운 것 제거
        const list = displayItemsRef.current;
        if (list && list.length) {
          let best = 0;
          let bd = Infinity;
          for (let i = 0; i < list.length; i++) {
            const d = (list[i].x - x) ** 2 + (list[i].y - y) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          list.splice(best, 1);
        }
        return;
      }
      particlesRef.current.push({ x, y, kind, t0: now });
      if (amount > 0) dmgTextsRef.current.push({ x, y, amount, ko: kind === "ko", t0: now });
      const strong = kind === "explode" || kind === "ko";
      shakeRef.current = {
        until: now + (strong ? 460 : 260),
        mag: strong ? 16 : kind === "spike" ? 10 : 7,
      };
    };

    const step = () => {
      const frame = Math.floor((performance.now() - start) / FRAME_MS);
      while (evIdx < events.length && events[evIdx].frame <= frame) {
        const e = events[evIdx++];
        fireEvent(e.kind, e.x, e.y, e.amount, e.owner, e.hp);
      }
      if (frame >= timeline.length) {
        // 남은 이벤트 마저 발생
        while (evIdx < events.length) {
          const e = events[evIdx++];
          fireEvent(e.kind, e.x, e.y, e.amount, e.owner, e.hp);
        }
        animRef.current = null;
        displayItemsRef.current = null;
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

      // 장애물/필드 (종류별 비주얼 + 약한 애니메이션)
      const tsec = performance.now() / 1000;
      for (const ob of obstaclesRef.current) {
        drawObstacle(ctx, ob, toS, zoom, tsec);
      }

      // 필드 아이템 (획득형 버프)
      const items = anim ? displayItemsRef.current ?? itemsRef.current : itemsRef.current;
      for (const it of items) {
        const info = ITEM_INFO[it.kind];
        if (!info) continue;
        const [ix, iy] = toS(it.x, it.y);
        const ir = it.r * zoom;
        const bob = Math.sin(tsec * 3 + it.x * 0.01) * 2;
        ctx.save();
        ctx.shadowColor = info.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(ix, iy + bob, ir, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(10,12,30,0.85)";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = info.color;
        ctx.stroke();
        ctx.restore();
        ctx.font = `${Math.min(22, ir * 1.1)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(info.emoji, ix, iy + bob);
      }

      // 마블 이동 잔상(트레일) — 재생 중에만
      if (anim) {
        for (const m of marbles) {
          if (!m.alive) continue;
          const pos = anim[m.owner];
          if (!pos) continue;
          const hist = (trailsRef.current[m.owner] ??= []);
          hist.push([pos[0], pos[1]]);
          if (hist.length > 12) hist.shift();
          if (hist.length > 1) {
            ctx.beginPath();
            for (let i = 0; i < hist.length; i++) {
              const [tx, ty] = toS(hist[i][0], hist[i][1]);
              if (i === 0) ctx.moveTo(tx, ty);
              else ctx.lineTo(tx, ty);
            }
            ctx.strokeStyle = playerColor(m.color_index);
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = Math.max(3, m.r * zoom * 0.7);
            ctx.lineCap = "round";
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineCap = "butt";
          }
        }
      } else {
        trailsRef.current = {};
      }

      // 마블
      for (const m of marbles) {
        if (!m.alive && !anim) continue;
        const pos = anim?.[m.owner] ?? [m.x, m.y];
        const [sx, sy] = toS(pos[0], pos[1]);
        const r = Math.max(4, m.r * zoom);
        const col = m.alive ? playerColor(m.color_index) : "rgba(120,120,120,0.4)";
        // 글로우
        if (m.alive) {
          ctx.save();
          ctx.shadowColor = col;
          ctx.shadowBlur = m.owner === currentTurnRef.current ? 22 : 10;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
        }
        // 광택(작은 하이라이트)
        if (m.alive) {
          ctx.beginPath();
          ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fill();
        }
        ctx.lineWidth = m.color_index === 0 ? 2 : 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        if (m.shield) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = "#7dd3fc";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 현재 차례 표시 링
        if (m.alive && m.owner === currentTurnRef.current) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 7, 0, Math.PI * 2);
          ctx.strokeStyle = "#ffd60a";
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.8;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // 체력바 + 현재/최대 텍스트 (재생 중엔 이벤트 시점 체력으로 즉시 반영)
        if (m.alive) {
          const hp = anim ? (displayHpRef.current[m.owner] ?? m.hp) : m.hp;
          const bw = Math.max(34, r * 2.4);
          const ratio = Math.max(0, hp / m.max_hp);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - bw / 2, sy - r - 12, bw, 5);
          ctx.fillStyle = ratio > 0.4 ? "#4ade80" : "#f87171";
          ctx.fillRect(sx - bw / 2, sy - r - 12, bw * ratio, 5);
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(`${hp}/${m.max_hp}`, sx, sy - r - 14);
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
          // 슬링샷 당김 표시: 화살표는 당긴 방향(발사의 반대)을 가리킨다.
          drawAimArrow(
            ctx,
            toS,
            me.x,
            me.y,
            aimRef.current.angle + Math.PI,
            aimRef.current.power,
            arenaR,
            zoom,
            aimRef.current.power > 1 ? "#ff4d4d" : "#ffd60a",
          );
        }
      }

      // 상대 조준 미리보기 (당김 방향 표시)
      const oa = othersAimRef.current;
      if (oa && !anim) {
        const om = marbles.find((mm) => mm.owner === oa.owner && mm.alive);
        if (om) {
          drawAimArrow(ctx, toS, om.x, om.y, oa.angle + Math.PI, oa.power, arenaR, zoom, "#fb7185");
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

      // 떠오르는 데미지 숫자
      const liveTexts: typeof dmgTextsRef.current = [];
      for (const dt of dmgTextsRef.current) {
        const age = nowp - dt.t0;
        const life = dt.ko ? 1100 : 800;
        if (age > life) continue;
        liveTexts.push(dt);
        const t = age / life;
        const [px, py] = toS(dt.x, dt.y);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (dt.ko) {
          ctx.font = "bold 22px sans-serif";
          ctx.fillStyle = "#fca5a5";
          ctx.fillText(`-${dt.amount} 처치!`, px, py - 28 - t * 36);
        } else {
          ctx.font = "bold 18px sans-serif";
          ctx.fillStyle = "#fde047";
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.lineWidth = 3;
          const tx = px;
          const ty = py - 24 - t * 32;
          ctx.strokeText(`-${dt.amount}`, tx, ty);
          ctx.fillText(`-${dt.amount}`, tx, ty);
        }
        ctx.restore();
      }
      dmgTextsRef.current = liveTexts;

      // 아이템 획득 표시(이름 + 이모지 떠오름)
      const livePick: typeof pickTextsRef.current = [];
      for (const pt of pickTextsRef.current) {
        const age = nowp - pt.t0;
        const life = 1100;
        if (age > life) continue;
        livePick.push(pt);
        const info = ITEM_INFO[pt.kind];
        if (!info) continue;
        const t = age / life;
        const [px, py] = toS(pt.x, pt.y);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 16px sans-serif";
        ctx.fillStyle = info.color;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 3;
        const ty = py - 26 - t * 30;
        ctx.strokeText(`${info.emoji} ${info.name}`, px, ty);
        ctx.fillText(`${info.emoji} ${info.name}`, px, ty);
        ctx.restore();
      }
      pickTextsRef.current = livePick;

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
    // 슬링샷 방식: 당긴 반대 방향으로 발사 → 발사 각도는 드래그의 반대.
    const angle = Math.atan2(-dy, -dx);
    // 슬링샷(무제한)은 세기 상한이 더 높다.
    const cap = me.power === "slingshot" ? 2.6 : 1;
    const power = Math.min(cap, Math.hypot(dx, dy) / (arenaRRef.current * 0.9));
    aimRef.current = { angle, power };
    // 궤적 예측 (WASM) — 다른 알 + 솔리드 장애물(원형)을 장애물로 전달
    const others: number[] = [];
    for (const m of marblesRef.current) {
      if (m.owner !== myId && m.alive) others.push(m.x, m.y, m.r);
    }
    for (const ob of obstaclesRef.current) {
      if (OBSTACLE_INFO[ob.kind]?.solid && ob.shape === "circle") others.push(ob.x, ob.y, ob.r);
    }
    trajRef.current = predictPath(me.x, me.y, angle, power, 1.0, arenaRRef.current, me.r, new Float32Array(others));
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
      {myTurn && <div className="aim-hint">새총처럼 반대로 당겼다 놓으면 발사 (점선=예상 경로, 많이 당길수록 강함)</div>}
    </div>
  );
}

// 장애물/필드를 종류별로 그린다 (toS: 월드→화면, t: 초 단위 시간).
function drawObstacle(
  ctx: CanvasRenderingContext2D,
  ob: { kind: string; shape: string; x: number; y: number; r: number; w: number; h: number; dir: number },
  toS: (x: number, y: number) => [number, number],
  zoom: number,
  t: number,
) {
  const info = OBSTACLE_INFO[ob.kind];
  if (!info) return;
  const [ox, oy] = toS(ob.x, ob.y);
  const r = ob.r * zoom;
  const w = ob.w * zoom;
  const h = ob.h * zoom;

  const rectClip = () => {
    ctx.beginPath();
    ctx.rect(ox - w / 2, oy - h / 2, w, h);
    ctx.clip();
  };

  switch (ob.kind) {
    case "rock": {
      const g = ctx.createRadialGradient(ox - r * 0.3, oy - r * 0.3, r * 0.2, ox, oy, r);
      g.addColorStop(0, "#9aa3af");
      g.addColorStop(1, "#4b5563");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2b3340";
      ctx.lineWidth = 3;
      ctx.stroke();
      // 균열
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox - r * 0.4, oy - r * 0.1);
      ctx.lineTo(ox + r * 0.1, oy + r * 0.3);
      ctx.lineTo(ox + r * 0.45, oy - r * 0.2);
      ctx.stroke();
      break;
    }
    case "spike": {
      const spikes = 12;
      ctx.fillStyle = "#7f1d1d";
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const rad = i % 2 === 0 ? r : r * 0.7;
        const px = ox + Math.cos(a) * rad;
        const py = oy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "bumper": {
      const pulse = 0.85 + 0.15 * Math.sin(t * 4);
      ctx.save();
      ctx.shadowColor = "#f59e0b";
      ctx.shadowBlur = 14 * pulse;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ox, oy, r * 0.6 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#b45309";
      ctx.beginPath();
      ctx.arc(ox, oy, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "bomb": {
      ctx.fillStyle = "#1f2937";
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
      // 깜빡이는 도화선 점
      const blink = (Math.sin(t * 6) + 1) / 2;
      ctx.fillStyle = `rgba(239,68,68,${0.4 + 0.6 * blink})`;
      ctx.beginPath();
      ctx.arc(ox, oy - r * 0.7, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(ox - r * 0.3, oy - r * 0.3, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "lava": {
      ctx.save();
      rectClip();
      const a = 0.3 + 0.12 * Math.sin(t * 2.5);
      ctx.fillStyle = `rgba(239,68,68,${a})`;
      ctx.fillRect(ox - w / 2, oy - h / 2, w, h);
      // 거품
      for (let i = 0; i < 5; i++) {
        const bx = ox - w / 2 + ((i * 53.3 + t * 30 * (i % 2 ? 1 : -1)) % w + w) % w;
        const by = oy - h / 2 + ((i * 71.7 - t * 22) % h + h) % h;
        ctx.fillStyle = `rgba(251,146,60,${0.5})`;
        ctx.beginPath();
        ctx.arc(bx, by, 3 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - w / 2, oy - h / 2, w, h);
      break;
    }
    case "ice": {
      ctx.fillStyle = "rgba(125,211,252,0.22)";
      ctx.fillRect(ox - w / 2, oy - h / 2, w, h);
      ctx.save();
      rectClip();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      for (let d = -h; d < w; d += 26) {
        ctx.beginPath();
        ctx.moveTo(ox - w / 2 + d, oy - h / 2);
        ctx.lineTo(ox - w / 2 + d + h, oy + h / 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - w / 2, oy - h / 2, w, h);
      break;
    }
    case "swamp": {
      ctx.fillStyle = "rgba(74,124,89,0.4)";
      ctx.fillRect(ox - w / 2, oy - h / 2, w, h);
      ctx.save();
      rectClip();
      ctx.fillStyle = "rgba(40,80,55,0.5)";
      for (let i = 0; i < 6; i++) {
        const bx = ox - w / 2 + ((i * 61) % w);
        const by = oy - h / 2 + ((i * 97) % h);
        ctx.beginPath();
        ctx.ellipse(bx, by, 16, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = "#4a7c59";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - w / 2, oy - h / 2, w, h);
      break;
    }
    case "boost": {
      ctx.fillStyle = "rgba(34,211,238,0.2)";
      ctx.fillRect(ox - w / 2, oy - h / 2, w, h);
      ctx.save();
      rectClip();
      // 위로 흐르는 셰브론
      ctx.strokeStyle = "rgba(34,211,238,0.8)";
      ctx.lineWidth = 3;
      const off = (t * 60) % 40;
      for (let yy = oy + h / 2 + off; yy > oy - h / 2 - 40; yy -= 40) {
        ctx.beginPath();
        ctx.moveTo(ox - 18, yy);
        ctx.lineTo(ox, yy - 14);
        ctx.lineTo(ox + 18, yy);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - w / 2, oy - h / 2, w, h);
      break;
    }
    case "gravity": {
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, "rgba(167,139,250,0.5)");
      g.addColorStop(1, "rgba(139,92,246,0.08)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      // 안쪽으로 도는 링
      ctx.strokeStyle = "rgba(196,181,253,0.7)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const rr = r * (((t * 0.25 + i / 3) % 1));
        ctx.globalAlpha = 1 - rr / r;
        ctx.beginPath();
        ctx.arc(ox, oy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "wind": {
      ctx.fillStyle = "rgba(148,163,184,0.16)";
      ctx.fillRect(ox - w / 2, oy - h / 2, w, h);
      ctx.save();
      rectClip();
      ctx.strokeStyle = "rgba(226,232,240,0.6)";
      ctx.lineWidth = 2;
      const dx = Math.cos(ob.dir);
      const dy = Math.sin(ob.dir);
      const flow = (t * 120) % 60;
      for (let i = -2; i < 8; i++) {
        const base = i * 60 + flow;
        const cx2 = ox - w / 2 + base * dx + (h / 2) * -dy;
        const cy2 = oy - h / 2 + base * dy + (h / 2) * dx;
        ctx.beginPath();
        ctx.moveTo(cx2, cy2);
        ctx.lineTo(cx2 + dx * 26, cy2 + dy * 26);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - w / 2, oy - h / 2, w, h);
      // 방향 화살촉
      const ax = ox + dx * 22;
      const ay = oy + dy * 22;
      ctx.fillStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - dx * 12 - dy * 7, ay - dy * 12 + dx * 7);
      ctx.lineTo(ax - dx * 12 + dy * 7, ay - dy * 12 - dx * 7);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  // 라벨(작게, 솔리드만)
  if (info.solid && r > 22) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `${Math.min(15, r * 0.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(info.emoji, ox, oy + r * 0.02);
  }
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
