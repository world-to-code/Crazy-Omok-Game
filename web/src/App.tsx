import { useEffect } from "react";
import { useGame } from "./state/store";
import Home from "./views/Home";
import CreateRoom from "./views/CreateRoom";
import JoinByCode from "./views/JoinByCode";
import FindRooms from "./views/FindRooms";
import Lobby from "./views/Lobby";
import Game from "./views/Game";
import JoinLink from "./views/JoinLink";

export default function App() {
  const { state, clearError } = useGame();

  // 에러 토스트 자동 사라짐.
  useEffect(() => {
    if (!state.error) return;
    const id = setTimeout(clearError, 3500);
    return () => clearTimeout(id);
  }, [state.error, clearError]);

  return (
    <div className="app">
      {!state.connected && <div className="conn-banner">서버에 연결 중…</div>}
      {state.error && (
        <div className="toast" onClick={clearError}>
          ⚠️ {state.error}
        </div>
      )}
      {render(state.screen)}
    </div>
  );
}

function render(screen: string) {
  switch (screen) {
    case "create":
      return <CreateRoom />;
    case "joinCode":
      return <JoinByCode />;
    case "find":
      return <FindRooms />;
    case "joinLink":
      return <JoinLink />;
    case "lobby":
      return <Lobby />;
    case "game":
      return <Game />;
    default:
      return <Home />;
  }
}
