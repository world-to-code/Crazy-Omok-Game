import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../state/store";
import type { Level } from "../net/aiWasm";
import { HOME, type NodeId } from "../yut/board";
import {
  applyMove,
  applyThrow,
  describeMove,
  discardUnplayable,
  initState,
  legalTargets,
  rollThrow,
  type MoveTarget,
} from "../yut/engine";
import { botChooseMove, botThrow } from "../yut/bot";
import { THROW_LABEL, type ThrowResult, type YutState } from "../yut/types";
import { botZodiac, zodiacOf } from "../yut/zodiac";
import { YutScene } from "../yut/scene/scene";
import { playCapture, playStone, playResult, playFanfare } from "../bot/sound";
import SoundToggle from "../bot/SoundToggle";
import { useViewportSize } from "../bot/useViewport";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const groupKeyOf = (node: NodeId): NodeId => (node === HOME ? HOME : node);

export default function BotYut() {
  const { state: app, setScreen } = useGame();
  const cfg = app.bot!;
  const level = cfg.level as Level;
  const humanFirst = cfg.humanFirst;
  const humanZ = useMemo(() => zodiacOf(cfg.zodiac), [cfg.zodiac]);
  const botZ = useMemo(() => botZodiac(humanZ.id), [humanZ.id]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<YutScene | null>(null);
  const animatingRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const [st, setSt] = useState<YutState>(() => initState(humanFirst));
  const [ready, setReady] = useState(false);
  const [selPiece, setSelPiece] = useState<number | null>(null);
  const [announce, setAnnounce] = useState<ThrowResult | null>(null);
  const { w: vw } = useViewportSize();

  const isHuman = st.turn === 0;

  // 씬 생성 + 모델 사전 로드 + 정리.
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new YutScene(canvasRef.current);
    scene.setPlayers([humanZ, botZ]);
    scene.start();
    sceneRef.current = scene;
    let alive = true;
    scene.preload([humanZ.model, botZ.model]).then(() => {
      if (!alive) return;
      scene.syncPieces(initState(humanFirst).pieces);
      setReady(true);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 적용 불가 결과 자동 정리.
  useEffect(() => {
    if (st.phase !== "move") return;
    const pruned = discardUnplayable(st);
    if (pruned !== st) setSt(pruned);
  }, [st]);

  // 로그 자동 스크롤.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [st.log.length]);

  // 윷 결과 대형 연출(던질 때마다). 윷·모면 팡파르.
  useEffect(() => {
    if (!st.lastThrow) return;
    setAnnounce(st.lastThrow);
    if (st.lastThrow.bonus) playFanfare();
    const id = setTimeout(() => setAnnounce(null), 1300);
    return () => clearTimeout(id);
  }, [st.lastThrow]);

  // 움직일 수 있는 말 그룹 키 + 선택 가능한 내 말 id.
  const moveKeys = useMemo(() => {
    const keys = new Set<NodeId>();
    if (isHuman && st.phase === "move") {
      for (const t of st.queue) for (const tg of legalTargets(st, t)) keys.add(tg.key);
    }
    return keys;
  }, [isHuman, st]);

  const selectableIds = useMemo(
    () => st.pieces.filter((p) => p.owner === 0 && !p.done && moveKeys.has(groupKeyOf(p.node))).map((p) => p.id),
    [st.pieces, moveKeys],
  );

  // 선택된 말(그룹)의 이동 선택지(던지기 × 경로).
  const selOptions = useMemo(() => {
    const out: { throwIndex: number; target: MoveTarget }[] = [];
    if (selPiece == null || !(isHuman && st.phase === "move")) return out;
    const sel = st.pieces.find((p) => p.id === selPiece);
    if (!sel) return out;
    const gk = groupKeyOf(sel.node);
    st.queue.forEach((t, i) => {
      for (const tg of legalTargets(st, t)) if (tg.key === gk) out.push({ throwIndex: i, target: tg });
    });
    return out;
  }, [selPiece, isHuman, st]);

  // 선택 가능한 말 위에 화살표 표시.
  useEffect(() => {
    if (ready) sceneRef.current?.setSelectable(isHuman && st.phase === "move" ? selectableIds : []);
  }, [ready, isHuman, st.phase, selectableIds]);

  // 선택된 말 강조 + 그 말의 이동 가능 지점 마커(말을 바꿀 때마다 갱신).
  useEffect(() => {
    if (!ready) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const selecting = selPiece != null && isHuman && st.phase === "move";
    scene.setSelected(selecting ? selPiece : null);
    if (selecting && selOptions.length && !animatingRef.current) {
      scene.showMoves(
        selOptions.map((o) => ({
          to: o.target.to,
          label: THROW_LABEL[st.queue[o.throwIndex].name],
          kind: o.target.finishes ? "finish" : o.target.captures ? "capture" : "move",
          throwIndex: o.throwIndex,
          key: o.target.key,
          route: o.target.route,
        })),
      );
    } else {
      scene.clearMoves();
    }
  }, [ready, selPiece, selOptions, isHuman, st]);

  // 내 차례·이동 단계가 아니면 선택 해제.
  useEffect(() => {
    if (!(isHuman && st.phase === "move")) setSelPiece(null);
  }, [isHuman, st.phase]);

  // 이동 실행(사람·봇 공통): 경로 워킹 → (잡으면)처치 → 상태 커밋 → 정확 배치.
  const performMove = useCallback(
    async (throwIndex: number, targetKey: NodeId, route: MoveTarget["route"]) => {
      const scene = sceneRef.current;
      if (!scene || animatingRef.current) return;
      const detail = describeMove(st, throwIndex, targetKey, route);
      const ns = applyMove(st, throwIndex, targetKey, route);
      animatingRef.current = true;
      setSelPiece(null);
      scene.setSelected(null);
      scene.clearMoves();
      if (detail) {
        await scene.walkMovers(detail, ns.pieces);
        if (detail.capturedIds.length) {
          playCapture();
          await scene.killAndReturn(detail.capturedIds, ns.pieces);
        }
      }
      setSt(ns);
      scene.syncPieces(ns.pieces);
      animatingRef.current = false;
    },
    [st],
  );

  // 봇 자동 진행.
  useEffect(() => {
    if (!ready || st.turn === 0 || st.phase === "over") return;
    let cancelled = false;
    (async () => {
      await delay(550);
      if (cancelled || !sceneRef.current) return;
      if (st.phase === "throw") {
        const roll = botThrow();
        animatingRef.current = true;
        playStone();
        await sceneRef.current.throwYut(roll);
        animatingRef.current = false;
        if (cancelled) return;
        setSt((s) => applyThrow(s, roll));
      } else if (st.phase === "move") {
        const choice = botChooseMove(st, level);
        if (!choice) {
          setSt((s) => discardUnplayable(s));
          return;
        }
        await delay(350);
        if (cancelled) return;
        await performMove(choice.throwIndex, choice.targetKey, choice.route);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, level, ready]);

  // 승패 효과음.
  useEffect(() => {
    if (st.phase === "over" && st.winner !== null) playResult(st.winner === 0);
  }, [st.phase, st.winner]);

  // 사람: 윷 던지기.
  const humanThrow = useCallback(async () => {
    if (animatingRef.current || !sceneRef.current || st.turn !== 0 || st.phase !== "throw") return;
    const roll = rollThrow();
    animatingRef.current = true;
    playStone();
    await sceneRef.current.throwYut(roll);
    animatingRef.current = false;
    setSt((s) => applyThrow(s, roll));
  }, [st.turn, st.phase]);

  // 캔버스 클릭: 말이 선택돼 있으면 도착 마커 클릭 시 이동, 아니면 말 선택(다른 말 클릭 시 갱신).
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const scene = sceneRef.current;
      if (!scene || animatingRef.current || !isHuman || st.phase !== "move") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      // 1) 도착 지점 마커 클릭이면(보이는 마커 그대로) 즉시 이동.
      const mv = scene.pickMove(nx, ny);
      if (mv) {
        void performMove(mv.throwIndex, mv.key, mv.route);
        return;
      }
      // 2) 말 선택/변경.
      const id = scene.pickPiece(nx, ny);
      if (id == null) {
        setSelPiece(null);
        return;
      }
      const p = st.pieces.find((x) => x.id === id);
      if (p && p.owner === 0 && moveKeys.has(groupKeyOf(p.node))) setSelPiece(id);
    },
    [isHuman, st, moveKeys, performMove],
  );

  const over = st.phase === "over";
  const counts = (owner: 0 | 1) => ({
    done: st.pieces.filter((p) => p.owner === owner && p.done).length,
    home: st.pieces.filter((p) => p.owner === owner && p.node === HOME).length,
    board: st.pieces.filter((p) => p.owner === owner && !p.done && p.node !== HOME).length,
  });
  const me = counts(0);
  const bot = counts(1);

  const CONFETTI = ["🎉", "🎊", "✨", "⭐", "🏆", "🪅"];

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <style>{`
        @keyframes yut-pop { 0% { transform: scale(.4); opacity: 0; } 18% { transform: scale(1.12); opacity: 1; } 78% { transform: scale(1); opacity: 1; } 100% { transform: scale(.92); opacity: 0; } }
        @keyframes yut-conf { 0% { transform: translateY(-10vh) rotate(0); opacity: 1; } 100% { transform: translateY(85vh) rotate(540deg); opacity: .9; } }
      `}</style>
      <div className="game-bar card">
        <button className="back" onClick={() => setScreen("home")}>
          ← 나가기
        </button>
        <div className="turn-info">
          <span className={isHuman ? "turn-me" : ""}>
            {over
              ? "게임 종료"
              : isHuman
                ? st.phase === "throw"
                  ? `${humanZ.emoji} 내 차례 — 윷을 던지세요`
                  : `${humanZ.emoji} 내 차례 — 이동할 곳을 클릭하세요`
                : `${botZ.emoji} 봇 차례…`}
          </span>
        </div>
        <div className="rule-info">🤖 봇 {botZ.emoji}</div>
        <SoundToggle />
      </div>

      {/* 메인: 좌 3D 캔버스(크게) + 우 사이드(현황·기보). 풀블리드(뷰포트 전체 폭). */}
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
            onPointerDown={onCanvasPointerDown}
            style={{ width: "100%", height: "100%", display: "block", cursor: selectableIds.length || selOptions.length ? "pointer" : "default" }}
          />
          {!ready && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#c9b89f", fontSize: 16 }}>
              🐯 캐릭터 불러오는 중…
            </div>
          )}

          {/* 윷 결과 대형 연출 */}
          {announce && (
            <div
              key={st.log.length}
              style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
            >
              <div style={{ animation: "yut-pop 1.3s ease-out forwards", textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "clamp(64px, 12vw, 150px)",
                    fontWeight: 900,
                    color: announce.bonus ? "#ffd24a" : "#f5ead0",
                    textShadow: "0 6px 26px rgba(0,0,0,.75)",
                    lineHeight: 1,
                  }}
                >
                  {THROW_LABEL[announce.name]}
                </div>
                <div style={{ fontSize: "clamp(16px,2.4vw,26px)", fontWeight: 800, color: announce.bonus ? "#ffd24a" : "#c9b89f", marginTop: 4 }}>
                  {announce.steps > 0 ? `${announce.steps}칸 전진` : "한 칸 뒤로"}
                  {announce.bonus && " · 한 번 더! 🎉"}
                </div>
              </div>
            </div>
          )}

          {/* 쌓인 던지기 결과(상단) */}
          {!over && st.queue.length > 0 && (
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
              {st.queue.map((t, i) => (
                <span key={i} style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(20,14,22,.82)", border: "1px solid #4a3a55", color: "#f0d9a0", fontWeight: 700, fontSize: 14 }}>
                  {THROW_LABEL[t.name]}
                </span>
              ))}
            </div>
          )}

          {/* 하단 컨트롤 */}
          <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ pointerEvents: "auto" }}>
              {!ready ? null : over ? null : !isHuman ? (
                <div style={{ padding: "10px 18px", borderRadius: 12, background: "rgba(20,14,22,.82)", color: "#c9b89f" }}>
                  {botZ.emoji} 봇이 두는 중…
                </div>
              ) : st.phase === "throw" ? (
                <button className="big primary" onClick={humanThrow} style={{ fontSize: 18, padding: "12px 28px" }}>
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
            <ScoreRow emoji={humanZ.emoji} name={`나 (${humanZ.name})`} c={me} hi={isHuman && !over} />
            <div style={{ height: 8 }} />
            <ScoreRow emoji={botZ.emoji} name={`봇 (${botZ.name})`} c={bot} hi={!isHuman && !over} />
          </div>
          <div className="card" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "10px 0 6px" }}>
            <div style={{ ...labelHead, padding: "0 14px 8px" }}>기보</div>
            <div ref={logRef} className="scl" style={{ flex: 1, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              {st.log.length === 0 && <div style={{ fontSize: 12.5, color: "#6b5d4f" }}>윷을 던져 시작하세요!</div>}
              {st.log.map((l, i) => (
                <div key={i} style={{ fontSize: 12.5, color: l.startsWith("나") ? "#e0c089" : "#a9c0d8", padding: "1px 0", lineHeight: 1.4 }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {over && st.winner === 0 && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 50 }}>
          {Array.from({ length: 36 }).map((_, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                left: `${(i * 2.718) % 100}%`,
                top: "-8vh",
                fontSize: `${18 + (i % 4) * 8}px`,
                animation: `yut-conf ${2.4 + (i % 5) * 0.4}s linear ${(i % 7) * 0.18}s infinite`,
              }}
            >
              {CONFETTI[i % CONFETTI.length]}
            </span>
          ))}
        </div>
      )}

      {over && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>{st.winner === 0 ? "🏆 승리!" : "🤖 패배"}</h2>
            <p>
              {st.winner === 0
                ? `${humanZ.emoji} ${humanZ.name} 팀이 말 4개를 모두 완주시켰습니다!`
                : `${botZ.emoji} 봇(${botZ.name})이 먼저 완주했습니다. 다시 도전!`}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button
                className="primary big"
                onClick={() => {
                  const ns = initState(humanFirst);
                  setSt(ns);
                  setSelPiece(null);
                  animatingRef.current = false;
                  sceneRef.current?.setSelected(null);
                  sceneRef.current?.clearMoves();
                  sceneRef.current?.syncPieces(ns.pieces);
                }}
              >
                다시하기
              </button>
              <button className="big" onClick={() => setScreen("botSetup")}>
                설정 변경
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

function ScoreRow({ emoji, name, c, hi }: { emoji: string; name: string; c: { done: number; home: number; board: number }; hi: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: hi ? 1 : 0.7 }}>
      <span style={{ fontSize: 22 }}>{emoji}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: hi ? "#f0d9a0" : "#c9b89f" }}>
          {name} {hi && "▶"}
        </div>
        <div style={{ fontSize: 11.5, color: "#a99a86", fontFamily: "monospace" }}>
          완주 {c.done}/4 · 판 {c.board} · 대기 {c.home}
        </div>
      </div>
    </div>
  );
}

const labelHead: React.CSSProperties = { fontSize: 11, letterSpacing: ".15em", color: "#8a7c6c", fontFamily: "monospace", textTransform: "uppercase" };
