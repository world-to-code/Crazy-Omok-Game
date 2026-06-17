import { useEffect, useState } from "react";
import { useGame } from "../state/store";
import { TEAM_NAMES, playerColor } from "../types";
import PlayerList from "../components/PlayerList";
import Chat from "../components/Chat";
import SettingsEditor from "../components/SettingsEditor";
import InviteLink from "../components/InviteLink";
import TeamAssign from "../components/TeamAssign";
import { copyText } from "../util/clipboard";

export default function Lobby() {
  const { state, send, leave } = useGame();
  const { settings, players, myId, status, mode } = state;
  const isHost = settings?.host_id === myId;
  const isTeam = mode === "team";

  const [orderMode, setOrderMode] = useState<"random" | "manual">("random");
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [firstTeam, setFirstTeam] = useState<"random" | 0 | 1>("random");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setManualOrder((prev) => {
      const ids = players.map((p) => p.id);
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [players]);

  function move(i: number, dir: -1 | 1) {
    setManualOrder((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const team0 = players.filter((p) => p.team === 0 && p.connected).length;
  const team1 = players.filter((p) => p.team === 1 && p.connected).length;
  const canStartTeam = team0 >= 1 && team1 >= 1;
  const canStartClassic = players.length >= 2;

  function start() {
    if (isTeam) {
      if (firstTeam === "random") send({ type: "StartGame", random: true, order: [], first_team: null });
      else send({ type: "StartGame", random: false, order: [], first_team: firstTeam });
    } else if (orderMode === "random") {
      send({ type: "StartGame", random: true, order: [], first_team: null });
    } else {
      send({ type: "StartGame", random: false, order: manualOrder, first_team: null });
    }
  }

  if (!settings) return null;

  return (
    <div className="lobby">
      <div className="lobby-main card">
        <button className="back" onClick={leave}>← 방 나가기</button>
        <h2>
          {settings.name} {isTeam && <span className="mode-pill">🤝 팀전</span>}
        </h2>
        <div className="code-box">
          <span>방 코드</span>
          <strong>{settings.code}</strong>
          <button onClick={() => copyText(settings.code)}>복사</button>
        </div>
        <InviteLink />
        <div className="settings-summary">
          {settings.board_size}×{settings.board_size} 보드 · {settings.win_length}목 승리 ·{" "}
          차례당 {settings.turn_limit_secs}초 · {isTeam ? "팀전(인원 무제한)" : `최대 ${settings.max_players}명`}{" "}
          {settings.has_password ? "· 🔒 비밀방" : ""}
          {isHost && (
            <button className="edit-toggle" onClick={() => setEditing((v) => !v)}>
              {editing ? "닫기" : "⚙️ 설정 수정"}
            </button>
          )}
        </div>

        {isHost && editing && <SettingsEditor onSaved={() => setEditing(false)} />}

        {status === "finished" && <div className="banner">이전 게임이 종료되었습니다. 다시 시작할 수 있어요.</div>}

        {isTeam && <TeamAssign />}

        {isHost ? (
          <div className="host-controls">
            {isTeam ? (
              <>
                <h3>선공 팀</h3>
                <div className="order-mode">
                  <label>
                    <input type="radio" checked={firstTeam === "random"} onChange={() => setFirstTeam("random")} /> 랜덤
                  </label>
                  <label>
                    <input type="radio" checked={firstTeam === 0} onChange={() => setFirstTeam(0)} /> {TEAM_NAMES[0]} 선공
                  </label>
                  <label>
                    <input type="radio" checked={firstTeam === 1} onChange={() => setFirstTeam(1)} /> {TEAM_NAMES[1]} 선공
                  </label>
                </div>
                <button className="primary big" disabled={!canStartTeam} onClick={start}>
                  {!canStartTeam ? "양 팀에 1명 이상 필요" : status === "finished" ? "다시 시작" : "게임 시작"}
                </button>
              </>
            ) : (
              <>
                <h3>차례 순서</h3>
                <div className="order-mode">
                  <label>
                    <input type="radio" checked={orderMode === "random"} onChange={() => setOrderMode("random")} /> 랜덤
                  </label>
                  <label>
                    <input type="radio" checked={orderMode === "manual"} onChange={() => setOrderMode("manual")} /> 직접 지정
                  </label>
                </div>
                {orderMode === "manual" && (
                  <ol className="manual-order">
                    {manualOrder.map((id, i) => {
                      const p = players.find((pp) => pp.id === id);
                      if (!p) return null;
                      return (
                        <li key={id}>
                          <span className="color-dot" style={{ background: playerColor(p.color_index) }} />
                          {p.nickname}
                          <span className="ord-btns">
                            <button onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                            <button onClick={() => move(i, 1)} disabled={i === manualOrder.length - 1}>▼</button>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <button className="primary big" disabled={!canStartClassic} onClick={start}>
                  {!canStartClassic ? "2명 이상 필요" : status === "finished" ? "다시 시작" : "게임 시작"}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="waiting">방장이 게임을 시작하기를 기다리는 중…</div>
        )}
      </div>

      <div className="lobby-side">
        <PlayerList />
        <Chat />
      </div>
    </div>
  );
}
