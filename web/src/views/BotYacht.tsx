import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../state/store";
import {
  CATEGORIES,
  CAT_INDEX,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  applyRoll,
  categoryScore,
  initYacht,
  openCategories,
  roll5,
  scoreCategory,
  toggleKeep,
  totalScore,
  upperSum,
  type Category,
  type YachtState,
} from "../yacht/engine";
import { botBestCategory, botKeep } from "../yacht/bot";
import { YachtScene } from "../yacht/scene/scene";
import { playStone, playResult, playFanfare } from "../bot/sound";
import SoundToggle from "../bot/SoundToggle";
import { useViewportSize } from "../bot/useViewport";
import YachtGuide from "../yacht/YachtGuide";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function BotYacht() {
  const { state: app, setScreen } = useGame();
  const humanFirst = app.bot?.humanFirst ?? true;
  const { w: vw } = useViewportSize();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<YachtScene | null>(null);
  const animatingRef = useRef(false);
  const shakeRef = useRef<{ active: boolean; lastX: number; lastY: number; dist: number }>({ active: false, lastX: 0, lastY: 0, dist: 0 });

  const [st, setSt] = useState<YachtState>(() => {
    const s = initYacht(2);
    return humanFirst ? s : { ...s, turn: 1 };
  });
  const [ready, setReady] = useState(false);

  const isHuman = st.turn === 0 && st.phase !== "over";

  // 씬 생성.
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new YachtScene(canvasRef.current);
    scene.start();
    sceneRef.current = scene;
    setReady(true);
    scene.setDice(st.dice, st.keep);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 한 번 굴림 실행(값은 무작위, 흔들기는 연출). keepBefore=굴리기 전 킵 상태.
  const doRoll = useCallback(
    async (state: YachtState, keepBefore: boolean[]) => {
      const scene = sceneRef.current;
      if (!scene || animatingRef.current || state.rollsLeft <= 0) return;
      const values = roll5();
      const withKeep = { ...state, keep: keepBefore };
      const ns = applyRoll(withKeep, values);
      animatingRef.current = true;
      playStone();
      await scene.throwDice(ns.dice, keepBefore, !state.rolled);
      animatingRef.current = false;
      setSt(ns);
    },
    [],
  );

  // 사람: 컵 흔들기(드래그) → 놓으면 던지기.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isHuman || st.rollsLeft <= 0 || animatingRef.current) return;
      shakeRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, dist: 0 };
    },
    [isHuman, st.rollsLeft],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const sh = shakeRef.current;
    if (!sh.active) return;
    const dx = e.clientX - sh.lastX;
    const dy = e.clientY - sh.lastY;
    const d = Math.hypot(dx, dy);
    sh.dist += d;
    sh.lastX = e.clientX;
    sh.lastY = e.clientY;
    sceneRef.current?.setShake(Math.min(1, d / 22)); // 드래그 속도 → 흔들림 세기
  }, []);
  const onPointerUp = useCallback(() => {
    const sh = shakeRef.current;
    if (!sh.active) return;
    sh.active = false;
    void doRoll(st, st.keep);
  }, [doRoll, st]);

  // 주사위 킵 토글.
  const onToggleKeep = useCallback(
    (i: number) => {
      if (!isHuman || !st.rolled || animatingRef.current) return;
      setSt((s) => {
        const ns = toggleKeep(s, i);
        sceneRef.current?.setDice(ns.dice, ns.keep);
        return ns;
      });
    },
    [isHuman, st.rolled],
  );

  // 점수 기록.
  const onScore = useCallback(
    (cat: Category) => {
      if (!isHuman || !st.rolled || animatingRef.current) return;
      if (st.scores[0][CAT_INDEX[cat]] !== null) return;
      const pts = categoryScore(st.dice, cat);
      if (pts >= 50) playFanfare();
      const ns = scoreCategory(st, cat);
      setSt(ns);
      sceneRef.current?.setDice(ns.dice, ns.keep);
    },
    [isHuman, st],
  );

  // 봇 자동 진행.
  useEffect(() => {
    if (!ready || st.turn !== 1 || st.phase === "over" || animatingRef.current) return;
    let cancelled = false;
    (async () => {
      await delay(500);
      if (cancelled || !sceneRef.current) return;
      if (!st.rolled) {
        // 첫 굴림(자동 흔들기 연출).
        sceneRef.current.setShake(0.9);
        await delay(450);
        if (cancelled) return;
        await doRoll(st, st.keep);
        return;
      }
      if (st.rollsLeft > 0) {
        const keep = botKeep(st.dice);
        sceneRef.current.setShake(0.9);
        await delay(400);
        if (cancelled) return;
        await doRoll(st, keep);
        return;
      }
      // 점수 기록.
      await delay(400);
      if (cancelled) return;
      const cat = botBestCategory(st);
      const ns = scoreCategory(st, cat);
      setSt(ns);
      sceneRef.current.setDice(ns.dice, ns.keep);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, ready, doRoll]);

  // 승패음.
  useEffect(() => {
    if (st.phase === "over" && st.winner !== null) playResult(st.winner === 0);
  }, [st.phase, st.winner]);

  const over = st.phase === "over";
  const myOpen = useMemo(() => new Set(openCategories(st, 0)), [st]);

  function restart() {
    const ns = humanFirst ? initYacht(2) : { ...initYacht(2), turn: 1 };
    animatingRef.current = false;
    setSt(ns);
    sceneRef.current?.setDice(ns.dice, ns.keep);
  }

  const totals = [totalScore(st.scores[0]), totalScore(st.scores[1])];
  const uppers = [upperSum(st.scores[0]), upperSum(st.scores[1])];

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <div className="game-bar card">
        <button className="back" onClick={() => setScreen("home")}>← 나가기</button>
        <div className="turn-info">
          <span className={isHuman ? "turn-me" : ""}>
            {over
              ? "게임 종료"
              : isHuman
                ? st.rolled
                  ? `🎲 내 차례 — 남은 굴림 ${st.rollsLeft} · 킵/점수 선택`
                  : "🥤 내 차례 — 컵을 흔들어 던지세요"
                : "🤖 봇 차례…"}
          </span>
        </div>
        <div className="rule-info">🎲 요트</div>
        <SoundToggle />
      </div>

      <div style={{ display: "flex", gap: 14, height: "min(76vh, 820px)", marginTop: 8, width: `${vw}px`, marginLeft: `calc(50% - ${vw / 2}px)`, boxSizing: "border-box", padding: "0 20px" }}>
        {/* 3D 캔버스 */}
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
            style={{ width: "100%", height: "100%", display: "block", cursor: isHuman && st.rollsLeft > 0 ? "grab" : "default" }}
          />
          {!ready && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#c9b89f" }}>준비 중…</div>
          )}

          {/* 주사위 + 킵 (하단) */}
          {st.rolled && (
            <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10, pointerEvents: "auto" }}>
              {st.dice.map((d, i) => (
                <button
                  key={i}
                  onClick={() => onToggleKeep(i)}
                  disabled={!isHuman}
                  title={isHuman ? "클릭해서 킵/해제" : ""}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 10,
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#222",
                    background: st.keep[i] ? "#ffe08a" : "#f4efe6",
                    border: st.keep[i] ? "3px solid #e0a458" : "2px solid #9a8b76",
                    boxShadow: st.keep[i] ? "0 0 12px rgba(224,164,88,.6)" : "none",
                    cursor: isHuman ? "pointer" : "default",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          {/* 흔들기 안내 */}
          {!over && isHuman && st.rollsLeft > 0 && (
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", pointerEvents: "none", color: "#cfe0f0", fontSize: 14, textShadow: "0 2px 6px #000" }}>
              {st.rolled ? "킵할 주사위를 고르고, 컵을 다시 흔들어 던지세요" : "🥤 마우스로 컵을 잡고 흔든 뒤 놓으세요"}
            </div>
          )}
          {!over && !isHuman && (
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", pointerEvents: "none", color: "#c9b89f", fontSize: 14 }}>🤖 봇이 굴리는 중…</div>
          )}
        </div>

        {/* 점수판 */}
        <aside className="card scl" style={{ width: 340, flexShrink: 0, overflowY: "auto", padding: "10px 12px" }}>
          <div style={{ fontSize: 11.5, color: "#9a8b76", marginBottom: 6, lineHeight: 1.45 }}>
            기록할 칸을 클릭하세요. <span style={{ color: "#7fd18c" }}>+초록 숫자</span>는 지금 기록하면 받는 점수예요.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#a99a86" }}>
                <th style={{ textAlign: "left", padding: "4px 2px" }}>족보</th>
                <th style={cellHead(isHuman && !over)}>나</th>
                <th style={cellHead(!isHuman && !over)}>봇</th>
              </tr>
            </thead>
            <tbody>
              <SectionRow text="▸ 윗칸 · 같은 눈 모으기 (개수×눈)" />
              {CATEGORIES.filter((c) => c.section === "upper").map((c) => {
                const idx = CAT_INDEX[c.key];
                const meVal = st.scores[0][idx];
                const preview = isHuman && st.rolled && meVal === null ? categoryScore(st.dice, c.key) : null;
                const clickable = isHuman && st.rolled && myOpen.has(c.key) && !animatingRef.current;
                return (
                  <CatRow key={c.key} label={c.label} hint={`${c.hint} — ${c.example}`} meVal={meVal} botVal={st.scores[1][idx]} preview={preview} clickable={clickable} onScore={() => onScore(c.key)} highlight={c.key === "yacht"} />
                );
              })}
              <tr style={{ borderTop: "1px dashed #3a3040", color: uppers[0] >= UPPER_BONUS_THRESHOLD ? "#7fd18c" : "#c9a86a" }}>
                <td style={{ padding: "5px 2px", fontSize: 11.5 }} title={`윗칸 합이 ${UPPER_BONUS_THRESHOLD}점 이상이면 +${UPPER_BONUS}점`}>
                  🎁 보너스 {uppers[0] >= UPPER_BONUS_THRESHOLD ? "달성!" : `(${UPPER_BONUS_THRESHOLD}점↑)`}
                </td>
                <td style={{ textAlign: "center", fontSize: 11.5 }}>
                  {uppers[0]}/{UPPER_BONUS_THRESHOLD}{uppers[0] >= UPPER_BONUS_THRESHOLD ? ` +${UPPER_BONUS}` : ""}
                </td>
                <td style={{ textAlign: "center", fontSize: 11.5, color: "#8a9aad" }}>
                  {uppers[1]}/{UPPER_BONUS_THRESHOLD}{uppers[1] >= UPPER_BONUS_THRESHOLD ? ` +${UPPER_BONUS}` : ""}
                </td>
              </tr>
              <SectionRow text="▸ 아랫칸 · 특별한 조합" />
              {CATEGORIES.filter((c) => c.section === "lower").map((c) => {
                const idx = CAT_INDEX[c.key];
                const meVal = st.scores[0][idx];
                const preview = isHuman && st.rolled && meVal === null ? categoryScore(st.dice, c.key) : null;
                const clickable = isHuman && st.rolled && myOpen.has(c.key) && !animatingRef.current;
                return (
                  <CatRow key={c.key} label={c.label} hint={`${c.hint} — ${c.example}`} meVal={meVal} botVal={st.scores[1][idx]} preview={preview} clickable={clickable} onScore={() => onScore(c.key)} highlight={c.key === "yacht"} />
                );
              })}
              <tr style={{ borderTop: "2px solid #3a3040", fontWeight: 800 }}>
                <td style={{ padding: "7px 2px", color: "#f0d9a0" }}>합계</td>
                <td style={{ textAlign: "center", color: "#f0d9a0", fontSize: 15 }}>{totals[0]}</td>
                <td style={{ textAlign: "center", color: "#a9c0d8", fontSize: 15 }}>{totals[1]}</td>
              </tr>
            </tbody>
          </table>
          <YachtGuide />
        </aside>
      </div>

      {over && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>{st.winner === 0 ? "🏆 승리!" : "🤖 패배"}</h2>
            <p>최종 점수 — 나 <b>{totals[0]}</b> · 봇 <b>{totals[1]}</b></p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button className="primary big" onClick={restart}>다시하기</button>
              <button className="big" onClick={() => setScreen("home")}>홈으로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function cellHead(active: boolean): React.CSSProperties {
  return { textAlign: "center", padding: "4px 2px", color: active ? "#f0d9a0" : "#a99a86" };
}

// 구역 구분 헤더 행.
function SectionRow({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={3} style={{ padding: "7px 2px 3px", color: "#c9a86a", fontSize: 11.5, fontWeight: 700 }}>{text}</td>
    </tr>
  );
}

// 족보 한 줄(나/봇). preview는 내 차례에 기록 시 받을 점수.
function CatRow(props: {
  label: string;
  hint: string;
  meVal: number | null;
  botVal: number | null;
  preview: number | null;
  clickable: boolean;
  onScore: () => void;
  highlight?: boolean;
}) {
  const { label, hint, meVal, botVal, preview, clickable, onScore, highlight } = props;
  return (
    <tr style={{ borderTop: "1px solid #2a2230" }}>
      <td style={{ padding: "5px 2px", color: highlight ? "#f0c674" : "#d8c9b4", fontWeight: highlight ? 700 : 400 }} title={hint}>
        {label}
      </td>
      <td
        onClick={clickable ? onScore : undefined}
        title={clickable ? "여기에 기록하기" : undefined}
        style={{
          textAlign: "center",
          padding: "5px 2px",
          cursor: clickable ? "pointer" : "default",
          color: meVal !== null ? "#f0d9a0" : preview !== null ? "#7fd18c" : "#5a4f44",
          background: clickable ? "rgba(127,209,140,.10)" : "transparent",
          fontWeight: meVal !== null ? 700 : 400,
          borderRadius: 4,
          outline: clickable ? "1px solid rgba(127,209,140,.3)" : "none",
        }}
      >
        {meVal !== null ? meVal : preview !== null ? `+${preview}` : "·"}
      </td>
      <td style={{ textAlign: "center", padding: "5px 2px", color: botVal !== null ? "#a9c0d8" : "#5a4f44", fontWeight: botVal !== null ? 700 : 400 }}>
        {botVal !== null ? botVal : "·"}
      </td>
    </tr>
  );
}
