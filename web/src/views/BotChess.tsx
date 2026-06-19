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
  type ChessApplyT,
  type ChessStateT,
  type Level,
} from "../net/aiWasm";
import { CHESS_FILES, CHESS_GLYPH, CHESS_NAME_KR } from "../types";
import { useViewportSize } from "../bot/useViewport";
import Countdown from "../components/Countdown";

// 기물 범례(왼쪽 사이드바): 유니코드 글리프 ↔ 한글 이름.
const PIECE_LEGEND = ["k", "q", "r", "b", "n", "p"];

const LEVEL_NAME = ["쉬움", "중간", "어려움", "헬"];
const TURN_MS = 45_000;

// (r,f) → 체스 표기(a1~h8). r=0이 8랭크, f=0이 a파일.
const sq = (r: number, f: number) => `${CHESS_FILES[f]}${8 - r}`;

interface MoveRec {
  n: number;
  color: "w" | "b";
  t: string; // 기물 종류
  from: [number, number];
  to: [number, number];
  capture: boolean;
  castle: "K" | "Q" | null; // 킹사이드/퀸사이드
  check: boolean;
  mate: boolean;
}

// 이동 전 상태(prev)와 적용 결과(res)로 상세 기보 한 줄을 만든다.
function buildRec(prev: ChessStateT, res: ChessApplyT): Omit<MoveRec, "n"> {
  const [fr, ff] = res.from;
  const [tr, tf] = res.to;
  const moving = prev.board[fr]?.[ff] ?? null;
  const captured = prev.board[tr]?.[tf] ?? null;
  const castle = res.san === "O-O" ? "K" : res.san === "O-O-O" ? "Q" : null;
  return {
    color: (moving?.c as "w" | "b") ?? prev.turn,
    t: moving?.t ?? "p",
    from: res.from,
    to: res.to,
    capture: !!captured || res.san.includes("x"),
    castle,
    check: res.state.status === "playing" && res.state.check,
    mate: res.state.status === "checkmate",
  };
}

