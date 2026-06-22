import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../state/store";
import { HOME, type NodeId } from "../yut/board";
import { applyMove, describeMove, legalTargets, stateFromSnapshot, type MoveTarget } from "../yut/engine";
import type { YutState, ThrowResult, ThrowName } from "../yut/types";
import { THROW_LABEL } from "../yut/types";
import { zodiacOf } from "../yut/zodiac";
import { YutScene } from "../yut/scene/scene";
import { playCapture, playStone, playResult, playFanfare } from "../bot/sound";
import SoundToggle from "../bot/SoundToggle";
import Countdown from "../components/Countdown";
import { useViewportSize } from "../bot/useViewport";
import { resolvePlayerColor } from "../types";

const groupKeyOf = (node: NodeId): NodeId => (node === HOME ? HOME : node);
const CONFETTI = ["🎉", "🎊", "✨", "⭐", "🏆", "🪅"];

function buildMirror(
  pieces: { id: number; owner: number; node: string; lane: string; done: boolean }[],
  order: string[],
  turn: string | null,
  phase: string,
  queue: ThrowResult[],
): YutState {
  return stateFromSnapshot({
    pieces,
    turnOwner: turn ? Math.max(0, order.indexOf(turn)) : 0,
    phase: phase as "throw" | "move" | "over",
    queue,
    winner: null,
  });
}

