import { useState } from "react";
import { useGame } from "../state/store";
import { ZODIAC } from "../yut/zodiac";

// 봇전 설정: 난이도(쉬움/중간/어려움/헬) + 선공 선택 → 즉시 시작.
const LEVELS: { v: 0 | 1 | 2 | 3; emoji: string; name: string; desc: string }[] = [
  { v: 0, emoji: "🙂", name: "쉬움", desc: "느긋하게 두는 상대" },
  { v: 1, emoji: "😎", name: "중간", desc: "제법 두는 상대, 방심은 금물" },
  { v: 2, emoji: "🔥", name: "어려움", desc: "수를 깊이 읽는 강적" },
  { v: 3, emoji: "😈", name: "헬", desc: "전력을 다하는 최강의 적수" },
];

export default function BotSetup() {
  const { state, setScreen, startBot } = useGame();
  const game =
    state.selectedGame === "chess"
      ? "chess"
      : state.selectedGame === "checkers"
        ? "checkers"
        : state.selectedGame === "yut"
          ? "yut"
          : "omok";
  const [level, setLevel] = useState<0 | 1 | 2 | 3>(1);
  const [humanFirst, setHumanFirst] = useState(true);
  const [zodiac, setZodiac] = useState<string>(ZODIAC[2].id); // 기본 호랑이

  const gameLabel =
    game === "chess" ? "체스" : game === "checkers" ? "체커" : game === "yut" ? "윷놀이" : "오목";
  const isYut = game === "yut";
  const firstLabel = game === "chess" ? "백 (선공)" : isYut ? "내가 먼저" : "흑 (선공)";
  const secondLabel = game === "chess" ? "흑 (후공)" : isYut ? "봇이 먼저" : "백 (후공)";

  return (
    <div className="home card">
      <button className="back" onClick={() => setScreen("home")}>
        ← 뒤로
      </button>
      <h1>🤖 봇과 대결 — {gameLabel}</h1>
      <p className="subtitle">
        {isYut ? "캐릭터와 선·후공을 고르면 바로 시작합니다." : "난이도를 고르면 바로 시작합니다. 제한시간 45초."}
      </p>

      {/* 윷놀이는 운 비중이 커 난이도 구분이 의미가 적어 생략(봇은 항상 합리적으로 둠). */}
      {!isYut && (
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
      )}

      {isYut && (
        <>
          <div style={{ margin: "18px 0 8px", fontWeight: 600 }}>내 캐릭터 (12지신)</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 8,
            }}
          >
            {ZODIAC.map((z) => (
              <button
                key={z.id}
                className={`game-card${zodiac === z.id ? " active" : ""}`}
                onClick={() => setZodiac(z.id)}
                style={{ padding: "10px 4px" }}
              >
                <div style={{ fontSize: 26, lineHeight: 1 }}>{z.emoji}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>{z.name}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ margin: "18px 0 8px", fontWeight: 600 }}>{isYut ? "선/후공" : "내 선공/색"}</div>
      <div className="game-pick">
        <button
          className={`game-card${humanFirst ? " active" : ""}`}
          onClick={() => setHumanFirst(true)}
        >
          <div className="game-emoji">{game === "chess" ? "♔" : isYut ? "🙋" : "⚫️"}</div>
          <div className="game-title">{firstLabel}</div>
          <div className="game-sub">내가 먼저 둠</div>
        </button>
        <button
          className={`game-card${!humanFirst ? " active" : ""}`}
          onClick={() => setHumanFirst(false)}
        >
          <div className="game-emoji">{game === "chess" ? "♚" : isYut ? "🤖" : "⚪️"}</div>
          <div className="game-title">{secondLabel}</div>
          <div className="game-sub">봇이 먼저 둠</div>
        </button>
      </div>

      <div className="home-buttons" style={{ marginTop: 22 }}>
        <button
          className="big primary"
          onClick={() => startBot({ game, level: isYut ? 3 : level, humanFirst, ...(isYut ? { zodiac } : {}) })}
        >
          ▶️ 시작하기
        </button>
      </div>
    </div>
  );
}
