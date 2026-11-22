import { useEffect } from "react";
import { useGame } from "../state/store";
import { FLICK_ENABLED, STATIC_MODE } from "../config";

export default function Home() {
  const { state, setScreen, selectGame } = useGame();
  const g = state.selectedGame;

  // 알까기가 비활성화된 빌드에서 혹시 선택돼 있으면 오목으로 되돌림.
  useEffect(() => {
    if ((!FLICK_ENABLED || STATIC_MODE) && g === "flick") selectGame("omok");
  }, [g, selectGame]);

  return (
    <div className="home card">
      {STATIC_MODE && (
        <a className="back" href="../">
          ← 포트폴리오로
        </a>
      )}
      <h1>🎮 미니게임 천국</h1>
      <p className="subtitle">
        {STATIC_MODE
          ? "Rust·WebAssembly 봇과 한 판, 서버 없이 브라우저에서"
          : "친구들과 함께 — 오목 · 알까기 · 집단지성 체스"}
      </p>

      <div className="game-pick">
        <button
          className={`game-card${g === "omok" ? " active" : ""}`}
          onClick={() => selectGame("omok")}
        >
          <div className="game-emoji">⚫️⚪️</div>
          <div className="game-title">오목</div>
          <div className="game-sub">{STATIC_MODE ? "먼저 다섯 개를 잇는 쪽이 승리" : "클래식/팀전 · 2~20명"}</div>
        </button>
        {!STATIC_MODE && (<button
          className={`game-card${g === "flick" ? " active" : ""}`}
          disabled={!FLICK_ENABLED}
          onClick={() => FLICK_ENABLED && selectGame("flick")}
        >
          <div className="game-emoji">🌀💥</div>
          <div className="game-title">초능력 알까기 {!FLICK_ENABLED && "🔒"}</div>
          <div className="game-sub">{FLICK_ENABLED ? "턴제 물리 배틀 · 2~10명" : "준비 중 (곧 공개)"}</div>
        </button>)}
        <button
          className={`game-card${g === "chess" ? " active" : ""}`}
          onClick={() => selectGame("chess")}
        >
          <div className="game-emoji">♛♚</div>
          <div className="game-title">{STATIC_MODE ? "체스" : "집단지성 체스"}</div>
          <div className="game-sub">{STATIC_MODE ? "알파베타 탐색 봇과 두는 체스" : "팀 투표로 두는 체스 · 팀당 2~50명"}</div>
        </button>
        <button
          className={`game-card${g === "checkers" ? " active" : ""}`}
          onClick={() => selectGame("checkers")}
        >
          <div className="game-emoji">⛀⛂</div>
          <div className="game-title">체커 (드래프트)</div>
          <div className="game-sub">대각선으로 뛰어넘어 잡는 보드게임</div>
        </button>
        <button
          className={`game-card${g === "yut" ? " active" : ""}`}
          onClick={() => selectGame("yut")}
        >
          <div className="game-emoji">🎲🐯</div>
          <div className="game-title">3D 윷놀이</div>
          <div className="game-sub">12지신 캐릭터로 즐기는 인터랙티브 윷놀이</div>
        </button>
        <button
          className={`game-card${g === "yacht" ? " active" : ""}`}
          onClick={() => selectGame("yacht")}
        >
          <div className="game-emoji">🎲🥤</div>
          <div className="game-title">요트 (주사위)</div>
          <div className="game-sub">컵을 흔들어 주사위 5개를 굴리는 족보 게임</div>
        </button>
      </div>

      <div className="home-buttons">
        {g !== "flick" && (
          <button className="big primary" onClick={() => setScreen("botSetup")}>
            🤖 봇과 대결 ({g === "chess" ? "체스" : g === "checkers" ? "체커" : g === "yut" ? "윷놀이" : g === "yacht" ? "요트" : "오목"})
          </button>
        )}
        {!STATIC_MODE && (<>
        <button className="big" onClick={() => setScreen("create")}>
          🛠️ 방 만들기
        </button>
        <button className="big" onClick={() => setScreen("joinCode")}>
          🔑 방 참여하기 (코드)
        </button>
        <button className="big" onClick={() => setScreen("find")}>
          🔍 방 찾기
        </button>
        </>)}
      </div>
    </div>
  );
}