export default function YutGame() {
  const { state, send, leave } = useGame();
  const { yut, yutEvent, players, myId } = state;
  const { w: vw } = useViewportSize();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<YutScene | null>(null);
  const readyRef = useRef(false);
  const animatingRef = useRef(false);
  const mirrorRef = useRef<YutState | null>(null);
  const yutRef = useRef(yut);
  const processedEvtRef = useRef(0);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const [ready, setReady] = useState(false);
  const [selPiece, setSelPiece] = useState<number | null>(null);
  const [announce, setAnnounce] = useState<ThrowResult | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  yutRef.current = yut;

  const order = yut?.order ?? [];
  const myOwner = myId ? order.indexOf(myId) : -1;
  const isMyTurn = !!yut && yut.turn === myId && yut.phase !== "over";
  const phase = yut?.phase;

  const zodiacs = useMemo(
    () => order.map((id) => zodiacOf(players.find((p) => p.id === id)?.zodiac ?? undefined)),
    [order, players],
  );

  const nameOf = (id: string) => players.find((p) => p.id === id)?.nickname ?? "?";

  // 스냅샷을 씬에 반영(미러 갱신 + 위치 스냅).
  function reconcile() {
    const y = yutRef.current;
    const scene = sceneRef.current;
    if (!y || !scene || !readyRef.current) return;
    mirrorRef.current = buildMirror(y.pieces, y.order, y.turn, y.phase, y.queue as unknown as ThrowResult[]);
    scene.syncPieces(mirrorRef.current.pieces);
  }

  // 씬 생성 + 모델 로드.
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new YutScene(canvasRef.current);
    scene.setPlayers(zodiacs);
    scene.start();
    sceneRef.current = scene;
    let alive = true;
    const models = Array.from(new Set(zodiacs.map((z) => z.model)));
    scene.preload(models).then(() => {
      if (!alive) return;
      readyRef.current = true;
      setReady(true);
      reconcile();
      setTick((n) => n + 1);
    });
    const resize = () => {
      const el = wrapRef.current;
      if (el) scene.resize(el.clientWidth, el.clientHeight);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", resize);
    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener("resize", resize);
      scene.dispose();
      sceneRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 로그 자동 스크롤.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines.length]);

  // 던지기/이동 이벤트 → 애니메이션 (스냅샷 effect보다 먼저 선언).
  useEffect(() => {
    const evt = yutEvent;
    if (!evt || evt.seq === processedEvtRef.current) return;
    processedEvtRef.current = evt.seq;
    const scene = sceneRef.current;
    if (!scene || !readyRef.current) return;
    animatingRef.current = true;
    let cancelled = false;
    (async () => {
      if (evt.kind === "throw") {
        playStone();
        await scene.throwYut(evt.result as unknown as ThrowResult);
        if (cancelled) return;
        if (announceTimer.current) clearTimeout(announceTimer.current);
        setAnnounce(evt.result as unknown as ThrowResult);
        if (evt.result.bonus) playFanfare();
        announceTimer.current = setTimeout(() => setAnnounce(null), 1300);
        setLogLines((l) => [...l, `${nameOf(evt.by)}: ${THROW_LABEL[evt.result.name as ThrowName] ?? evt.result.name}${evt.result.bonus ? " (한 번 더!)" : ""}`]);
      } else {
        const mirror = mirrorRef.current;
        if (mirror) {
          const route = evt.route as "diag" | "straight";
          const detail = describeMove(mirror, evt.throwIndex, evt.key, route);
          if (detail) {
            const finalPieces = applyMove(mirror, evt.throwIndex, evt.key, route).pieces;
            await scene.walkMovers(detail, finalPieces);
            if (cancelled) return;
            if (detail.capturedIds.length) {
              playCapture();
              await scene.killAndReturn(detail.capturedIds, finalPieces);
            }
            setLogLines((l) => [
              ...l,
              `${nameOf(evt.by)}: 이동${detail.capturedIds.length ? " · 잡음 ⚔️" : ""}${detail.finishes ? " · 완주 🏁" : ""}`,
            ]);
          }
        }
      }
      if (cancelled) return;
      animatingRef.current = false;
      reconcile();
      setTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yutEvent?.seq]);

  // 스냅샷 변경 → 애니메이션 중이 아니면 즉시 반영.
  useEffect(() => {
    if (!readyRef.current) return;
    if (animatingRef.current) return;
    reconcile();
    setTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yut]);

  // 승패 효과음.
  useEffect(() => {
    if (yut?.phase === "over" && yut.winner) playResult(yut.winner === myId);
  }, [yut?.phase, yut?.winner, myId]);

  // 내 차례·이동 단계가 아니면 선택 해제.
  useEffect(() => {
    if (!(isMyTurn && phase === "move")) setSelPiece(null);
  }, [isMyTurn, phase]);

  // ===== 선택/마커 계산 (미러 기반) =====
  const mirror = mirrorRef.current;
  const canSelect = !!mirror && isMyTurn && phase === "move";

  const moveKeys = useMemo(() => {
    const keys = new Set<NodeId>();
    if (canSelect && mirror) for (const t of mirror.queue) for (const tg of legalTargets(mirror, t)) keys.add(tg.key);
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSelect, yut, tick]);

  const selectableIds = useMemo(() => {
    if (!canSelect || !mirror || myOwner < 0) return [];
    return mirror.pieces.filter((p) => p.owner === myOwner && !p.done && moveKeys.has(groupKeyOf(p.node))).map((p) => p.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSelect, moveKeys, myOwner, yut, tick]);

  const selOptions = useMemo(() => {
    const out: { throwIndex: number; target: MoveTarget }[] = [];
    if (!canSelect || !mirror || selPiece == null) return out;
    const sel = mirror.pieces.find((p) => p.id === selPiece);
    if (!sel) return out;
    const gk = groupKeyOf(sel.node);
    mirror.queue.forEach((t, i) => {
      for (const tg of legalTargets(mirror, t)) if (tg.key === gk) out.push({ throwIndex: i, target: tg });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSelect, selPiece, yut, tick]);

  // 선택 가능 말 화살표 + 선택 강조 + 그 말의 이동 마커.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const active = canSelect && !animatingRef.current;
    scene.setSelectable(active ? selectableIds : []);
    const selecting = active && selPiece != null;
    scene.setSelected(selecting ? selPiece : null);
    if (selecting && selOptions.length && mirror) {
      scene.showMoves(
        selOptions.map((o) => ({
          to: o.target.to,
          label: THROW_LABEL[mirror.queue[o.throwIndex].name],
          kind: o.target.finishes ? "finish" : o.target.captures ? "capture" : "move",
          throwIndex: o.throwIndex,
          key: o.target.key,
          route: o.target.route,
        })),
      );
    } else {
      scene.clearMoves();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selPiece, selectableIds, selOptions, canSelect, tick]);

  // 캔버스 클릭: 말 선택 → 그 말의 도착 마커 클릭 시 서버로 이동 요청.
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const scene = sceneRef.current;
    if (!scene || animatingRef.current || !isMyTurn || phase !== "move") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (selPiece != null) {
      const mv = scene.pickMove(nx, ny);
      if (mv) {
        setSelPiece(null);
        send({ type: "YutMove", throw_index: mv.throwIndex, key: mv.key, route: mv.route });
        return;
      }
    }
    const id = scene.pickPiece(nx, ny);
    if (id == null) {
      setSelPiece(null);
      return;
    }
    const p = mirror?.pieces.find((x) => x.id === id);
    if (p && p.owner === myOwner && moveKeys.has(groupKeyOf(p.node))) setSelPiece(id);
  }

  if (!yut) {
    return (
      <div className="game">
        <div style={{ textAlign: "center", paddingTop: 120, color: "#a99a86" }}>윷놀이 준비 중…</div>
      </div>
    );
  }

  const over = yut.phase === "over";
  const turnPlayer = players.find((p) => p.id === yut.turn);
  const turnZ = turnPlayer ? zodiacOf(turnPlayer.zodiac ?? undefined) : null;
  const winnerPlayer = players.find((p) => p.id === yut.winner);
  const isHost = state.settings?.host_id === myId;

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <style>{`
        @keyframes yut-pop { 0% { transform: scale(.4); opacity: 0; } 18% { transform: scale(1.12); opacity: 1; } 78% { transform: scale(1); opacity: 1; } 100% { transform: scale(.92); opacity: 0; } }
        @keyframes yut-conf { 0% { transform: translateY(-10vh) rotate(0); opacity: 1; } 100% { transform: translateY(85vh) rotate(540deg); opacity: .9; } }
      `}</style>
      <div className="game-bar card">
        <button className="back" onClick={leave}>← 나가기</button>
        <div className="turn-info">
          <span className={isMyTurn ? "turn-me" : ""}>
            {over
              ? "게임 종료"
              : turnPlayer
                ? `${turnZ?.emoji ?? ""} ${turnPlayer.nickname}${isMyTurn ? "(나)" : ""} 차례 — ${yut.phase === "throw" ? "윷 던지기" : "이동"}`
                : "대기 중"}
          </span>
        </div>
        <Countdown deadlineMs={state.deadlineMs} />
        <SoundToggle />
      </div>

      {/* 메인: 좌 3D 캔버스(크게) + 우 사이드. 풀블리드. */}
      <div
        style={{
          width: `${vw}px`,
          marginLeft: `calc(50% - ${vw / 2}px)`,
          boxSizing: "border-box",
          padding: "0 20px",
          display: "flex",
          gap: 14,
          height: "min(76vh, 820px)",
          marginTop: 8,
        }}
      >
        <div
          ref={wrapRef}
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            borderRadius: 14,
            overflow: "hidden",
            background: "radial-gradient(circle at 50% 28%, #271d31, #100b15)",
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            style={{ width: "100%", height: "100%", display: "block", cursor: selectableIds.length || selOptions.length ? "pointer" : "default" }}
          />
          {!ready && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#c9b89f", fontSize: 16 }}>
              🐯 캐릭터 불러오는 중…
            </div>
          )}

          {/* 윷 결과 대형 연출 */}
          {announce && (
            <div key={logLines.length} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ animation: "yut-pop 1.3s ease-out forwards", textAlign: "center" }}>
                <div style={{ fontSize: "clamp(64px, 12vw, 150px)", fontWeight: 900, color: announce.bonus ? "#ffd24a" : "#f5ead0", textShadow: "0 6px 26px rgba(0,0,0,.75)", lineHeight: 1 }}>
                  {THROW_LABEL[announce.name]}
                </div>
                <div style={{ fontSize: "clamp(16px,2.4vw,26px)", fontWeight: 800, color: announce.bonus ? "#ffd24a" : "#c9b89f", marginTop: 4 }}>
                  {announce.steps > 0 ? `${announce.steps}칸 전진` : "한 칸 뒤로"}
                  {announce.bonus && " · 한 번 더! 🎉"}
                </div>
              </div>
            </div>
          )}

          {/* 쌓인 던지기 결과 */}
          {!over && yut.queue.length > 0 && (
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
              {yut.queue.map((t, i) => (
                <span key={i} style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(20,14,22,.82)", border: "1px solid #4a3a55", color: "#f0d9a0", fontWeight: 700, fontSize: 14 }}>
                  {THROW_LABEL[t.name as ThrowName] ?? t.name}
                </span>
              ))}
            </div>
          )}

          {/* 하단 컨트롤 */}
          <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ pointerEvents: "auto" }}>
              {!ready || over ? null : !isMyTurn ? (
                <div style={{ padding: "10px 18px", borderRadius: 12, background: "rgba(20,14,22,.82)", color: "#c9b89f" }}>
                  {turnZ?.emoji} {turnPlayer?.nickname ?? ""} 차례를 기다리는 중…
                </div>
              ) : yut.phase === "throw" ? (
                <button className="big primary" style={{ fontSize: 18, padding: "12px 28px" }} onClick={() => send({ type: "YutThrow" })}>
                  🎲 윷 던지기
                </button>
              ) : (
                <div style={{ padding: "9px 18px", borderRadius: 12, background: "rgba(20,14,22,.82)", color: "#f0d9a0", fontSize: 14 }}>
                  {selectableIds.length === 0
                    ? "둘 수 있는 말이 없습니다…"
                    : selPiece == null
                      ? "🐾 움직일 말을 선택하세요 (반짝이는 말)"
                      : "✨ 이동할 곳(빛나는 칸)을 클릭 · 다른 말 클릭 시 변경"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 우측 사이드 */}
        <aside style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ ...labelHead, marginBottom: 8 }}>현황</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {order.map((id, owner) => {
                const p = players.find((pp) => pp.id === id);
                const z = zodiacOf(p?.zodiac ?? undefined);
                const done = yut.pieces.filter((q) => q.owner === owner && q.done).length;
                const home = yut.pieces.filter((q) => q.owner === owner && q.node === "home").length;
                const board = yut.pieces.filter((q) => q.owner === owner && !q.done && q.node !== "home").length;
                const cur = yut.turn === id && !over;
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, opacity: cur ? 1 : 0.72 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: resolvePlayerColor({ color_index: owner, color: null }), flexShrink: 0 }} />
                    <span style={{ fontSize: 20 }}>{z.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: cur ? "#f0d9a0" : "#c9b89f" }}>
                        {p?.nickname ?? "?"}{id === myId ? " (나)" : ""} {cur && "▶"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#a99a86", fontFamily: "monospace" }}>완주 {done}/4 · 판 {board} · 대기 {home}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "10px 0 6px" }}>
            <div style={{ ...labelHead, padding: "0 14px 8px" }}>기보</div>
            <div ref={logRef} className="scl" style={{ flex: 1, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              {logLines.length === 0 && <div style={{ fontSize: 12.5, color: "#6b5d4f" }}>윷을 던져 시작하세요!</div>}
              {logLines.map((l, i) => (
                <div key={i} style={{ fontSize: 12.5, color: l.startsWith(nameOf(myId ?? "")) ? "#e0c089" : "#a9c0d8", padding: "1px 0", lineHeight: 1.4 }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {over && yut.winner === myId && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 50 }}>
          {Array.from({ length: 36 }).map((_, i) => (
            <span key={i} style={{ position: "absolute", left: `${(i * 2.718) % 100}%`, top: "-8vh", fontSize: `${18 + (i % 4) * 8}px`, animation: `yut-conf ${2.4 + (i % 5) * 0.4}s linear ${(i % 7) * 0.18}s infinite` }}>
              {CONFETTI[i % CONFETTI.length]}
            </span>
          ))}
        </div>
      )}

      {over && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>{yut.winner === myId ? "🏆 승리!" : "🏁 게임 종료"}</h2>
            <p>
              {winnerPlayer
                ? `${zodiacOf(winnerPlayer.zodiac ?? undefined).emoji} ${winnerPlayer.nickname} 님이 말 4개를 모두 완주시켜 승리했습니다!`
                : "게임이 종료되었습니다."}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              {isHost && (
                <button className="primary big" onClick={() => send({ type: "ReturnToLobby" })}>로비로</button>
              )}
              <button className="big" onClick={leave}>나가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelHead: React.CSSProperties = { fontSize: 11, letterSpacing: ".15em", color: "#8a7c6c", fontFamily: "monospace", textTransform: "uppercase" };
