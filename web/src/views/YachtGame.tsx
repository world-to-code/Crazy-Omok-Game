import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../state/store";
import {
  CATEGORIES,
  CAT_INDEX,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  categoryScore,
  totalScore,
  upperSum,
} from "../yacht/engine";
import { YachtScene } from "../yacht/scene/scene";
import { playStone, playResult, playFanfare } from "../bot/sound";
import SoundToggle from "../bot/SoundToggle";
import Countdown from "../components/Countdown";
import { useViewportSize } from "../bot/useViewport";
import { resolvePlayerColor } from "../types";
import Chat from "../components/Chat";
import YachtGuide from "../yacht/YachtGuide";

export default function YachtGame() {
  const { state, send, leave } = useGame();
  const { yacht, yachtEvent, players, myId } = state;
  const { w: vw } = useViewportSize();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<YachtScene | null>(null);
  const readyRef = useRef(false);
  const animatingRef = useRef(false);
  const yachtRef = useRef(yacht);
  const processedRef = useRef(0);
  const shakeRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  const [, force] = useState(0);

  yachtRef.current = yacht;

  const order = yacht?.order ?? [];
  const myOwner = myId ? order.indexOf(myId) : -1;
  const isMyTurn = !!yacht && yacht.turn === myId && yacht.phase === "roll";
  const prevScoreCount = useRef(0);

  // 씬 생성.
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new YachtScene(canvasRef.current);
    scene.start();
    sceneRef.current = scene;
    readyRef.current = true;
    if (yachtRef.current) scene.setDice(yachtRef.current.dice, yachtRef.current.keep);
    const resize = () => {
      const el = wrapRef.current;
      if (el) scene.resize(el.clientWidth, el.clientHeight);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
      scene.dispose();
      sceneRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 굴림 이벤트 → 던지기 애니메이션(스냅샷 effect보다 먼저).
  useEffect(() => {
    const evt = yachtEvent;
    if (!evt || evt.seq === processedRef.current) return;
    processedRef.current = evt.seq;
    const scene = sceneRef.current;
    if (!scene || !readyRef.current) return;
    animatingRef.current = true;
    let cancelled = false;
    playStone();
    scene.throwDice(evt.dice, evt.keep, evt.firstRoll).then(() => {
      if (cancelled) return;
      animatingRef.current = false;
      const y = yachtRef.current;
      if (y) scene.setDice(y.dice, y.keep);
      force((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yachtEvent?.seq]);

  // 스냅샷 변경 → 애니메이션 중이 아니면 즉시 주사위 반영.
  useEffect(() => {
    if (!readyRef.current || animatingRef.current) return;
    if (yacht) sceneRef.current?.setDice(yacht.dice, yacht.keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yacht]);

  // 50점 이상 기록·승패음.
  useEffect(() => {
    if (!yacht) return;
    const filled = yacht.scores.reduce((a, c) => a + c.filter((v) => v !== null).length, 0);
    if (filled > prevScoreCount.current) {
      prevScoreCount.current = filled;
    }
    if (yacht.phase === "over" && yacht.winner) playResult(yacht.winner === myId);
  }, [yacht, myId]);

  // 흔들기(드래그) → 놓으면 굴림 요청.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isMyTurn || (yacht?.rollsLeft ?? 0) <= 0 || animatingRef.current) return;
      shakeRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    },
    [isMyTurn, yacht?.rollsLeft],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const sh = shakeRef.current;
    if (!sh.active) return;
    const d = Math.hypot(e.clientX - sh.lastX, e.clientY - sh.lastY);
    sh.lastX = e.clientX;
    sh.lastY = e.clientY;
    sceneRef.current?.setShake(Math.min(1, d / 22));
  }, []);
  const onPointerUp = useCallback(() => {
    const sh = shakeRef.current;
    if (!sh.active) return;
    sh.active = false;
    if (isMyTurn && (yacht?.rollsLeft ?? 0) > 0 && !animatingRef.current) {
      send({ type: "YachtRoll" });
    }
  }, [isMyTurn, yacht?.rollsLeft, send]);

  const onToggleKeep = useCallback(
    (i: number) => {
      if (!isMyTurn || !yacht?.rolled || animatingRef.current) return;
      send({ type: "YachtKeep", index: i });
    },
    [isMyTurn, yacht?.rolled, send],
  );

  const onScore = useCallback(
    (catIdx: number) => {
      if (!isMyTurn || !yacht?.rolled || animatingRef.current) return;
      if (myOwner < 0 || yacht.scores[myOwner][catIdx] !== null) return;
      const pts = categoryScore(yacht.dice, CATEGORIES[catIdx].key);
      if (pts >= 50) playFanfare();
      send({ type: "YachtScore", category: catIdx });
    },
    [isMyTurn, yacht, myOwner, send],
  );

  const myOpenPreview = useMemo(() => {
    if (!yacht || !isMyTurn || !yacht.rolled || myOwner < 0) return null;
    return CATEGORIES.map((c, i) => (yacht.scores[myOwner][i] === null ? categoryScore(yacht.dice, c.key) : null));
  }, [yacht, isMyTurn, myOwner]);

  if (!yacht) {
    return (
      <div className="game">
        <div style={{ textAlign: "center", paddingTop: 120, color: "#a99a86" }}>요트 준비 중…</div>
      </div>
    );
  }

  const over = yacht.phase === "over";
  const turnPlayer = players.find((p) => p.id === yacht.turn);
  const winnerPlayer = players.find((p) => p.id === yacht.winner);
  const isHost = state.settings?.host_id === myId;

  // 족보 한 줄(N인). 내 칸은 클릭해 기록, +초록은 미리보기 점수.
  const renderCat = (c: (typeof CATEGORIES)[number]) => {
    const idx = CAT_INDEX[c.key];
    const clickable = isMyTurn && yacht.rolled && myOwner >= 0 && yacht.scores[myOwner][idx] === null && !animatingRef.current;
    const preview = myOpenPreview ? myOpenPreview[idx] : null;
    return (
      <tr key={c.key} style={{ borderTop: "1px solid #2a2230" }}>
        <td style={{ padding: "4px 2px", color: c.key === "yacht" ? "#f0c674" : "#d8c9b4", fontWeight: c.key === "yacht" ? 700 : 400 }} title={`${c.hint} — ${c.example}`}>
          {c.label}
        </td>
        {order.map((id, owner) => {
          const val = yacht.scores[owner][idx];
          const mine = owner === myOwner;
          const showPreview = mine && val === null && preview !== null;
          return (
            <td
              key={id}
              onClick={mine && clickable ? () => onScore(idx) : undefined}
              title={mine && clickable ? "여기에 기록" : undefined}
              style={{
                textAlign: "center",
                padding: "4px 2px",
                cursor: mine && clickable ? "pointer" : "default",
                background: mine && clickable ? "rgba(127,209,140,.10)" : "transparent",
                color: val !== null ? (mine ? "#f0d9a0" : "#a9c0d8") : showPreview ? "#7fd18c" : "#5a4f44",
                fontWeight: val !== null ? 700 : 400,
                borderRadius: 4,
                outline: mine && clickable ? "1px solid rgba(127,209,140,.3)" : "none",
              }}
            >
              {val !== null ? val : showPreview ? `+${preview}` : "·"}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <div className="game-bar card">
        <button className="back" onClick={leave}>← 나가기</button>
        <div className="turn-info">
          <span className={isMyTurn ? "turn-me" : ""}>
            {over
              ? "게임 종료"
              : turnPlayer
                ? `🎲 ${turnPlayer.nickname}${turnPlayer.id === myId ? "(나)" : ""} 차례 — ${yacht.rolled ? `남은 굴림 ${yacht.rollsLeft}` : "컵을 흔드세요"}`
                : "대기 중"}
          </span>
        </div>
        <Countdown deadlineMs={state.deadlineMs} />
        <SoundToggle />
      </div>

      <div style={{ display: "flex", gap: 14, height: "min(76vh, 820px)", marginTop: 8, width: `${vw}px`, marginLeft: `calc(50% - ${vw / 2}px)`, boxSizing: "border-box", padding: "0 20px" }}>
        <div
          ref={wrapRef}
          style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 30%, #1c2436, #0c0f16)", touchAction: "none" }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ width: "100%", height: "100%", display: "block", cursor: isMyTurn && yacht.rollsLeft > 0 ? "grab" : "default" }}
          />

          {yacht.rolled && (
            <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }}>
              {yacht.dice.map((d, i) => (
                <button
                  key={i}
                  onClick={() => onToggleKeep(i)}
                  disabled={!isMyTurn}
                  style={{
                    width: 46, height: 46, borderRadius: 10, fontSize: 22, fontWeight: 800, color: "#222",
                    background: yacht.keep[i] ? "#ffe08a" : "#f4efe6",
                    border: yacht.keep[i] ? "3px solid #e0a458" : "2px solid #9a8b76",
                    boxShadow: yacht.keep[i] ? "0 0 12px rgba(224,164,88,.6)" : "none",
                    cursor: isMyTurn ? "pointer" : "default",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          {!over && (
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", pointerEvents: "none", color: "#cfe0f0", fontSize: 14, textShadow: "0 2px 6px #000" }}>
              {!isMyTurn
                ? `🎲 ${turnPlayer?.nickname ?? ""} 차례를 기다리는 중…`
                : yacht.rolled
                  ? yacht.rollsLeft > 0
                    ? "킵할 주사위를 고르고 컵을 다시 흔들거나, 점수판에서 칸을 고르세요"
                    : "점수판에서 기록할 칸을 고르세요"
                  : "🥤 마우스로 컵을 잡고 흔든 뒤 놓으세요"}
            </div>
          )}
        </div>

        {/* 점수판 (N인) + 채팅 */}
        <aside style={{ width: Math.min(120 + order.length * 56, 380), flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div className="card scl" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 10px" }}>
          <div style={{ fontSize: 11, color: "#9a8b76", marginBottom: 6, lineHeight: 1.4 }}>
            내 차례에 기록할 칸을 클릭하세요. <span style={{ color: "#7fd18c" }}>+초록</span>은 지금 기록 시 받을 점수.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "#a99a86" }}>
                <th style={{ textAlign: "left", padding: "4px 2px" }}>족보</th>
                {order.map((id, owner) => {
                  const p = players.find((pp) => pp.id === id);
                  const cur = yacht.turn === id && !over;
                  return (
                    <th key={id} style={{ textAlign: "center", padding: "4px 2px", color: cur ? "#f0d9a0" : "#a9c0d8", fontSize: 11 }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: resolvePlayerColor({ color_index: owner, color: null }), marginRight: 3 }} />
                      {(p?.nickname ?? "?").slice(0, 4)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={1 + order.length} style={{ padding: "7px 2px 3px", color: "#c9a86a", fontSize: 11, fontWeight: 700 }}>▸ 윗칸 · 같은 눈 모으기</td></tr>
              {CATEGORIES.filter((c) => c.section === "upper").map((c) => renderCat(c))}
              <tr style={{ borderTop: "1px dashed #3a3040" }}>
                <td style={{ padding: "5px 2px", fontSize: 10.5, color: "#c9a86a" }} title={`윗칸 합 ${UPPER_BONUS_THRESHOLD}점 이상이면 +${UPPER_BONUS}점`}>🎁 보너스</td>
                {order.map((id, owner) => {
                  const u = upperSum(yacht.scores[owner]);
                  const ok = u >= UPPER_BONUS_THRESHOLD;
                  return <td key={id} style={{ textAlign: "center", fontSize: 10.5, color: ok ? "#7fd18c" : "#8a7d6a" }}>{u}/{UPPER_BONUS_THRESHOLD}{ok ? ` +${UPPER_BONUS}` : ""}</td>;
                })}
              </tr>
              <tr><td colSpan={1 + order.length} style={{ padding: "7px 2px 3px", color: "#c9a86a", fontSize: 11, fontWeight: 700 }}>▸ 아랫칸 · 특별한 조합</td></tr>
              {CATEGORIES.filter((c) => c.section === "lower").map((c) => renderCat(c))}
              <tr style={{ borderTop: "2px solid #3a3040", fontWeight: 800 }}>
                <td style={{ padding: "7px 2px", color: "#f0d9a0" }}>합계</td>
                {order.map((id, owner) => (
                  <td key={id} style={{ textAlign: "center", color: owner === myOwner ? "#f0d9a0" : "#a9c0d8", fontSize: 14 }}>{totalScore(yacht.scores[owner])}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <YachtGuide defaultOpen={false} />
          </div>
          <Chat />
        </aside>
      </div>

      {over && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>{yacht.winner === myId ? "🏆 승리!" : "🏁 게임 종료"}</h2>
            <p>{winnerPlayer ? `${winnerPlayer.nickname} 님이 ${totalScore(yacht.scores[Math.max(0, order.indexOf(yacht.winner ?? ""))])}점으로 승리!` : "게임 종료"}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              {isHost && <button className="primary big" onClick={() => send({ type: "ReturnToLobby" })}>로비로</button>}
              <button className="big" onClick={leave}>나가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
