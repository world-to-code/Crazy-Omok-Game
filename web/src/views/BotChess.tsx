import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import {
  chessAi,
  chessApply,
  chessMovesFrom,
  chessStart,
  chessState,
  ensureAiWasm,
  type ChessStateT,
  type Level,
} from "../net/aiWasm";
import { CHESS_GLYPH } from "../types";
import Countdown from "../components/Countdown";

const LEVEL_NAME = ["쉬움", "중간", "어려움", "헬"];
const TURN_MS = 45_000;

export default function BotChess() {
  const { state, setScreen } = useGame();
  const cfg = state.bot!;
  const level = cfg.level as Level;
  const humanColor: "w" | "b" = cfg.humanFirst ? "w" : "b";
  const botColor: "w" | "b" = humanColor === "w" ? "b" : "w";
  const flip = humanColor === "b";

  const [fen, setFen] = useState<string | null>(null);
  const [st, setSt] = useState<ChessStateT | null>(null);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [options, setOptions] = useState<[number, number][]>([]);
  const [lastMove, setLastMove] = useState<[[number, number], [number, number]] | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const botBusy = useRef(false);

  // 초기화.
  useEffect(() => {
    ensureAiWasm().then(() => {
      const f = chessStart();
      setFen(f);
      setSt(chessState(f));
    });
  }, []);

  const commit = useCallback(
    (newFen: string, newState: ChessStateT, san: string, from: [number, number], to: [number, number]) => {
      setFen(newFen);
      setSt(newState);
      setHistory((h) => [...h, san]);
      setLastMove([from, to]);
      setSelected(null);
      setOptions([]);
    },
    [],
  );

  // 봇 차례 자동 착수.
  useEffect(() => {
    if (!fen || !st || st.status !== "playing" || st.turn !== botColor || botBusy.current) return;
    botBusy.current = true;
    setThinking(true);
    const curFen = fen;
    chessAi(curFen, level).then((res) => {
      botBusy.current = false;
      setThinking(false);
      if (res.ok) commit(res.fen, res.state, res.san, res.from, res.to);
    });
  }, [fen, st, botColor, level, commit]);

  // 사람 차례 카운트다운(표시용).
  useEffect(() => {
    if (st && st.status === "playing" && st.turn === humanColor) setDeadline(Date.now() + TURN_MS);
    else setDeadline(null);
  }, [st, humanColor]);

  if (!st || !fen) {
    return (
      <div className="game">
        <div style={{ textAlign: "center", paddingTop: 120, color: "#a99a86" }}>봇 엔진 준비 중…</div>
      </div>
    );
  }

  const humanTurn = st.status === "playing" && st.turn === humanColor && !thinking;
  const pieceSet = new Set(st.pieces.map(([r, f]) => `${r},${f}`));
  const optionSet = new Set(options.map(([r, f]) => `${r},${f}`));
  const selKey = selected ? `${selected[0]},${selected[1]}` : null;

  function clickCell(r: number, f: number) {
    if (!humanTurn) return;
    const k = `${r},${f}`;
    if (selected && optionSet.has(k)) {
      const res = chessApply(fen!, selected[0], selected[1], r, f);
      if (res.ok) commit(res.fen, res.state, res.san, res.from, res.to);
      return;
    }
    if (pieceSet.has(k)) {
      setSelected([r, f]);
      setOptions(chessMovesFrom(fen!, r, f));
    } else {
      setSelected(null);
      setOptions([]);
    }
  }

  function restart() {
    botBusy.current = false;
    const f = chessStart();
    setFen(f);
    setSt(chessState(f));
    setSelected(null);
    setOptions([]);
    setLastMove(null);
    setHistory([]);
    setThinking(false);
  }

  const cells = [];
  for (let dr = 0; dr < 8; dr++) {
    for (let df = 0; df < 8; df++) {
      const r = flip ? 7 - dr : dr;
      const f = flip ? 7 - df : df;
      const k = `${r},${f}`;
      const piece = st.board[r]?.[f] ?? null;
      const isLight = (r + f) % 2 === 0;
      const isOpt = optionSet.has(k);
      const isSel = selKey === k;
      const isLast = !!lastMove && ((lastMove[0][0] === r && lastMove[0][1] === f) || (lastMove[1][0] === r && lastMove[1][1] === f));
      const selectable = humanTurn && (pieceSet.has(k) || isOpt);
      let shadow = "";
      if (isLast) shadow += "inset 0 0 0 4px rgba(224,164,88,.28);";
      if (isSel) shadow += "inset 0 0 0 4px #f0b96b;";
      if (isOpt) shadow += "inset 0 0 0 3px rgba(155,224,164,.55);";
      cells.push(
        <div
          key={k}
          onClick={selectable ? () => clickCell(r, f) : undefined}
          style={{
            position: "relative",
            aspectRatio: "1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isLight ? "#e9d3a8" : "#b07f50",
            boxShadow: shadow || undefined,
            cursor: selectable ? "pointer" : "default",
          }}
        >
          {piece && (
            <span
              style={{
                fontSize: "8.2cqw",
                lineHeight: 1,
                color: piece.c === "w" ? "#faf4e6" : "#241b15",
                WebkitTextStroke: piece.c === "w" ? "1.1px #6b4a2e" : "1.1px #c9b89f",
                filter: "drop-shadow(0 2px 2px rgba(0,0,0,.35))",
              }}
            >
              {CHESS_GLYPH[piece.t]}
            </span>
          )}
          {isOpt && !piece && (
            <span style={{ width: "26%", height: "26%", borderRadius: "50%", background: "rgba(155,224,164,.7)" }} />
          )}
        </div>,
      );
    }
  }

  const turnText =
    st.status !== "playing"
      ? "게임 종료"
      : thinking
        ? "🤖 봇이 생각 중…"
        : humanTurn
          ? "내 차례"
          : "봇 차례";

  const over = st.status !== "playing";
  const humanWon = st.winner === humanColor;

  return (
    <div className="game">
      <div className="game-bar card">
        <button className="back" onClick={() => setScreen("home")}>
          ← 나가기
        </button>
        <div className="turn-info">
          <span className={humanTurn ? "turn-me" : ""}>
            <span className="color-dot" style={{ background: st.turn === "w" ? "#faf4e6" : "#241b15", border: "1px solid #888" }} />
            {turnText}
            {st.check && st.status === "playing" && <span style={{ color: "#c0492f", marginLeft: 8 }}>체크!</span>}
          </span>
        </div>
        <Countdown deadlineMs={deadline} />
        <div className="rule-info">🤖 {LEVEL_NAME[level]}</div>
      </div>

      <div className="game-body" style={{ justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8,1fr)",
              width: "100%",
              containerType: "inline-size",
              borderRadius: 8,
              overflow: "hidden",
              boxShadow: "0 24px 60px rgba(0,0,0,.5)",
              border: "6px solid #3a2a1d",
            } as React.CSSProperties}
          >
            {cells}
          </div>
          {history.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#8a7c6c", fontFamily: "monospace", maxHeight: 60, overflow: "auto" }}>
              마지막 수: {history[history.length - 1]} · 총 {history.length}수
            </div>
          )}
        </div>
      </div>

      {over && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>{st.winner === "draw" ? "⚖️ 무승부" : "🏆 게임 종료"}</h2>
            {st.winner === "draw" ? (
              <p>스테일메이트 — 무승부입니다.</p>
            ) : humanWon ? (
              <p>🎉 <b>당신</b>이 체크메이트로 승리했습니다!</p>
            ) : (
              <p>🤖 <b>봇({LEVEL_NAME[level]})</b>의 체크메이트 승리. 다시 도전해보세요!</p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button className="primary big" onClick={restart}>
                다시하기
              </button>
              <button className="big" onClick={() => setScreen("botSetup")}>
                난이도 변경
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
