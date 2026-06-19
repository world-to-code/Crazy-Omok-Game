import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import {
  chessAi,
  chessApply,
  chessMovesFrom,
  chessStart,
  chessState,
  ensureAiWasm,
  terminateAiWorker,
  type ChessStateT,
  type Level,
} from "../net/aiWasm";
import { CHESS_GLYPH, CHESS_NAME_KR } from "../types";
import { useViewportWidth } from "../bot/useViewport";
import Countdown from "../components/Countdown";

// 기물 범례(왼쪽 사이드바): 유니코드 글리프 ↔ 한글 이름.
const PIECE_LEGEND: { t: string }[] = [
  { t: "k" }, { t: "q" }, { t: "r" }, { t: "b" }, { t: "n" }, { t: "p" },
];

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

  // 방을 나가거나 페이지를 닫으면 AI 워커를 종료(백그라운드 계산 잔존 방지).
  useEffect(() => () => terminateAiWorker(), []);

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

  // 훅은 조기 반환보다 위에서 무조건 호출돼야 한다.
  const vw = useViewportWidth();

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
      const isCapture = isOpt && !!piece; // 옵션 칸에 상대 기물 = 잡을 수 있음
      const isSel = selKey === k;
      const isLast = !!lastMove && ((lastMove[0][0] === r && lastMove[0][1] === f) || (lastMove[1][0] === r && lastMove[1][1] === f));
      const selectable = humanTurn && (pieceSet.has(k) || isOpt);
      let shadow = "";
      if (isLast) shadow += "inset 0 0 0 4px rgba(224,164,88,.28);";
      if (isSel) shadow += "inset 0 0 0 4px #f0b96b;";
      if (isCapture) shadow += "inset 0 0 0 3px rgba(239,68,68,.9);";
      else if (isOpt) shadow += "inset 0 0 0 3px rgba(155,224,164,.55);";
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
          {isCapture && (
            <>
              {/* 잡을 수 있는 상대 기물: 빨간 링 + 모서리 ⚔ 표시 */}
              <span
                style={{
                  position: "absolute",
                  inset: "7%",
                  borderRadius: "50%",
                  border: "3px solid rgba(239,68,68,.95)",
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: "3%",
                  right: "5%",
                  fontSize: "4cqw",
                  lineHeight: 1,
                  pointerEvents: "none",
                  zIndex: 3,
                  filter: "drop-shadow(0 1px 1px rgba(0,0,0,.5))",
                }}
              >
                ⚔️
              </span>
            </>
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

  // 화면 가로 70%를 한 변으로(체스판은 8칸 정사각이라 자동 1:1).
  const boardSize = Math.max(240, Math.round(vw * 0.7));
  // 왼쪽 여백에 범례를 둘 공간이 충분할 때만 표시.
  const showLegend = (vw - boardSize) / 2 >= 170;

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
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

      {/* 풀블리드: 뷰포트 전체 폭을 화면 정중앙에 두고 그 안에서 70% 보드를 중앙 정렬.
          왼쪽 여백에 기물 범례 사이드바. */}
      <div
        style={{
          width: `${vw}px`,
          marginLeft: `calc(50% - ${vw / 2}px)`,
          marginTop: 12,
          position: "relative",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {showLegend && (
          <aside
            style={{
              position: "absolute",
              left: 16,
              top: 0,
              width: 150,
              background: "#1c1512",
              border: "1px solid #2f251f",
              borderRadius: 14,
              padding: "14px 14px",
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: ".15em", color: "#8a7c6c", marginBottom: 10, fontFamily: "monospace" }}>
              기물
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PIECE_LEGEND.map(({ t }) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      fontSize: 26,
                      lineHeight: 1,
                      width: 26,
                      textAlign: "center",
                      color: "#faf4e6",
                      WebkitTextStroke: "1px #6b4a2e",
                    }}
                  >
                    {CHESS_GLYPH[t]}
                  </span>
                  <span style={{ color: "#8a7c6c" }}>:</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#f3ebdd" }}>{CHESS_NAME_KR[t]}</span>
                </div>
              ))}
            </div>
          </aside>
        )}
        <div style={{ width: `${boardSize}px` }}>
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
