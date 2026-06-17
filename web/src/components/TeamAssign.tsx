import { useGame } from "../state/store";
import { TEAM_COLORS, TEAM_NAMES } from "../types";
import type { PlayerInfo } from "../types";

// 팀 배정: 본인은 클릭으로 팀 이동, 방장은 드래그앤드롭으로 누구든 이동.
export default function TeamAssign() {
  const { state, send } = useGame();
  const { players, settings, myId } = state;
  const isHost = settings?.host_id === myId;

  const pool = players.filter((p) => p.team == null);
  const team0 = players.filter((p) => p.team === 0);
  const team1 = players.filter((p) => p.team === 1);

  function onDrop(team: number | null, e: React.DragEvent) {
    e.preventDefault();
    const pid = e.dataTransfer.getData("text/plain");
    if (pid) send({ type: "AssignTeam", player_id: pid, team });
  }

  function Chip({ p }: { p: PlayerInfo }) {
    return (
      <div
        className={`team-chip${p.id === myId ? " mine" : ""}${p.connected ? "" : " off"}`}
        draggable={isHost}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
        title={isHost ? "드래그해서 팀 이동" : undefined}
      >
        {p.nickname}
        {p.id === myId && " (나)"}
        {settings?.host_id === p.id && " 👑"}
        {!p.connected && " (끊김)"}
      </div>
    );
  }

  function Column({ team, list }: { team: number | null; list: PlayerInfo[] }) {
    const isPool = team == null;
    const color = isPool ? "#6b7280" : TEAM_COLORS[team];
    const title = isPool ? "미배정" : TEAM_NAMES[team];
    return (
      <div className="team-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(team, e)}>
        <div className="team-col-head" style={{ background: color }}>
          {title} <span className="cnt">{list.length}</span>
        </div>
        <button className="team-join-btn" onClick={() => send({ type: "JoinTeam", team })}>
          {isPool ? "나가기(미배정)" : "여기로 이동"}
        </button>
        <div className="team-members">
          {list.map((p) => (
            <Chip key={p.id} p={p} />
          ))}
          {list.length === 0 && <div className="team-empty">비어 있음</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="team-assign">
      <p className="hint">
        팀을 클릭해 직접 이동할 수 있어요.{isHost && " 방장은 닉네임을 드래그해서 다른 팀으로 옮길 수 있습니다."}
      </p>
      <div className="team-cols">
        <Column team={0} list={team0} />
        <Column team={1} list={team1} />
        <Column team={null} list={pool} />
      </div>
    </div>
  );
}
