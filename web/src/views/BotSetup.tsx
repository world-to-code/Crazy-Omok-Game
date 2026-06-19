import { useState } from "react";
import { useGame } from "../state/store";

// 봇전 설정: 난이도(쉬움/중간/어려움/헬) + 선공 선택 → 즉시 시작.
const LEVELS: { v: 0 | 1 | 2 | 3; emoji: string; name: string; desc: string }[] = [
  { v: 0, emoji: "🙂", name: "쉬움", desc: "빠르게 둠 · 가끔 실수 · 입문자용" },
  { v: 1, emoji: "😎", name: "중간", desc: "수읽기 시작 · 만만치 않음" },
  { v: 2, emoji: "🔥", name: "어려움", desc: "최대 5초 수읽기 · 사람이 이기기 매우 어려움" },
  { v: 3, emoji: "😈", name: "헬", desc: "최대 10초 · 더 깊고 넓게 · 강제승 완전탐색/오프닝북" },
];

export default function BotSetup() {
  const { state, setScreen, startBot } = useGame();
  const game = state.selectedGame === "chess" ? "chess" : "omok";
  const [level, setLevel] = useState<0 | 1 | 2 | 3>(1);
  const [humanFirst, setHumanFirst] = useState(true);

  const gameLabel = game === "chess" ? "체스" : "오목";
  const firstLabel = game === "chess" ? "백 (선공)" : "흑 (선공)";
  const secondLabel = game === "chess" ? "흑 (후공)" : "백 (후공)";

  return (
    <div className="home card">
      <button className="back" onClick={() => setScreen("home")}>
        ← 뒤로
      </button>
      <h1>🤖 봇과 대결 — {gameLabel}</h1>
      <p className="subtitle">난이도를 고르면 바로 시작합니다. 제한시간 45초.</p>

      <div className="game-pick" style={{ marginTop: 8 }}>
        {LEVELS.map((l) => (
          <button
            key={l.v}
            className={`game-card${level === l.v ? " active" : ""}`}
            onClick={() => setLevel(l.v)}
          >
            <div className="game-emoji">{l.emoji}</div>
            <div className="game-title">{l.name}</div>
            <div className="game-sub">{l.desc}</div>
          </button>
        ))}
      </div>

      <div style={{ margin: "18px 0 8px", fontWeight: 600 }}>내 선공/색</div>
      <div className="game-pick">
        <button
          className={`game-card${humanFirst ? " active" : ""}`}
          onClick={() => setHumanFirst(true)}
        >
          <div className="game-emoji">{game === "chess" ? "♔" : "⚫️"}</div>
          <div className="game-title">{firstLabel}</div>
          <div className="game-sub">내가 먼저 둠</div>
        </button>
        <button
          className={`game-card${!humanFirst ? " active" : ""}`}
          onClick={() => setHumanFirst(false)}
        >
          <div className="game-emoji">{game === "chess" ? "♚" : "⚪️"}</div>
          <div className="game-title">{secondLabel}</div>
          <div className="game-sub">봇이 먼저 둠</div>
        </button>
      </div>

      <div className="home-buttons" style={{ marginTop: 22 }}>
        <button className="big primary" onClick={() => startBot({ game, level, humanFirst })}>
          ▶️ 시작하기
        </button>
      </div>
    </div>
  );
}
