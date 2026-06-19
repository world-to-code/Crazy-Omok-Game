import { useEffect } from "react";
import { useGame } from "./state/store";
import Home from "./views/Home";
import CreateRoom from "./views/CreateRoom";
import JoinByCode from "./views/JoinByCode";
import FindRooms from "./views/FindRooms";
import Lobby from "./views/Lobby";
import Game from "./views/Game";
import FlickGame from "./views/FlickGame";
import ChessGame from "./views/ChessGame";
import JoinLink from "./views/JoinLink";
import BotSetup from "./views/BotSetup";
import BotOmok from "./views/BotOmok";
import BotChess from "./views/BotChess";
import BotCheckers from "./views/BotCheckers";

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
      {render(state.screen, state.game)}
    </div>
  );
}

function render(screen: string, game: string) {
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
      return game === "flick" ? <FlickGame /> : game === "chess" ? <ChessGame /> : <Game />;
    case "botSetup":
      return <BotSetup />;
    case "botGame":
      return <BotGameRouter />;
    default:
      return <Home />;
  }
}

function BotGameRouter() {
  const { state } = useGame();
  const g = state.bot?.game;
  if (g === "chess") return <BotChess />;
  if (g === "checkers") return <BotCheckers />;
  return <BotOmok />;
}
