import { useGame } from "../state/store";
import { COLORS, TEAM_COLORS, TEAM_NAMES } from "../types";
import Board from "../components/Board";
import Countdown from "../components/Countdown";
import PlayerList from "../components/PlayerList";
import Chat from "../components/Chat";

export default function Game() {
  const { state, leave, setScreen } = useGame();
  const { players, currentTurn, currentTeam, myId, status, winner, winningTeam, settings, mode } = state;
  const isTeam = mode === "team";

  const turnPlayer = players.find((p) => p.id === currentTurn);
  const myTeam = players.find((p) => p.id === myId)?.team ?? null;
  const myTurn = isTeam ? currentTeam != null && currentTeam === myTeam : currentTurn === myId;

  return (
    <div className="game">
      <div className="game-bar card">
        <button className="back" onClick={leave}>← 나가기</button>
        <div className="turn-info">
          {status === "playing" ? (
            isTeam && currentTeam != null ? (
              <span className={myTurn ? "turn-me" : ""}>
                <span className="color-dot" style={{ background: TEAM_COLORS[currentTeam] }} />
                {myTurn ? "우리 팀 차례 (투표)" : `${TEAM_NAMES[currentTeam]} 차례 (상대 팀이 수를 두는 중)`}
              </span>
            ) : turnPlayer ? (
              <span className={myTurn ? "turn-me" : ""}>
                <span className="color-dot" style={{ background: COLORS[turnPlayer.color_index] }} />
                {myTurn ? "내 차례" : `${turnPlayer.nickname} 님의 차례`}
              </span>
            ) : (
              <span>대기 중</span>
            )
          ) : status === "finished" ? (
            <span>게임 종료</span>
          ) : (
            <span>대기 중</span>
          )}
        </div>
        <Countdown deadlineMs={state.deadlineMs} />
        <div className="rule-info">{settings?.win_length}목 승리</div>
      </div>

      <div className="game-body">
        <div className="game-board">
          <Board />
          {isTeam && myTurn && <VotePanel />}
        </div>
        <div className="game-side">
          <PlayerList />
          <Chat />
        </div>
      </div>

      {status === "finished" && (
        <div className="overlay">
          <div className="overlay-card card">
            <h2>🏆 게임 종료</h2>
            {isTeam ? (
              winningTeam != null ? (
                <p>
                  <span className="color-dot" style={{ background: TEAM_COLORS[winningTeam] }} />
                  <b>{TEAM_NAMES[winningTeam]}</b> 승리!
                </p>
              ) : (
                <p>승부 없이 종료되었습니다.</p>
              )
            ) : winner ? (
              <p>
                <span
                  className="color-dot"
                  style={{ background: COLORS[players.find((p) => p.id === winner)?.color_index ?? 0] }}
                />
                <b>{players.find((p) => p.id === winner)?.nickname}</b> 님 승리!
              </p>
            ) : (
              <p>승자 없이 종료되었습니다.</p>
            )}
            <button className="primary big" onClick={() => setScreen("lobby")}>
              로비로 이동
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 우리 팀 차례에 후보 위치별 선택률을 순위로 보여준다.
function VotePanel() {
  const { state } = useGame();
  const { votes, voteVoters, voteVoted } = state;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const denom = Math.max(voteVoters, 1);

  return (
    <div className="vote-panel">
      <div className="vote-head">
        팀 투표 현황 <span className="vote-progress">{voteVoted}/{voteVoters} 명 선택</span>
      </div>
      {ranked.length === 0 ? (
        <div className="vote-empty">아직 아무도 선택하지 않았어요. 보드에서 원하는 자리를 클릭하세요.</div>
      ) : (
        <ul>
          {ranked.map(([k, count]) => {
            const [x, y] = k.split(",").map(Number);
            const pct = Math.round((count / denom) * 100);
            return (
              <li key={k}>
                <span className="vote-cell">({x}, {y})</span>
                <span className="vote-bar">
                  <span className="vote-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="vote-pct">{pct}%</span>
              </li>
            );
          })}
        </ul>
      )}
      <small>전원이 선택을 마치면 가장 표가 많은 자리에 돌이 놓입니다.</small>
    </div>
  );
}
