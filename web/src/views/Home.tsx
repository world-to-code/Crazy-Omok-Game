import { useGame } from "../state/store";

export default function Home() {
  const { state, setScreen, selectGame } = useGame();
  const g = state.selectedGame;

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
          onClick={() => selectGame("flick")}
        >
          <div className="game-emoji">🌀💥</div>
          <div className="game-title">초능력 알까기</div>
          <div className="game-sub">턴제 물리 배틀 · 2~10명</div>
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
