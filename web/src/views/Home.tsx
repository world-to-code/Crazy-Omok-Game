import { useEffect } from "react";
import { useGame } from "../state/store";
import { FLICK_ENABLED } from "../config";

export default function Home() {
  const { state, setScreen, selectGame } = useGame();
  const g = state.selectedGame;

  // 알까기가 비활성화된 빌드에서 혹시 선택돼 있으면 오목으로 되돌림.
  useEffect(() => {
    if (!FLICK_ENABLED && g === "flick") selectGame("omok");
  }, [g, selectGame]);

  return (
    <div className="home card">
      <h1>🎮 보드게임 파티</h1>
      <p className="subtitle">같은 WiFi/링크로 친구들과 함께 — 게임을 고르세요</p>

      <div className="game-pick">
        <button
          className={`game-card${g === "omok" ? " active" : ""}`}
          onClick={() => selectGame("omok")}
        >
          <div className="game-emoji">⚫️⚪️</div>
          <div className="game-title">오목</div>
          <div className="game-sub">클래식/팀전 · 2~20명</div>
        </button>
        <button
          className={`game-card${g === "flick" ? " active" : ""}`}
          disabled={!FLICK_ENABLED}
          onClick={() => FLICK_ENABLED && selectGame("flick")}
        >
          <div className="game-emoji">🌀💥</div>
          <div className="game-title">초능력 알까기 {!FLICK_ENABLED && "🔒"}</div>
          <div className="game-sub">{FLICK_ENABLED ? "턴제 물리 배틀 · 2~10명" : "준비 중 (곧 공개)"}</div>
        </button>
        <button
          className={`game-card${g === "chess" ? " active" : ""}`}
          onClick={() => selectGame("chess")}
        >
          <div className="game-emoji">♛♚</div>
          <div className="game-title">집단지성 체스</div>
          <div className="game-sub">팀 투표로 두는 체스 · 팀당 2~50명</div>
        </button>
      </div>

      <div className="home-buttons">
        <button className="big primary" onClick={() => setScreen("create")}>
          🛠️ 방 만들기
        </button>
        <button className="big" onClick={() => setScreen("joinCode")}>
          🔑 방 참여하기 (코드)
        </button>
        <button className="big" onClick={() => setScreen("find")}>
          🔍 방 찾기
        </button>
      </div>
    </div>
  );
}
