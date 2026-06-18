import { useGame } from "../state/store";
import { TEAM_COLORS, TEAM_NAMES, resolvePlayerColor } from "../types";

export default function PlayerList() {
  const { state, send } = useGame();
  const { players, order, status, currentTurn, currentTeam, settings, myId, mode } = state;
  const iAmHost = settings?.host_id === myId;
  // 강퇴는 게임 진행 중이 아닐 때만.
  const canKick = iAmHost && status !== "playing";

  function kick(id: string) {
    send({ type: "KickPlayer", player_id: id });
  }

  if (mode === "team") {
    const groups: { team: number | null; label: string; bg: string }[] = [
      { team: 0, label: TEAM_NAMES[0], bg: TEAM_COLORS[0] },
      { team: 1, label: TEAM_NAMES[1], bg: TEAM_COLORS[1] },
    ];
    const unassigned = players.filter((p) => p.team == null);
    return (
      <div className="players">
        <div className="players-title">팀 ({players.length}명)</div>
        {groups.map((g) => {
          const members = players.filter((p) => p.team === g.team);
          const isTurn = status === "playing" && currentTeam === g.team;
          return (
            <div key={g.team} className={`team-group${isTurn ? " turn" : ""}`}>
              <div className="team-group-head" style={{ background: g.bg }}>
                {g.label} ({members.length}) {isTurn && <span className="tag turn-tag">차례</span>}
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
                      {canKick && p.id !== myId && (
                        <button className="kick-btn" onClick={() => kick(p.id)}>강퇴</button>
                      )}
                    </span>
                  </li>
                ))}
                {members.length === 0 && <li className="team-empty">비어 있음</li>}
              </ul>
            </div>
          );
        })}
        {unassigned.length > 0 && (
          <div className="team-group">
            <div className="team-group-head" style={{ background: "#6b7280" }}>
              미배정 ({unassigned.length})
            </div>
            <ul>
              {unassigned.map((p) => (
                <li key={p.id} className="player-row">
                  <span className="player-name">
                    {p.nickname}
                    {p.id === myId && " (나)"}
                    {p.ip && <span className="player-ip">{p.ip}</span>}
                  </span>
                  <span className="player-tags">
                    {canKick && p.id !== myId && (
                      <button className="kick-btn" onClick={() => kick(p.id)}>강퇴</button>
                    )}
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
              <span className="color-dot" style={{ background: resolvePlayerColor(p) }} />
              <span className="player-name">
                {p.nickname}
                {p.id === myId && " (나)"}
                {p.ip && <span className="player-ip">{p.ip}</span>}
              </span>
              <span className="player-tags">
                {isHost && <span className="tag host">방장</span>}
                {!p.connected && <span className="tag off">접속끊김</span>}
                {isTurn && <span className="tag turn-tag">차례</span>}
                {canKick && p.id !== myId && (
                  <button className="kick-btn" onClick={() => kick(p.id)}>강퇴</button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
