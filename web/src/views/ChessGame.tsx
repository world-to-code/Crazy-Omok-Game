import { useEffect, useState } from "react";
import { useGame } from "../state/store";
import { CHESS_GLYPH, CHESS_NAME_KR, CHESS_FILES } from "../types";
import Countdown from "../components/Countdown";
import Chat from "../components/Chat";

// 집단지성 체스 게임 화면 (Claude Design '집단지성 체스' 시안 기반).
export default function ChessGame() {
  const { state, send, leave, returnToLobby } = useGame();
  const c = state.chess;
  const myTeam = state.players.find((p) => p.id === state.myId)?.team ?? null;

  // 내가 이번 라운드에 찍은 칸(서버는 집계만 주므로 로컬로 추적).
  const [myVote, setMyVote] = useState<string | null>(null);
  const round = c ? `${c.turn}|${c.phase}|${c.selected ? c.selected.join(",") : "-"}` : "";
  useEffect(() => {
    setMyVote(null);
  }, [round]);

  if (!c) {
    return (
      <div style={shell}>
        <div style={{ textAlign: "center", paddingTop: 120, color: "#a99a86" }}>준비 중…</div>
      </div>
    );
  }

  const sideTeam = c.turn === "w" ? 0 : 1;
  const interactive =
    state.status === "playing" && myTeam === sideTeam && (c.phase === "piece" || c.phase === "move");
  const isOver = c.phase === "over" || state.status === "finished";

  const optionSet = new Set(c.options.map(([r, f]) => `${r},${f}`));
  const selKey = c.selected ? `${c.selected[0]},${c.selected[1]}` : null;
  const lm = c.lastMove;
  const leading = Math.max(1, ...Array.from(state.chessTally.values()), 0);
  const totalVotes = Array.from(state.chessTally.values()).reduce((a, b) => a + b, 0);

  function vote(r: number, f: number) {
    if (!interactive || !optionSet.has(`${r},${f}`)) return;
    const k = `${r},${f}`;
    setMyVote((prev) => (prev === k ? null : k));
    send({ type: "ChessVote", r, f });
  }

  // ===== 보드 =====
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const k = `${r},${f}`;
      const piece = c.board[r]?.[f] ?? null;
      const isLight = (r + f) % 2 === 0;
      const isOpt = optionSet.has(k) && (c.phase === "piece" || c.phase === "move");
      const vc = state.chessTally.get(k) || 0;
      const share = vc / leading;
      const isLast = !!lm && ((lm[0][0] === r && lm[0][1] === f) || (lm[1][0] === r && lm[1][1] === f));
      let shadow = "";
      if (isLast) shadow += "inset 0 0 0 4px rgba(224,164,88,.28);";
      if (c.phase === "move" && k === selKey) shadow += "inset 0 0 0 4px #f0b96b;";
      if (isOpt) {
        const a = 0.32 + share * 0.55;
        shadow += `inset 0 0 0 3px rgba(224,164,88,${a.toFixed(2)});`;
        if (vc > 0) shadow += `0 0 ${(5 + share * 20).toFixed(0)}px rgba(224,164,88,${(0.3 + share * 0.5).toFixed(2)});`;
        if (myVote === k) shadow += "inset 0 0 0 4px #9be0a4;";
      }
      const selectable = isOpt && interactive;
      cells.push(
        <div
          key={k}
          onClick={selectable ? () => vote(r, f) : undefined}
          style={{
            position: "relative",
            aspectRatio: "1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isLight ? "#e9d3a8" : "#b07f50",
            boxShadow: shadow || undefined,
            cursor: selectable ? "pointer" : "default",
            transition: "box-shadow .25s, background .25s",
            animation: isOpt && vc === 0 ? "cc-pulse 1.8s ease-in-out infinite" : undefined,
          }}
        >
          {piece && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "8.2cqw",
                lineHeight: 1,
                color: piece.c === "w" ? "#faf4e6" : "#241b15",
                WebkitTextStroke: piece.c === "w" ? "1.1px #6b4a2e" : "1.1px #c9b89f",
                filter: "drop-shadow(0 2px 2px rgba(0,0,0,.35))",
                zIndex: 1,
                transform: c.phase === "move" && k === selKey ? "scale(1.08)" : undefined,
              }}
            >
              {CHESS_GLYPH[piece.t]}
            </span>
          )}
          {c.phase === "move" && isOpt && !piece && (
            <span
              style={{
                width: `${22 + share * 16}%`,
                height: `${22 + share * 16}%`,
                borderRadius: "50%",
                background: `rgba(224,164,88,${(0.4 + share * 0.5).toFixed(2)})`,
              }}
            />
          )}
          {vc > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 18,
                height: 18,
                padding: "0 4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 9,
                fontFamily: "'Spline Sans Mono',monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "#1a1410",
                background: `hsl(35,${(58 + share * 36).toFixed(0)}%,58%)`,
                zIndex: 2,
                boxShadow: "0 2px 6px rgba(0,0,0,.4)",
              }}
            >
              {vc}
            </span>
          )}
        </div>,
      );
    }
  }

  // ===== 집계 리스트 (내 팀) =====
  const tallyRows = Array.from(state.chessTally.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, vc]) => {
      const [r, f] = k.split(",").map(Number);
      const share = vc / leading;
      const pct = totalVotes ? Math.round((vc / totalVotes) * 100) : 0;
      let glyph = "",
        label = "",
        white = c.turn === "w";
      if (c.phase === "piece") {
        const p = c.board[r]?.[f];
        if (p) {
          glyph = CHESS_GLYPH[p.t];
          label = `${CHESS_NAME_KR[p.t]} · ${CHESS_FILES[f]}${8 - r}`;
          white = p.c === "w";
        }
      } else {
        const selP = c.selected ? c.board[c.selected[0]]?.[c.selected[1]] : null;
        glyph = selP ? CHESS_GLYPH[selP.t] : "";
        label = `${CHESS_FILES[f]}${8 - r}`;
      }
      return { k, glyph, label, vc, pct, share, white };
    });

  // ===== 멤버 (현재 차례 팀) =====
  const teamMembers = state.players.filter((p) => p.team === sideTeam);
  const teamName = c.turn === "w" ? "백 팀" : "흑 팀";

  const phaseLabels: Record<string, string> = {
    piece: "움직일 기물 선택",
    move: "이동 위치 선택",
    over: "게임 종료",
  };
  let instruction = "",
    instructionSub = "";
  if (c.phase === "piece") {
    instruction = interactive ? "움직일 기물에 투표하세요" : `${teamName}이 기물을 고르는 중`;
    instructionSub = interactive
      ? "빛나는 기물을 클릭 — 가장 많은 표를 받은 기물이 움직입니다"
      : "상대 팀의 투표를 관전 중입니다";
  } else if (c.phase === "move") {
    const selP = c.selected ? c.board[c.selected[0]]?.[c.selected[1]] : null;
    instruction = interactive ? "이동할 칸에 투표하세요" : "이동 위치를 고르는 중";
    instructionSub = `${selP ? CHESS_NAME_KR[selP.t] : "기물"}가 갈 수 있는 곳만 표시됩니다`;
  }

  return (
    <div style={shell}>
      {/* top bar */}
      <div style={topBar}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 220 }}>
            <div style={{ width: 13, height: 13, borderRadius: "50%", background: c.turn === "w" ? "#faf4e6" : "#241b15", border: "1px solid #6b574a" }} />
            <div>
              <div style={{ fontFamily: "'Spectral',serif", fontSize: 18, fontWeight: 600, lineHeight: 1 }}>
                {teamName} <span style={{ color: "#8a7c6c", fontSize: 13 }}>({c.turn === "w" ? "백" : "흑"})</span>
              </div>
              <div style={{ fontSize: 12, color: "#e0a458", marginTop: 3, fontWeight: 600 }}>
                {phaseLabels[c.phase] || ""}
                {c.checkStatus && <span style={{ color: "#c0492f", marginLeft: 8 }}>{c.checkStatus}</span>}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Spline Sans Mono',monospace", fontSize: 11, color: "#8a7c6c", marginBottom: 5 }}>
              <span>{state.voteVoted}/{state.voteVoters} 투표</span>
              <span style={{ color: "#e0a458" }}><Countdown deadlineMs={state.deadlineMs} /></span>
            </div>
            <div style={{ height: 7, background: "#2c231e", borderRadius: 7, overflow: "hidden" }}>
              <div style={{ height: "100%", width: state.voteVoters ? `${Math.round((state.voteVoted / state.voteVoters) * 100)}%` : "0%", background: "#e0a458", borderRadius: 7, transition: "width .2s" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={leave} style={ghostBtn}>나가기</button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 1320, width: "100%", margin: "0 auto", padding: 24, display: "grid", gridTemplateColumns: "248px minmax(0,1fr) 332px", gap: 24, alignItems: "start" }}>
        {/* left: info + history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={card}>
            <div style={{ fontFamily: "'Spectral',serif", fontSize: 17, fontWeight: 600 }}>{state.settings?.name}</div>
            <div style={{ color: "#8a7c6c", fontSize: 12, marginTop: 4 }}>백 팀 vs 흑 팀 · 집단지성</div>
            <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
              <Stat n={c.history.length + 1} label="수" accent />
              <Stat n={teamMembers.length} label="우리 팀" />
            </div>
          </div>
          <div style={{ ...card, flex: 1, minHeight: 0 }}>
            <div style={sectionLabel}>기보</div>
            <div className="scl" style={{ maxHeight: 320, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {c.history.length === 0 && <div style={{ color: "#6b5d4f", fontSize: 13, padding: 6 }}>아직 둔 수가 없습니다</div>}
              {c.history.map((h, i) => (
                <div key={i} style={{ display: "flex", gap: 10, fontFamily: "'Spline Sans Mono',monospace", fontSize: 13, padding: "3px 6px", borderRadius: 5, background: i === c.history.length - 1 ? "rgba(224,164,88,.1)" : "transparent" }}>
                  <span style={{ color: "#6b5d4f", width: 22 }}>{i + 1}</span>
                  <span style={{ color: i % 2 === 0 ? "#f3ebdd" : "#9bc4d4" }}>{h}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* center: board */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", width: "100%", containerType: "inline-size", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.5)", border: "6px solid #3a2a1d" } as React.CSSProperties}>
              {cells}
            </div>
          </div>
          <div style={{ textAlign: "center", maxWidth: 520 }}>
            <div style={{ fontSize: 15, color: "#c9b89f", fontWeight: 600 }}>{instruction}</div>
            <div style={{ fontSize: 13, color: "#8a7c6c", marginTop: 4 }}>{instructionSub}</div>
          </div>
        </div>

        {/* right: tally + members + chat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={sectionLabel}>실시간 집계</div>
              <div style={{ fontFamily: "'Spline Sans Mono',monospace", fontSize: 11, color: "#e0a458" }}>{totalVotes} 표</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {tallyRows.length === 0 && <div style={{ color: "#6b5d4f", fontSize: 13, textAlign: "center", padding: 10 }}>{myTeam === sideTeam ? "투표를 기다리는 중…" : "상대 팀이 투표 중…"}</div>}
              {tallyRows.map((t) => (
                <div key={t.k}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
                    <span style={{ fontSize: 18, lineHeight: 1, color: t.white ? "#faf4e6" : "#241b15", WebkitTextStroke: t.white ? ".6px #6b4a2e" : ".6px #c9b89f" }}>{t.glyph}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{t.label}</span>
                    <span style={{ fontFamily: "'Spline Sans Mono',monospace", fontSize: 13, color: "#e0a458" }}>{t.vc}<span style={{ color: "#8a7c6c", fontSize: 11 }}>·{t.pct}%</span></span>
                  </div>
                  <div style={{ height: 8, background: "#2c231e", borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${20 + t.share * 80}%`, background: `hsl(35,${(55 + t.share * 38).toFixed(0)}%,${(48 + t.share * 8).toFixed(0)}%)`, borderRadius: 8, transition: "width .3s" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>{teamName} 멤버 ({teamMembers.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {teamMembers.map((m) => {
                const me = m.id === state.myId;
                return (
                  <div key={m.id} title={m.nickname} style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: m.connected ? "#241b15" : "#1a1410", color: me ? "#9be0a4" : "#c9b89f", border: `1.5px solid ${me ? "#9be0a4" : "#3a2f29"}`, opacity: m.connected ? 1 : 0.5 }}>
                    {m.nickname[0] ?? "?"}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>채팅</div>
            <Chat />
          </div>
        </div>
      </div>

      {/* result */}
      {isOver && c.winner && (
        <div style={overlay}>
          <div style={{ background: "#1c1512", border: "1px solid #3a2f29", borderRadius: 20, padding: "44px 52px", textAlign: "center", boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
            <div style={{ fontSize: 54, marginBottom: 8 }}>{c.winner === "draw" ? "⚖️" : "♚"}</div>
            <div style={{ fontFamily: "'Spectral',serif", fontSize: 32, fontWeight: 600 }}>
              {c.winner === "draw" ? "무승부 (스테일메이트)" : `${c.winner === "w" ? "백 팀" : "흑 팀"} 승리!`}
            </div>
            <div style={{ color: "#a99a86", fontSize: 15, marginTop: 8 }}>{c.checkStatus || "게임 종료"}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 30, justifyContent: "center" }}>
              <button onClick={returnToLobby} style={primaryBtn}>로비로</button>
              <button onClick={leave} style={ghostBtn}>나가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: "'Spline Sans Mono',monospace", fontSize: 22, color: accent ? "#e0a458" : "#f3ebdd" }}>{n}</div>
      <div style={{ fontSize: 11, color: "#8a7c6c" }}>{label}</div>
    </div>
  );
}

const shell: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "auto",
  background: "radial-gradient(1200px 700px at 50% -10%,#221813,#15110f 70%)",
  color: "#f3ebdd",
  fontFamily: "'Plus Jakarta Sans',sans-serif",
  display: "flex",
  flexDirection: "column",
  zIndex: 1,
};
const topBar: React.CSSProperties = {
  borderBottom: "1px solid #2c231e",
  background: "rgba(21,17,15,.85)",
  backdropFilter: "blur(8px)",
  position: "sticky",
  top: 0,
  zIndex: 20,
};
const card: React.CSSProperties = { background: "#1c1512", border: "1px solid #2f251f", borderRadius: 14, padding: 16 };
const sectionLabel: React.CSSProperties = { fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "#8a7c6c", fontFamily: "'Spline Sans Mono',monospace" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#c9b89f", border: "1px solid #4a3b32", padding: "9px 13px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { background: "#e0a458", color: "#1a1410", border: "none", padding: "13px 24px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 50, background: "rgba(12,9,7,.85)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" };
