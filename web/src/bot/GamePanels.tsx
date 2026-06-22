import { useState, type ReactNode } from "react";
import { CHESS_GLYPH, CHESS_NAME_KR } from "../types";

// 봇 게임 좌/우 패널 공통 스타일.
export const panelCard: React.CSSProperties = {
  background: "#1c1512",
  border: "1px solid #2f251f",
  borderRadius: 14,
};
export const panelHead: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".15em",
  color: "#8a7c6c",
  fontFamily: "monospace",
};

function Li({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.45, color: "#d8ccbb" }}>
      <span style={{ color: "#e0a458" }}>•</span>
      <span>{children}</span>
    </div>
  );
}
const B = ({ children }: { children: ReactNode }) => (
  <b style={{ color: "#f3ebdd" }}>{children}</b>
);

// 펼치기/접기 섹션.
function Acc({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ borderTop: "1px solid #2f251f" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: "#f3ebdd",
          cursor: "pointer",
          padding: "9px 2px",
          fontSize: 13,
          fontWeight: 700,
          textAlign: "left",
        }}
      >
        <span>{title}</span>
        <span style={{ color: "#e0a458", fontSize: 11 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ padding: "0 2px 10px", display: "flex", flexDirection: "column", gap: 7 }}>{children}</div>}
    </div>
  );
}

function PieceLegend() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
      {["k", "q", "r", "b", "n", "p"].map((t) => (
        <div key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 20, lineHeight: 1, width: 20, textAlign: "center", color: "#faf4e6", WebkitTextStroke: "1px #6b4a2e" }}>{CHESS_GLYPH[t]}</span>
          <span style={{ fontSize: 13, color: "#d8ccbb" }}>{CHESS_NAME_KR[t]}</span>
        </div>
      ))}
    </div>
  );
}

function ChessRules() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Acc title="목표 · 두는 법" defaultOpen>
        <Li>상대의 <B>킹</B>을 빠져나갈 수 없게 공격하면(<B>체크메이트</B>) 승리!</Li>
        <Li>내 기물을 클릭 → 갈 수 있는 칸(초록 점)이 표시돼요. 그 칸을 클릭해 이동.</Li>
        <Li>잡을 수 있는 상대 기물은 빨간 테두리와 <B>⚔️</B>로 표시돼요.</Li>
      </Acc>

      <Acc title="기물 이동">
        <Li><B>♙ 폰</B>: 앞으로 한 칸(첫 수는 두 칸도 가능). 잡을 땐 <B>대각선 앞</B> 한 칸.</Li>
        <Li><B>♞ 나이트</B>: L자(2+1칸)로 이동. 유일하게 <B>다른 기물을 뛰어넘어요</B>.</Li>
        <Li><B>♝ 비숍</B>: 대각선으로 원하는 만큼(막힐 때까지).</Li>
        <Li><B>♜ 룩</B>: 가로·세로로 원하는 만큼.</Li>
        <Li><B>♛ 퀸</B>: 가로·세로·대각선 모두(룩+비숍).</Li>
        <Li><B>♚ 킹</B>: 모든 방향으로 한 칸씩.</Li>
      </Acc>

      <Acc title="특수 규칙">
        <Li><B>캐슬링</B>: 킹·룩이 한 번도 안 움직였고 사이가 비어 있으면, 킹이 룩 쪽으로 두 칸 가고 룩이 킹 너머로 넘어와요. 킹이 지나는 칸이 공격받으면 불가.</Li>
        <Li><B>앙파상</B>: 상대 폰이 두 칸 전진해 내 폰 바로 옆에 섰을 때, <B>바로 다음 수에 한해</B> 그 폰이 지나간 칸으로 대각선 이동하며 잡을 수 있어요(잡는 폰은 빈 칸에 서고 상대 폰은 사라짐).</Li>
        <Li><B>폰 승급</B>: 폰이 맨 끝 줄에 닿으면 <B>퀸</B>으로 승급해요(이 게임은 자동 퀸).</Li>
      </Acc>

      <Acc title="체크 · 체크메이트 · 무승부">
        <Li><B>체크</B>: 내 킹이 공격받는 상태 — 반드시 위협을 없애야 해요.</Li>
        <Li><B>체크메이트</B>: 체크를 벗어날 방법이 전혀 없으면 패배(승부 결정).</Li>
        <Li><B>스테일메이트</B>: 체크는 아닌데 둘 수 있는 합법수가 하나도 없으면 <B>무승부</B>.</Li>
        <Li>그 밖에 기물이 부족해 외통이 불가능한 경우 등도 무승부예요.</Li>
      </Acc>

      <Acc title="기물 이름" defaultOpen>
        <PieceLegend />
      </Acc>
    </div>
  );
}

/** 오른쪽 '게임 방법' 패널 — 처음 하는 사람을 위한 규칙 설명. 길면 패널 안에서만 스크롤. */
export function RulesPanel({ game, maxHeight }: { game: "omok" | "chess" | "checkers"; maxHeight: number }) {
  return (
    <aside
      className="scl"
      style={{ position: "absolute", right: 16, top: 0, width: 256, maxHeight, overflowY: "auto", padding: 14, ...panelCard }}
    >
      <div style={{ ...panelHead, marginBottom: game === "chess" ? 4 : 10 }}>게임 방법</div>
      {game === "chess" && <ChessRules />}
      {game === "omok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <Li>내 돌을 가로·세로·대각선으로 <B>5개</B> 먼저 연결하면 승리!</Li>
          <Li>빈 칸을 <B>클릭</B>하면 돌이 놓여요.</Li>
          <Li>흑(선)은 <B>금수</B>가 있어요 — 열린 3을 두 개(삼삼), 4를 두 개(사사), 6목(장목)은 둘 수 없어요. 금지 자리는 빨간 <B>✕</B>로 표시돼요.</Li>
        </div>
      )}
      {game === "checkers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <Li>상대 말을 <B>모두 잡거나</B>, 움직이지 못하게 막으면 승리!</Li>
          <Li>말은 대각선 <B>앞으로 한 칸</B> 이동해요. 내 말을 클릭하면 갈 곳이 표시돼요.</Li>
          <Li>상대 말을 <B>뛰어넘어</B> 잡아요. 잡을 수 있으면 <B>반드시</B> 잡아야 하고, 연달아 잡을 수 있으면 계속 잡아요.</Li>
          <Li>맨 끝줄에 닿으면 <B>킹(♛)</B>이 되어 <B>뒤로도</B> 움직일 수 있어요.</Li>
        </div>
      )}
    </aside>
  );
}