function kingKey(st: ChessStateT, color: "w" | "b"): string | null {
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = st.board[r]?.[f];
      if (p && p.t === "k" && p.c === color) return `${r},${f}`;
    }
  }
  return null;
}

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
  const [moves, setMoves] = useState<MoveRec[]>([]);
  const [castled, setCastled] = useState<{ w: boolean; b: boolean }>({ w: false, b: false });
  const [thinking, setThinking] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const botBusy = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

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

  // 기보 로그는 새 수가 추가되면 맨 아래로 자동 스크롤.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [moves.length]);

  const commit = useCallback(
    (
      newFen: string,
      newState: ChessStateT,
      rec: Omit<MoveRec, "n">,
      from: [number, number],
      to: [number, number],
    ) => {
      setFen(newFen);
      setSt(newState);
      setMoves((m) => [...m, { ...rec, n: m.length + 1 }]);
      if (rec.castle) setCastled((c) => ({ ...c, [rec.color]: true }));
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
    const prev = st;
    chessAi(curFen, level).then((res) => {
      botBusy.current = false;
      setThinking(false);
      if (res.ok) commit(res.fen, res.state, buildRec(prev, res), res.from, res.to);
    });
  }, [fen, st, botColor, level, commit]);

  // 사람 차례 카운트다운(표시용).
  useEffect(() => {
    if (st && st.status === "playing" && st.turn === humanColor) setDeadline(Date.now() + TURN_MS);
    else setDeadline(null);
  }, [st, humanColor]);

  // 훅은 조기 반환보다 위에서 무조건 호출돼야 한다.
  const { w: vw, h: vh } = useViewportSize();
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    const update = () => {
      const top = boardWrapRef.current?.getBoundingClientRect().top ?? 150;
      // .app 의 하단 패딩(60px) + 약간의 여백까지 빼야 세로 스크롤이 안 생긴다.
      setAvailH(document.documentElement.clientHeight - top - 66);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [vw, vh, fen]);

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
  const isMate = st.status === "checkmate";
  // 체크/체크메이트일 때 위험에 처한 킹(현재 차례 쪽).
  const dangerKing =
    st.status === "checkmate" || (st.status === "playing" && st.check) ? kingKey(st, st.turn) : null;

  function clickCell(r: number, f: number) {
    if (!humanTurn) return;
    const k = `${r},${f}`;
    if (selected && optionSet.has(k)) {
      const res = chessApply(fen!, selected[0], selected[1], r, f);
      if (res.ok) commit(res.fen, res.state, buildRec(st!, res), res.from, res.to);
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
    setMoves([]);
    setCastled({ w: false, b: false });
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
      const isCapture = isOpt && !!piece;
      const isSel = selKey === k;
      const isFrom = !!lastMove && lastMove[0][0] === r && lastMove[0][1] === f;
      const isTo = !!lastMove && lastMove[1][0] === r && lastMove[1][1] === f;
      const isDanger = dangerKing === k;
      const selectable = humanTurn && (pieceSet.has(k) || isOpt);
      let shadow = "";
      if (isFrom) shadow += "inset 0 0 0 4px rgba(224,164,88,.22);";
      if (isTo) shadow += "inset 0 0 0 5px rgba(224,164,88,.85);";
      if (isSel) shadow += "inset 0 0 0 4px #f0b96b;";
      if (isCapture) shadow += "inset 0 0 0 3px rgba(239,68,68,.9);";
      else if (isOpt) shadow += "inset 0 0 0 3px rgba(155,224,164,.55);";
      // 좌표 라벨: 왼쪽 열에 랭크(숫자), 아래 행에 파일(문자).
      const showRank = df === 0;
      const showFile = dr === 7;
      const labelColor = isLight ? "rgba(90,60,30,.75)" : "rgba(250,240,220,.8)";
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
          {/* 체크/체크메이트 킹 강조 */}
          {isDanger && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                zIndex: 1,
                borderRadius: 2,
                animation: `${isMate ? "bc-mate" : "bc-check"} ${isMate ? "0.6s" : "1.1s"} ease-in-out infinite`,
              }}
            />
          )}
          {showRank && (
            <span style={{ position: "absolute", top: 1, left: 3, fontSize: "2.6cqw", fontWeight: 700, color: labelColor, pointerEvents: "none", zIndex: 4, fontFamily: "monospace" }}>
              {8 - r}
            </span>
          )}
          {showFile && (
            <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: "2.6cqw", fontWeight: 700, color: labelColor, pointerEvents: "none", zIndex: 4, fontFamily: "monospace" }}>
              {CHESS_FILES[f]}
            </span>
          )}
          {piece && (
            <span
              style={{
                fontSize: "8.2cqw",
                lineHeight: 1,
                color: piece.c === "w" ? "#faf4e6" : "#241b15",
                WebkitTextStroke: piece.c === "w" ? "1.1px #6b4a2e" : "1.1px #c9b89f",
                filter: "drop-shadow(0 2px 2px rgba(0,0,0,.35))",
                zIndex: 2,
              }}
            >
              {CHESS_GLYPH[piece.t]}
            </span>
          )}
          {isOpt && !piece && (
            <span style={{ width: "26%", height: "26%", borderRadius: "50%", background: "rgba(155,224,164,.7)", zIndex: 2 }} />
          )}
          {isCapture && (
            <>
              <span style={{ position: "absolute", inset: "7%", borderRadius: "50%", border: "3px solid rgba(239,68,68,.95)", boxSizing: "border-box", pointerEvents: "none", zIndex: 3 }} />
              <span style={{ position: "absolute", top: "3%", right: "5%", fontSize: "4cqw", lineHeight: 1, pointerEvents: "none", zIndex: 3, filter: "drop-shadow(0 1px 1px rgba(0,0,0,.5))" }}>⚔️</span>
            </>
          )}
        </div>,
      );
    }
  }

  const turnText =
    st.status !== "playing" ? "게임 종료" : thinking ? "🤖 봇이 생각 중…" : humanTurn ? "내 차례" : "봇 차례";
  const over = st.status !== "playing";
  const humanWon = st.winner === humanColor;

  // 스크롤이 안 생기게: 가로 70% 와 '남은 높이(보드 아래 기보 한 줄 제외)' 중 작은 값(정사각).
  const avail = (availH > 0 ? availH : vh - 160) - 40;
  const boardSize = Math.max(240, Math.min(Math.round(vw * 0.7), Math.round(avail)));
  const gap = (vw - boardSize) / 2;
  const showLegend = gap >= 170;
  const showLog = gap >= 210; // 오른쪽 여백에 기보 패널 둘 공간

  const last = moves[moves.length - 1];

  return (
    <div className="game" style={{ width: "100%", marginLeft: 0 }}>
      <style>{`
        @keyframes bc-check {
          0%,100% { box-shadow: inset 0 0 0 4px rgba(220,40,40,.85); }
          50% { box-shadow: inset 0 0 0 6px rgba(255,70,70,1), inset 0 0 20px 4px rgba(220,40,40,.6); }
        }
        @keyframes bc-mate {
          0%,100% { box-shadow: inset 0 0 0 6px rgba(220,20,20,1); background: rgba(220,20,20,.30); }
          50% { box-shadow: inset 0 0 0 8px rgba(255,60,60,1), inset 0 0 26px 6px rgba(220,20,20,.8); background: rgba(255,40,40,.55); }
        }
      `}</style>
      <div className="game-bar card">
        <button className="back" onClick={() => setScreen("home")}>
          ← 나가기
        </button>
        <div className="turn-info">
          <span className={humanTurn ? "turn-me" : ""}>
            <span className="color-dot" style={{ background: st.turn === "w" ? "#faf4e6" : "#241b15", border: "1px solid #888" }} />
            {turnText}
            {st.check && st.status === "playing" && (
              <span style={{ color: "#ff5a5a", marginLeft: 8, fontWeight: 800 }}>⚠ 체크!</span>
            )}
            {isMate && <span style={{ color: "#ff5a5a", marginLeft: 8, fontWeight: 800 }}>♚ 체크메이트!</span>}
          </span>
        </div>
        <Countdown deadlineMs={deadline} />
        <div className="rule-info">🤖 {LEVEL_NAME[level]}</div>
      </div>

      {/* 풀블리드: 보드 중앙, 왼쪽 기물 범례 · 오른쪽 상세 기보 로그 */}
      <div
        ref={boardWrapRef}
        style={{ width: `${vw}px`, marginLeft: `calc(50% - ${vw / 2}px)`, marginTop: 12, position: "relative", display: "flex", justifyContent: "center" }}
      >
        {showLegend && (
          <aside style={{ position: "absolute", left: 16, top: 0, width: 150, ...cardStyle }}>
            <div style={labelHead}>기물</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PIECE_LEGEND.map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 26, lineHeight: 1, width: 26, textAlign: "center", color: "#faf4e6", WebkitTextStroke: "1px #6b4a2e" }}>
                    {CHESS_GLYPH[t]}
                  </span>
                  <span style={{ color: "#8a7c6c" }}>:</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#f3ebdd" }}>{CHESS_NAME_KR[t]}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {showLog && (
          <aside style={{ position: "absolute", right: 16, top: 0, width: 272, maxHeight: boardSize, display: "flex", flexDirection: "column", ...cardStyle, padding: 0 }}>
            <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid #2f251f", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={labelHead}>기보</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e0a458" }}>총 {moves.length}수</span>
            </div>
            <div ref={logRef} className="scl" style={{ overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
              {moves.length === 0 && <div style={{ color: "#6b5d4f", fontSize: 12, padding: 8 }}>아직 둔 수가 없습니다</div>}
              {moves.map((m) => (
                <MoveRow key={m.n} m={m} highlight={m.n === moves.length} />
              ))}
            </div>
            <div style={{ padding: "8px 14px", borderTop: "1px solid #2f251f", fontSize: 11.5, color: "#a99a86", display: "flex", justifyContent: "space-between" }}>
              <span>♔ 캐슬링(킹·룩 이동)</span>
              <span style={{ fontFamily: "monospace" }}>
                백 {castled.w ? "✓" : "–"} · 흑 {castled.b ? "✓" : "–"}
              </span>
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
          {/* 보드 아래 마지막 수 요약(좁은 화면에서도 보임) */}
          <div style={{ marginTop: 10, fontSize: 13, color: "#c9b89f", display: "flex", alignItems: "center", gap: 8, minHeight: 22, justifyContent: "center" }}>
            {last ? (
              <>
                <span style={{ color: "#8a7c6c" }}>마지막 수:</span>
                <span style={{ fontSize: 18, color: last.color === "w" ? "#faf4e6" : "#241b15", WebkitTextStroke: last.color === "w" ? ".6px #6b4a2e" : ".6px #c9b89f" }}>{CHESS_GLYPH[last.t]}</span>
                <span style={{ fontWeight: 600 }}>{CHESS_NAME_KR[last.t]}</span>
                <span style={{ fontFamily: "monospace", color: "#e0a458" }}>{sq(...last.from)}→{sq(...last.to)}</span>
                {last.castle && <Badge text={last.castle === "K" ? "캐슬링 킹사이드" : "캐슬링 퀸사이드"} c="#7dd3fc" />}
                {last.capture && <Badge text="잡음" c="#fb7185" />}
                {last.mate ? <Badge text="체크메이트" c="#ff5a5a" /> : last.check && <Badge text="체크" c="#ff5a5a" />}
              </>
            ) : (
              <span style={{ color: "#6b5d4f" }}>기물을 클릭해 두세요</span>
            )}
          </div>
        </div>
      </div>

      {over && (
        <div className="overlay" style={isMate ? { background: "radial-gradient(circle at center, rgba(120,10,10,.55), rgba(12,9,7,.9))" } : undefined}>
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

function MoveRow({ m, highlight }: { m: MoveRec; highlight: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        borderRadius: 6,
        background: highlight ? "rgba(224,164,88,.14)" : "transparent",
        fontSize: 12.5,
      }}
    >
      <span style={{ width: 22, textAlign: "right", color: "#6b5d4f", fontFamily: "monospace" }}>{m.n}</span>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.color === "w" ? "#faf4e6" : "#241b15", border: "1px solid #6b574a", flexShrink: 0 }} />
      <span style={{ fontSize: 16, color: m.color === "w" ? "#faf4e6" : "#241b15", WebkitTextStroke: m.color === "w" ? ".5px #6b4a2e" : ".5px #c9b89f" }}>{CHESS_GLYPH[m.t]}</span>
      <span style={{ color: "#c9b89f", minWidth: 30 }}>{CHESS_NAME_KR[m.t]}</span>
      {m.castle ? (
        <span style={{ fontFamily: "monospace", color: "#7dd3fc" }}>{m.castle === "K" ? "O-O" : "O-O-O"}</span>
      ) : (
        <span style={{ fontFamily: "monospace", color: "#e0a458" }}>
          {sq(...m.from)}
          <span style={{ color: m.capture ? "#fb7185" : "#8a7c6c" }}>{m.capture ? "×" : "→"}</span>
          {sq(...m.to)}
        </span>
      )}
      <span style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
        {m.mate ? <span style={{ color: "#ff5a5a", fontWeight: 800 }}>#</span> : m.check && <span style={{ color: "#ff5a5a", fontWeight: 800 }}>+</span>}
      </span>
    </div>
  );
}

function Badge({ text, c }: { text: string; c: string }) {
  return (
    <span style={{ padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: c, border: `1px solid ${c}`, background: "rgba(0,0,0,.2)" }}>
      {text}
    </span>
  );
}

const cardStyle: React.CSSProperties = { background: "#1c1512", border: "1px solid #2f251f", borderRadius: 14, padding: 14 };
const labelHead: React.CSSProperties = { fontSize: 11, letterSpacing: ".15em", color: "#8a7c6c", fontFamily: "monospace", textTransform: "uppercase" };
