import { useGame } from "../state/store";

export default function Home() {
  const { setScreen } = useGame();
  return (
    <div className="home card">
      <h1>오목 대환장 파티 🎉</h1>
      <p className="subtitle">같은 WiFi 친구들과 최대 6명이 함께하는 실시간 오목</p>
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
