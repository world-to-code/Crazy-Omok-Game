import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import {
  checkersAi,
  checkersApply,
  checkersPieceMoves,
  checkersStart,
  checkersState,
  ensureAiWasm,
  terminateAiWorker,
  type CheckersApplyT,
  type CheckersMoveT,
  type CheckersStateT,
  type Level,
} from "../net/aiWasm";
import { CHESS_FILES } from "../types";
import { useViewportSize } from "../bot/useViewport";
import { playMove, playCapture, playWin, playLose, playDraw } from "../bot/sound";
import SoundToggle from "../bot/SoundToggle";
import Countdown from "../components/Countdown";

const LEVEL_NAME = ["쉬움", "중간", "어려움", "헬"];
const TURN_MS = 45_000;
const sq = (r: number, c: number) => `${CHESS_FILES[c]}${8 - r}`;

interface MoveRec {
  n: number;
  color: "b" | "w";
  from: [number, number];
  to: [number, number];
  caps: number;
  promoted: boolean;
}

export default function BotCheckers() {
  const { state, setScreen } = useGame();
  const cfg = state.bot!;
  const level = cfg.level as Level;
  const humanColor: "b" | "w" = cfg.humanFirst ? "b" : "w"; // 흑(P1) 선공
  const botColor: "b" | "w" = humanColor === "b" ? "w" : "b";
  const flip = humanColor === "w";

  const [pos, setPos] = useState<string | null>(null);
  const [st, setSt] = useState<CheckersStateT | null>(null);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [options, setOptions] = useState<CheckersMoveT[]>([]);
  const [lastPath, setLastPath] = useState<[number, number][]>([]);
  const [moves, setMoves] = useState<MoveRec[]>([]);
  const [thinking, setThinking] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const botBusy = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureAiWasm().then(() => {
      const p = checkersStart();
      setPos(p);
      setSt(checkersState(p));
    });
  }, []);

  useEffect(() => () => terminateAiWorker(), []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [moves.length]);

  const commit = useCallback(
    (res: CheckersApplyT) => {
      setPos(res.pos);
      setSt(res.state);
      setLastPath(res.path);
      setMoves((m) => [
        ...m,
        { n: m.length + 1, color: res.path.length ? (res.state.turn === "b" ? "w" : "b") : "b", from: res.from, to: res.to, caps: res.caps.length, promoted: res.promoted },
      ]);
      setSelected(null);
      setOptions([]);
      // 사운드.
      if (res.state.status === "win") playResultFor(res, humanColor);
      else if (res.state.status === "draw") playDraw();
      else if (res.caps.length > 0) playCapture();
      else playMove();
    },
    [humanColor],
  );

  // 봇 차례 자동 착수.
  useEffect(() => {
    if (!pos || !st || st.status !== "playing" || st.turn !== botColor || botBusy.current) return;
    botBusy.current = true;
    setThinking(true);
    const cur = pos;
    checkersAi(cur, level).then((res) => {
      botBusy.current = false;
      setThinking(false);
      if (res.ok) commit(res);
    });
  }, [pos, st, botColor, level, commit]);

  // 사람 차례 카운트다운.
  useEffect(() => {
    if (st && st.status === "playing" && st.turn === humanColor) setDeadline(Date.now() + TURN_MS);
    else setDeadline(null);
  }, [st, humanColor]);

  const { w: vw, h: vh } = useViewportSize();
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    const update = () => {
      const top = boardWrapRef.current?.getBoundingClientRect().top ?? 150;
      setAvailH(document.documentElement.clientHeight - top - 66);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [vw, vh, pos]);

  if (!st || !pos) {
    return (
      <div className="game">
        <div style={{ textAlign: "center", paddingTop: 120, color: "#a99a86" }}>봇 엔진 준비 중…</div>
      </div>
    );
  }

  const humanTurn = st.status === "playing" && st.turn === humanColor && !thinking;
  const moverSet = new Set(st.movers.map(([r, c]) => `${r},${c}`));
  const optionMap = new Map(options.map((o) => [`${o.to[0]},${o.to[1]}`, o]));
  const selKey = selected ? `${selected[0]},${selected[1]}` : null;
  const lastSet = new Set(lastPath.map(([r, c]) => `${r},${c}`));

  function clickCell(r: number, c: number) {
    if (!humanTurn) return;
    const k = `${r},${c}`;
    if (selected && optionMap.has(k)) {
      const res = checkersApply(pos!, selected[0], selected[1], r, c);
      if (res.ok) commit(res);
      return;
    }
    if (moverSet.has(k)) {
      setSelected([r, c]);
      setOptions(checkersPieceMoves(pos!, r, c));
    } else {
      setSelected(null);
      setOptions([]);
    }
  }

  function restart() {
    botBusy.current = false;
    const p = checkersStart();
    setPos(p);
    setSt(checkersState(p));
    setSelected(null);
    setOptions([]);
    setLastPath([]);
    setMoves([]);
    setThinking(false);
  }

  const avail = (availH > 0 ? availH : vh - 160) - 40;
  const boardSize = Math.max(240, Math.min(Math.round(vw * 0.7), Math.round(avail)));
  const gap = (vw - boardSize) / 2;
  const showLog = gap >= 210;
  const last = moves[moves.length - 1];

  const cells = [];
  for (let dr = 0; dr < 8; dr++) {
    for (let df = 0; df < 8; df++) {
      const r = flip ? 7 - dr : dr;
      const c = flip ? 7 - df : df;
      const k = `${r},${c}`;
      const dark = (r + c) % 2 === 1;
      const v = st.board[r]?.[c] ?? 0;
      const opt = optionMap.get(k);
      const isOpt = !!opt;
      const isCapOpt = isOpt && opt!.caps.length > 0;
      const isSel = selKey === k;
      const isLast = lastSet.has(k);
      const selectable = humanTurn && (moverSet.has(k) || isOpt);
      let shadow = "";
      if (isLast) shadow += "inset 0 0 0 4px rgba(224,164,88,.5);";
      if (isSel) shadow += "inset 0 0 0 4px #f0b96b;";
      if (isCapOpt) shadow += "inset 0 0 0 3px rgba(239,68,68,.85);";
      else if (isOpt) shadow += "inset 0 0 0 3px rgba(155,224,164,.6);";
      const isBlack = v === 1 || v === 3;
      const isKing = v >= 3;
      cells.push(
        <div
          key={k}
          onClick={selectable ? () => clickCell(r, c) : undefined}
          style={{
            position: "relative",
            aspectRatio: "1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: dark ? "#7a4a28" : "#e9d3a8",
            boxShadow: shadow || undefined,
            cursor: selectable ? "pointer" : "default",
          }}
        >
          {df === 0 && (
            <span style={{ position: "absolute", top: 1, left: 3, fontSize: "2.6cqw", fontWeight: 700, color: dark ? "rgba(250,240,220,.8)" : "rgba(90,60,30,.75)", pointerEvents: "none", fontFamily: "monospace" }}>{8 - r}</span>
          )}
          {dr === 7 && (
            <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: "2.6cqw", fontWeight: 700, color: dark ? "rgba(250,240,220,.8)" : "rgba(90,60,30,.75)", pointerEvents: "none", fontFamily: "monospace" }}>{CHESS_FILES[c]}</span>
          )}
          {v !== 0 && (
            <span
              style={{
                width: "72%",
                height: "72%",
                borderRadius: "50%",
                background: isBlack
                  ? "radial-gradient(circle at 35% 30%, #4a4a4a, #141414 70%)"
                  : "radial-gradient(circle at 35% 30%, #ffffff, #d9cdb5 75%)",
                border: isBlack ? "1px solid #000" : "1px solid #b3a588",
                boxShadow: "0 3px 6px rgba(0,0,0,.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <span style={{ position: "absolute", inset: "18%", borderRadius: "50%", border: `2px solid ${isBlack ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)"}` }} />
              {isKing && (
                <span style={{ fontSize: "7cqw", lineHeight: 1, color: "#ffd24a", filter: "drop-shadow(0 1px 1px rgba(0,0,0,.5))", zIndex: 1 }}>♛</span>
              )}
            </span>
          )}
          {isOpt && v === 0 && (
            <span style={{ width: "26%", height: "26%", borderRadius: "50%", background: isCapOpt ? "rgba(239,68,68,.7)" : "rgba(155,224,164,.75)", zIndex: 1 }} />
          )}
        </div>,
      );
    }
  }

  const turnText =
    st.status !== "playing" ? "게임 종료" : thinking ? "🤖 봇이 생각 중…" : humanTurn ? "내 차례" : "봇 차례";
  const over = st.status !== "playing";
  const humanWon = st.winner === humanColor;

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <div className="game-bar card">
        <button className="back" onClick={() => setScreen("home")}>← 나가기</button>
        <div className="turn-info">
          <span className={humanTurn ? "turn-me" : ""}>
            <span className="color-dot" style={{ background: st.turn === "b" ? "#141414" : "#f0ead8", border: "1px solid #888" }} />
            {turnText}
            {st.status === "playing" && st.mustCapture && (
              <span style={{ color: "#ff7043", marginLeft: 8, fontWeight: 700 }}>강제 점프!</span>
            )}
          </span>
        </div>
        <Countdown deadlineMs={deadline} />
        <div className="rule-info">🤖 {LEVEL_NAME[level]} · 강제잡기</div>
        <SoundToggle />
      </div>

      <div
        ref={boardWrapRef}
        style={{ width: `${vw}px`, marginLeft: `calc(50% - ${vw / 2}px)`, marginTop: 12, position: "relative", display: "flex", justifyContent: "center" }}
      >
        {showLog && (
          <aside style={{ position: "absolute", right: 16, top: 0, width: 244, maxHeight: boardSize, display: "flex", flexDirection: "column", background: "#1c1512", border: "1px solid #2f251f", borderRadius: 14 }}>
            <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid #2f251f", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, letterSpacing: ".15em", color: "#8a7c6c", fontFamily: "monospace" }}>기보</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e0a458" }}>총 {moves.length}수</span>
            </div>
            <div ref={logRef} className="scl" style={{ overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
              {moves.length === 0 && <div style={{ color: "#6b5d4f", fontSize: 12, padding: 8 }}>아직 둔 수가 없습니다</div>}
              {moves.map((m) => (
                <div key={m.n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 6, fontSize: 12.5, background: m.n === moves.length ? "rgba(224,164,88,.14)" : "transparent" }}>
                  <span style={{ width: 22, textAlign: "right", color: "#6b5d4f", fontFamily: "monospace" }}>{m.n}</span>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: m.color === "b" ? "#141414" : "#f0ead8", border: "1px solid #6b574a", flexShrink: 0 }} />
                  <span style={{ fontFamily: "monospace", color: "#e0a458", fontWeight: 700 }}>
                    {sq(...m.from)}
                    <span style={{ color: m.caps ? "#fb7185" : "#8a7c6c" }}>{m.caps ? "×" : "→"}</span>
                    {sq(...m.to)}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    {m.caps > 0 && <span style={{ color: "#fb7185", fontWeight: 700 }}>{m.caps}잡</span>}
                    {m.promoted && <span style={{ color: "#ffd24a" }}>♛</span>}
                  </span>
                </div>
              ))}
            </div>
          </aside>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8,1fr)",
              width: `${boardSize}px`,
              containerType: "inline-size",
              borderRadius: 8,
              overflow: "hidden",
              boxShadow: "0 24px 60px rgba(0,0,0,.5)",
              border: "6px solid #3a2a1d",
            } as React.CSSProperties}
          >
            {cells}
          </div>
          <div style={{ marginTop: 8, fontSize: 14, color: "#c9b89f", display: "flex", alignItems: "center", gap: 8, minHeight: 22 }}>
            {last ? (
              <>
                <span style={{ color: "#8a7c6c" }}>마지막 수:</span>
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: last.color === "b" ? "#141414" : "#f0ead8", border: "1px solid #888", display: "inline-block" }} />
                <span style={{ fontFamily: "monospace", color: "#e0a458", fontWeight: 700 }}>{sq(...last.from)}→{sq(...last.to)}</span>
                {last.caps > 0 && <span style={{ color: "#fb7185" }}>· {last.caps}개 잡음</span>}
                {last.promoted && <span style={{ color: "#ffd24a" }}>· 킹 승급 ♛</span>}
              </>
            ) : (
              <span style={{ color: "#6b5d4f" }}>내 말을 클릭해 두세요</span>
            )}
          </div>
        </div>
      </div>

      {over && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>{st.status === "draw" ? "⚖️ 무승부" : "🏆 게임 종료"}</h2>
            {st.status === "draw" ? (
              <p>무승부입니다. (완벽 플레이 시 체커는 무승부 — 비긴 것도 훌륭!)</p>
            ) : humanWon ? (
              <p>🎉 <b>당신</b>이 이겼습니다!</p>
            ) : (
              <p>🤖 <b>봇({LEVEL_NAME[level]})</b> 승리. 다시 도전해보세요!</p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button className="primary big" onClick={restart}>다시하기</button>
              <button className="big" onClick={() => setScreen("botSetup")}>난이도 변경</button>
              <button className="big" onClick={() => setScreen("home")}>홈으로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 승/패 사운드: 이번 수로 이긴 쪽(=둔 쪽)이 사람인지로 판정.
function playResultFor(res: CheckersApplyT, humanColor: "b" | "w") {
  // 둔 쪽 = res.state.turn 의 반대(턴이 넘어갔으므로).
  const mover = res.state.turn === "b" ? "w" : "b";
  if (mover === humanColor) playWin();
  else playLose();
}
