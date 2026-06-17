import { useEffect, useState } from "react";
import { useGame } from "../state/store";

const ALL_SIZES = [15, 19, 25, 30, 40, 60, 100];

function recommended(maxPlayers: number): number[] {
  if (maxPlayers <= 2) return [15, 19];
  if (maxPlayers <= 4) return [25, 30];
  if (maxPlayers <= 8) return [40, 60];
  return [60, 100];
}

export default function SettingsEditor() {
  const { state, send } = useGame();
  const { settings, players } = state;

  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [boardSize, setBoardSize] = useState(15);
  const [winLength, setWinLength] = useState(5);
  const [turnLimit, setTurnLimit] = useState(30);
  const [changePw, setChangePw] = useState(false);
  const [pw, setPw] = useState("");

  // 서버 설정이 바뀌면 폼을 동기화.
  useEffect(() => {
    if (!settings) return;
    setName(settings.name);
    setMaxPlayers(settings.max_players);
    setBoardSize(settings.board_size);
    setWinLength(settings.win_length);
    setTurnLimit(settings.turn_limit_secs);
    setChangePw(false);
    setPw("");
  }, [settings]);

  if (!settings) return null;

  const minPlayers = Math.max(2, players.length);
  const rec = recommended(maxPlayers);

  function save() {
    send({
      type: "UpdateSettings",
      name: name.trim() || "오목방",
      max_players: maxPlayers,
      board_size: boardSize,
      win_length: winLength,
      turn_limit_secs: turnLimit,
      password: changePw ? pw.trim() : null, // null=변경안함, ""=제거, 값=설정
    });
  }

  return (
    <div className="settings-editor">
      <div className="form">
        <label>
          방 이름
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          참가 인원: <b>{maxPlayers}명</b>
          {minPlayers > 2 && <small>현재 {players.length}명 — 그 이하로는 줄일 수 없어요</small>}
          <input
            type="range"
            min={minPlayers}
            max={20}
            value={Math.max(maxPlayers, minPlayers)}
            onChange={(e) => setMaxPlayers(+e.target.value)}
          />
        </label>
        <label>
          오목판 크기
          <select value={boardSize} onChange={(e) => setBoardSize(+e.target.value)}>
            {ALL_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}×{s}
                {rec.includes(s) ? " (추천)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          승리 길이(몇 목): <b>{winLength}목</b>
          <input type="range" min={3} max={10} value={winLength} onChange={(e) => setWinLength(+e.target.value)} />
        </label>
        <label>
          차례당 제한시간: <b>{turnLimit}초</b>
          <input type="range" min={5} max={120} step={5} value={turnLimit} onChange={(e) => setTurnLimit(+e.target.value)} />
        </label>
        <label className="pw-edit">
          <span className="pw-row">
            <input type="checkbox" checked={changePw} onChange={(e) => setChangePw(e.target.checked)} />
            비밀번호 변경 {settings.has_password ? "(현재: 🔒 설정됨)" : "(현재: 없음)"}
          </span>
          {changePw && (
            <input
              type="text"
              value={pw}
              maxLength={30}
              onChange={(e) => setPw(e.target.value)}
              placeholder="비워두면 비밀번호 제거"
            />
          )}
        </label>
        <button className="primary" onClick={save}>설정 저장</button>
      </div>
    </div>
  );
}
