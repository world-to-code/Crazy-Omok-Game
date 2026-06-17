import { useGame } from "../state/store";
import { COLORS, COLOR_NAMES, TEAM_COLORS, TEAM_NAMES } from "../types";

export default function PlayerList() {
  const { state } = useGame();
  const { players, order, status, currentTurn, currentTeam, settings, myId, mode } = state;

  if (mode === "team") {
    return (
      <div className="players">
        <div className="players-title">팀 ({players.length}명)</div>
        {[0, 1].map((team) => {
          const members = players.filter((p) => p.team === team);
          const isTurn = status === "playing" && currentTeam === team;
          return (
            <div key={team} className={`team-group${isTurn ? " turn" : ""}`}>
              <div className="team-group-head" style={{ background: TEAM_COLORS[team] }}>
                {TEAM_NAMES[team]} ({members.length}) {isTurn && <span className="tag turn-tag">차례</span>}
              </div>
              <ul>
                {members.map((p) => (
                  <li key={p.id} className="player-row">
                    <span className="player-name">
                      {p.nickname}
                      {p.id === myId && " (나)"}
                      {p.ip && <span className="player-ip">{p.ip}</span>}
                    </span>
                    <span className="player-tags">
                      {settings?.host_id === p.id && <span className="tag host">방장</span>}
                      {!p.connected && <span className="tag off">접속끊김</span>}
                    </span>
                  </li>
                ))}
                {members.length === 0 && <li className="team-empty">비어 있음</li>}
              </ul>
            </div>
          );
        })}
        {players.some((p) => p.team == null) && (
          <div className="team-group">
            <div className="team-group-head" style={{ background: "#6b7280" }}>
              미배정 ({players.filter((p) => p.team == null).length})
            </div>
            <ul>
              {players
                .filter((p) => p.team == null)
                .map((p) => (
                  <li key={p.id} className="player-row">
                    <span className="player-name">
                      {p.nickname}
                      {p.id === myId && " (나)"}
                      {p.ip && <span className="player-ip">{p.ip}</span>}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const ordered =
    status !== "lobby" && order.length
      ? order.map((id) => players.find((p) => p.id === id)).filter(Boolean)
      : players;

  return (
    <div className="players">
      <div className="players-title">참가자 ({players.length}/{settings?.max_players ?? "-"})</div>
      <ul>
        {ordered.map((p, i) => {
          if (!p) return null;
          const isTurn = currentTurn === p.id;
          const isHost = settings?.host_id === p.id;
          return (
            <li key={p.id} className={`player-row${isTurn ? " turn" : ""}`}>
              {status !== "lobby" && <span className="turn-num">{i + 1}</span>}
              <span className="color-dot" style={{ background: COLORS[p.color_index] }} />
              <span className="player-name">
                {p.nickname}
                {p.id === myId && " (나)"}
                {p.ip && <span className="player-ip">{p.ip}</span>}
              </span>
              <span className="player-tags">
                <span className="color-name">{COLOR_NAMES[p.color_index]}</span>
                {isHost && <span className="tag host">방장</span>}
                {!p.connected && <span className="tag off">접속끊김</span>}
                {isTurn && <span className="tag turn-tag">차례</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
