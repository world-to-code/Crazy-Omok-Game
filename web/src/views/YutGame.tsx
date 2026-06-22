import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../state/store";
import { applyMove, describeMove, legalTargets, stateFromSnapshot } from "../yut/engine";
import type { YutState, ThrowResult } from "../yut/types";
import { THROW_LABEL } from "../yut/types";
import { zodiacOf } from "../yut/zodiac";
import { YutScene } from "../yut/scene/scene";
import { playCapture, playStone, playResult, playFanfare } from "../bot/sound";
import SoundToggle from "../bot/SoundToggle";
import Countdown from "../components/Countdown";
import { resolvePlayerColor } from "../types";

// 서버 스냅샷(store.yut) → 미러 YutState. 애니메이션 경로 계산에 사용.
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<YutScene | null>(null);
  const readyRef = useRef(false);
  const animatingRef = useRef(false);
  const mirrorRef = useRef<YutState | null>(null);
  const yutRef = useRef(yut);
  const pendingSnapRef = useRef(false);
  const processedEvtRef = useRef(0);
  // 애니메이션 완료/스냅샷 반영 후 마커 effect를 다시 돌리기 위한 틱.
  const [tick, setTick] = useState(0);

  yutRef.current = yut;

  const order = yut?.order ?? [];
  const isMyTurn = !!yut && yut.turn === myId && yut.phase !== "over";

  // owner 인덱스별 12지신.
  const zodiacs = useMemo(
    () => order.map((id) => zodiacOf(players.find((p) => p.id === id)?.zodiac ?? undefined)),
    [order, players],
  );

  // 스냅샷을 씬에 반영(미러 갱신 + 위치 스냅).
  const reconcile = useCallback(() => {
    const y = yutRef.current;
    const scene = sceneRef.current;
    if (!y || !scene || !readyRef.current) return;
    mirrorRef.current = buildMirror(y.pieces, y.order, y.turn, y.phase, y.queue as unknown as ThrowResult[]);
    scene.syncPieces(mirrorRef.current.pieces);
    pendingSnapRef.current = false;
  }, []);

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

  // 던지기/이동 이벤트 → 애니메이션. (스냅샷 effect보다 먼저 선언: animating 플래그 선점.)
  useEffect(() => {
    const evt = yutEvent;
    if (!evt || evt.seq === processedEvtRef.current) return;
    processedEvtRef.current = evt.seq;
    const scene = sceneRef.current;
    if (!scene || !readyRef.current) {
      pendingSnapRef.current = true;
      return;
    }
    animatingRef.current = true;
    let cancelled = false;
    (async () => {
      if (evt.kind === "throw") {
        playStone();
        if (evt.result.bonus) playFanfare();
        await scene.throwYut(evt.result as unknown as ThrowResult);
      } else {
        const mirror = mirrorRef.current;
        if (mirror) {
          const route = evt.route as "diag" | "straight";
          const detail = describeMove(mirror, evt.throwIndex, evt.key, route);
          if (detail) {
            // 최종 위치는 미러에 수를 적용해 결정(스냅샷 도착 타이밍과 무관하게 정확).
            const finalPieces = applyMove(mirror, evt.throwIndex, evt.key, route).pieces;
            await scene.walkMovers(detail, finalPieces);
            if (detail.capturedIds.length) {
              playCapture();
              await scene.killAndReturn(detail.capturedIds, finalPieces);
            }
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

  // 스냅샷 변경 → 애니메이션 중이 아니면 즉시 반영(입장/스킵/로비 등).
  useEffect(() => {
    if (!readyRef.current) return;
    if (animatingRef.current) {
      pendingSnapRef.current = true;
      return;
    }
    reconcile();
    setTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yut]);

  // 승패 효과음.
  useEffect(() => {
    if (yut?.phase === "over" && yut.winner) playResult(yut.winner === myId);
  }, [yut?.phase, yut?.winner, myId]);

  // 내 이동 선택지 마커 표시(내 차례·이동 단계).
  const showMyMoves = useCallback(() => {
    const scene = sceneRef.current;
    const mirror = mirrorRef.current;
    if (!scene) return;
    if (!mirror || !isMyTurn || yut?.phase !== "move" || animatingRef.current) {
      scene.clearMoves();
      return;
    }
    const specs: {
      to: string;
      label: string;
      kind: "move" | "capture" | "finish";
      throwIndex: number;
      key: string;
      route: "diag" | "straight";
    }[] = [];
    mirror.queue.forEach((t, i) => {
      for (const tg of legalTargets(mirror, t)) {
        specs.push({
          to: tg.to as string,
          label: THROW_LABEL[t.name],
          kind: tg.finishes ? "finish" : tg.captures ? "capture" : "move",
          throwIndex: i,
          key: tg.key,
          route: tg.route,
        });
      }
    });
    scene.showMoves(specs);
  }, [isMyTurn, yut?.phase]);

  useEffect(() => {
    showMyMoves();
  }, [showMyMoves, yut, tick]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const scene = sceneRef.current;
      if (!scene || animatingRef.current || !isMyTurn || yut?.phase !== "move") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const mv = scene.pickMove(nx, ny);
      if (mv) {
        scene.clearMoves();
        send({ type: "YutMove", throw_index: mv.throwIndex, key: mv.key, route: mv.route });
      }
    },
    [isMyTurn, yut?.phase, send],
  );

  if (!yut) {
    return (
      <div className="game">
        <div style={{ textAlign: "center", paddingTop: 120, color: "#a99a86" }}>윷놀이 준비 중…</div>
      </div>
    );
  }

  const turnPlayer = players.find((p) => p.id === yut.turn);
  const turnZ = turnPlayer ? zodiacOf(turnPlayer.zodiac ?? undefined) : null;
  const over = yut.phase === "over";
  const winnerPlayer = players.find((p) => p.id === yut.winner);
  const isHost = state.settings?.host_id === myId;

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <div className="game-bar card">
        <button className="back" onClick={leave}>← 나가기</button>
        <div className="turn-info">
          <span className={isMyTurn ? "turn-me" : ""}>
            {over
              ? "게임 종료"
              : turnPlayer
                ? `${turnZ?.emoji ?? ""} ${turnPlayer.nickname} 차례${isMyTurn ? " (나)" : ""} — ${yut.phase === "throw" ? "윷 던지기" : "이동"}`
                : "대기 중"}
          </span>
        </div>
        <Countdown deadlineMs={state.deadlineMs} />
        <SoundToggle />
      </div>

      {/* 현황 */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", margin: "8px 0", fontSize: 13 }}>
        {order.map((id, owner) => {
          const p = players.find((pp) => pp.id === id);
          const z = zodiacOf(p?.zodiac ?? undefined);
          const done = yut.pieces.filter((q) => q.owner === owner && q.done).length;
          const home = yut.pieces.filter((q) => q.owner === owner && q.node === "home").length;
          const cur = yut.turn === id && !over;
          return (
            <span
              key={id}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: cur ? "rgba(224,164,88,.18)" : "rgba(255,255,255,.04)",
                border: `1px solid ${cur ? "#e0a458" : "#2f251f"}`,
                color: "#c9b89f",
              }}
            >
              <span style={{ color: resolvePlayerColor({ color_index: owner, color: null }) }}>●</span> {z.emoji}{" "}
              {p?.nickname ?? "?"} · 완주 {done}/4 · 대기 {home}
              {cur && " ▶"}
            </span>
          );
        })}
      </div>

      {/* 3D 캔버스 */}
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          width: "100%",
          height: "min(66vh, 680px)",
          marginTop: 4,
          borderRadius: 14,
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 28%, #271d31, #100b15)",
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          style={{ width: "100%", height: "100%", display: "block", cursor: isMyTurn && yut.phase === "move" ? "pointer" : "default" }}
        />

        {/* 쌓인 던지기 결과 */}
        {!over && yut.queue.length > 0 && (
          <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
            {yut.queue.map((t, i) => (
              <span key={i} style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(20,14,22,.82)", border: "1px solid #4a3a55", color: "#f0d9a0", fontWeight: 700, fontSize: 14 }}>
                {THROW_LABEL[t.name as keyof typeof THROW_LABEL] ?? t.name}
              </span>
            ))}
          </div>
        )}

        {/* 하단 컨트롤 */}
        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto" }}>
            {over ? null : !isMyTurn ? (
              <div style={{ padding: "10px 18px", borderRadius: 12, background: "rgba(20,14,22,.82)", color: "#c9b89f" }}>
                {turnZ?.emoji} {turnPlayer?.nickname ?? ""} 차례를 기다리는 중…
              </div>
            ) : yut.phase === "throw" ? (
              <button
                className="big primary"
                style={{ fontSize: 18, padding: "12px 28px" }}
                onClick={() => send({ type: "YutThrow" })}
              >
                🎲 윷 던지기
              </button>
            ) : (
              <div style={{ padding: "9px 18px", borderRadius: 12, background: "rgba(20,14,22,.82)", color: "#f0d9a0", fontSize: 14 }}>
                ✨ 이동할 곳(빛나는 칸)을 클릭하세요
              </div>
            )}
          </div>
        </div>
      </div>

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
                <button className="primary big" onClick={() => send({ type: "ReturnToLobby" })}>
                  로비로
                </button>
              )}
              <button className="big" onClick={leave}>나가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
