import type { ReactNode } from "react";
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

/** 오른쪽 '게임 방법' 패널 — 처음 하는 사람을 위한 규칙 설명. */
export function RulesPanel({ game, maxHeight }: { game: "omok" | "chess" | "checkers"; maxHeight: number }) {
  return (
    <aside
      className="scl"
      style={{ position: "absolute", right: 16, top: 0, width: 250, maxHeight, overflowY: "auto", padding: 14, ...panelCard }}
    >
      <div style={{ ...panelHead, marginBottom: 10 }}>게임 방법</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {game === "omok" && (
          <>
            <Li>내 돌을 가로·세로·대각선으로 <B>5개</B> 먼저 연결하면 승리!</Li>
            <Li>빈 칸을 <B>클릭</B>하면 돌이 놓여요.</Li>
            <Li>흑(선)은 <B>금수</B>가 있어요 — 열린 3을 두 개(삼삼), 4를 두 개(사사), 6목(장목)은 둘 수 없어요. 금지 자리는 빨간 <B>✕</B>로 표시돼요.</Li>
          </>
        )}
        {game === "chess" && (
          <>
            <Li>상대의 <B>킹</B>을 빠져나갈 수 없게 공격하면(<B>체크메이트</B>) 승리!</Li>
            <Li>내 기물을 클릭하면 갈 수 있는 칸이 표시돼요. 그 칸을 클릭해 이동.</Li>
            <Li>잡을 수 있는 상대 기물은 빨간 테두리와 <B>⚔️</B>로 표시돼요.</Li>
            <Li>킹이 공격받으면 <B>체크</B> — 반드시 위협을 피해야 해요.</Li>
            <div style={{ borderTop: "1px solid #2f251f", margin: "4px 0 2px", paddingTop: 8 }}>
              <div style={{ ...panelHead, marginBottom: 8 }}>기물</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                {["k", "q", "r", "b", "n", "p"].map((t) => (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 20, lineHeight: 1, width: 20, textAlign: "center", color: "#faf4e6", WebkitTextStroke: "1px #6b4a2e" }}>{CHESS_GLYPH[t]}</span>
                    <span style={{ fontSize: 13, color: "#d8ccbb" }}>{CHESS_NAME_KR[t]}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {game === "checkers" && (
          <>
            <Li>상대 말을 <B>모두 잡거나</B>, 움직이지 못하게 막으면 승리!</Li>
            <Li>말은 대각선 <B>앞으로 한 칸</B> 이동해요. 내 말을 클릭하면 갈 곳이 표시돼요.</Li>
            <Li>상대 말을 <B>뛰어넘어</B> 잡아요. 잡을 수 있으면 <B>반드시</B> 잡아야 하고, 연달아 잡을 수 있으면 계속 잡아요.</Li>
            <Li>맨 끝줄에 닿으면 <B>킹(♛)</B>이 되어 <B>뒤로도</B> 움직일 수 있어요.</Li>
          </>
        )}
      </div>
    </aside>
  );
}
