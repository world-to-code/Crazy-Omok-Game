import { useState } from "react";
import { useGame } from "../state/store";

const ALL_SIZES = [15, 19, 25, 30, 40, 60, 100];

// 인원수별 권장 보드 크기.
function recommended(maxPlayers: number): number[] {
  if (maxPlayers <= 2) return [15, 19];
  if (maxPlayers <= 4) return [25, 30];
  if (maxPlayers <= 8) return [40, 60];
  return [60, 100];
}

export default function CreateRoom() {
  const { state, send, setScreen } = useGame();
  const isFlick = state.selectedGame === "flick";
  const isChess = state.selectedGame === "chess";
  const isYut = state.selectedGame === "yut";
  const isYacht = state.selectedGame === "yacht";
  const [mode, setMode] = useState<"classic" | "team">("classic");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(isFlick ? 4 : 2);
  const [boardSize, setBoardSize] = useState(15);
  const [winLength, setWinLength] = useState(5);
  const [turnLimit, setTurnLimit] = useState(isFlick ? 20 : 30);
  const [password, setPassword] = useState("");

  const rec = mode === "team" ? [25, 40, 60] : recommended(maxPlayers);

  function setPlayers(n: number) {
    setMaxPlayers(n);
    const r = recommended(n);
    if (!r.includes(boardSize)) setBoardSize(r[0]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    send({
      type: "CreateRoom",
      name:
        name.trim() ||
        (isChess ? "집단지성 체스" : isFlick ? "알까기방" : isYut ? "윷놀이방" : isYacht ? "요트방" : "오목방"),
      nickname: nickname.trim() || "방장",
      max_players: maxPlayers,
      board_size: boardSize,
      win_length: winLength,
      turn_limit_secs: turnLimit,
      password: password.trim() ? password.trim() : null,
      mode,
      game: state.selectedGame,
    });
  }

  // ===== 집단지성 체스 방 만들기 =====
  if (isChess) {
    return (
      <div className="card form-card">
        <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
        <h2>♛ 집단지성 체스 방 만들기</h2>
        <form onSubmit={submit} className="form">
          <label>
            내 닉네임
            <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="방장" />
          </label>
          <label>
            방 이름
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="집단지성 한 판" />
          </label>
          <div className="team-note">
            두 팀(백·흑)으로 나뉘어, 매 턴 <b>① 움직일 기물 → ② 이동 위치</b>를 팀 투표로 결정합니다.
            팀 배정은 로비에서 합니다.
          </div>
          <label>
            단계별 투표 시간: <b>{turnLimit}초</b>
            <input type="range" min={5} max={60} step={5} value={turnLimit} onChange={(e) => setTurnLimit(+e.target.value)} />
            <small>기물 선택과 이동 선택 각 단계에 적용됩니다.</small>
          </label>
          <label>
            비밀번호 (선택)
            <input value={password} maxLength={30} onChange={(e) => setPassword(e.target.value)} placeholder="없으면 비워두세요" />
          </label>
          <button type="submit" className="primary big">방 만들기</button>
        </form>
      </div>
    );
  }

  // ===== 요트(주사위) 방 만들기 =====
  if (isYacht) {
    return (
      <div className="card form-card">
        <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
        <h2>🎲 요트 방 만들기</h2>
        <form onSubmit={submit} className="form">
          <label>
            내 닉네임
            <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="방장" />
          </label>
          <label>
            방 이름
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="요트방" />
          </label>
          <label>
            참가 인원: <b>{Math.min(maxPlayers, 5)}명</b>
            <input type="range" min={2} max={5} value={Math.min(maxPlayers, 5)} onChange={(e) => setMaxPlayers(+e.target.value)} />
            <small>2~5인. 컵을 흔들어 주사위 5개를 굴리고(한 턴 3번), 12족보 총점 최고가 승리!</small>
          </label>
          <label>
            차례당 제한시간: <b>{turnLimit}초</b>
            <input type="range" min={15} max={120} step={5} value={turnLimit} onChange={(e) => setTurnLimit(+e.target.value)} />
          </label>
          <label>
            비밀번호 (선택)
            <input value={password} maxLength={30} onChange={(e) => setPassword(e.target.value)} placeholder="없으면 비워두세요" />
          </label>
          <button type="submit" className="primary big">방 만들기</button>
        </form>
      </div>
    );
  }

  // ===== 윷놀이 방 만들기 =====
  if (isYut) {
    return (
      <div className="card form-card">
        <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
        <h2>🎲 윷놀이 방 만들기</h2>
        <form onSubmit={submit} className="form">
          <label>
            내 닉네임
            <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="방장" />
          </label>
          <label>
            방 이름
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="윷놀이방" />
          </label>
          <label>
            참가 인원: <b>{Math.min(maxPlayers, 5)}명</b>
            <input
              type="range"
              min={2}
              max={5}
              value={Math.min(maxPlayers, 5)}
              onChange={(e) => setMaxPlayers(+e.target.value)}
            />
            <small>2~5인 개인전. 순서대로 윷을 던져 말 4개를 먼저 모두 완주시키면 승리! 12지신은 로비에서 고릅니다.</small>
          </label>
          <label>
            차례당 제한시간: <b>{turnLimit}초</b>
            <input type="range" min={10} max={120} step={5} value={turnLimit} onChange={(e) => setTurnLimit(+e.target.value)} />
          </label>
          <label>
            비밀번호 (선택)
            <input value={password} maxLength={30} onChange={(e) => setPassword(e.target.value)} placeholder="없으면 비워두세요" />
          </label>
          <button type="submit" className="primary big">방 만들기</button>
        </form>
      </div>
    );
  }

  // ===== 알까기 방 만들기 =====
  if (isFlick) {
    return (
      <div className="card form-card">
        <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
        <h2>🌀 알까기 방 만들기</h2>
        <form onSubmit={submit} className="form">
          <label>
            내 닉네임
            <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="방장" />
          </label>
          <label>
            방 이름
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="알까기방" />
          </label>
          <label>
            참가 인원: <b>{maxPlayers}명</b>
            <input type="range" min={2} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(+e.target.value)} />
            <small>시작 시 초능력 2개 중 1개를 골라 알까기로 겨룹니다. 최후 1인 승리!</small>
          </label>
          <label>
            조준 제한시간: <b>{turnLimit}초</b>
            <input type="range" min={5} max={60} step={5} value={turnLimit} onChange={(e) => setTurnLimit(+e.target.value)} />
          </label>
          <label>
            비밀번호 (선택)
            <input value={password} maxLength={30} onChange={(e) => setPassword(e.target.value)} placeholder="없으면 비워두세요" />
          </label>
          <button type="submit" className="primary big">방 만들기</button>
        </form>
      </div>
    );
  }

  return (
    <div className="card form-card">
      <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
      <h2>방 만들기</h2>
      <form onSubmit={submit} className="form">
        <div className="mode-select">
          <button
            type="button"
            className={`mode-btn${mode === "classic" ? " active" : ""}`}
            onClick={() => setMode("classic")}
          >
            🎯 클래식
            <small>개인전 (2~6명, 한 명씩 착수)</small>
          </button>
          <button
            type="button"
            className={`mode-btn${mode === "team" ? " active" : ""}`}
            onClick={() => setMode("team")}
          >
            🤝 팀전
            <small>2팀 집단지성 투표 (인원 무제한)</small>
          </button>
        </div>
        <label>
          내 닉네임
          <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="방장" />
        </label>
        <label>
          방 이름
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="오목방" />
        </label>
        {mode === "classic" ? (
          <label>
            참가 인원: <b>{maxPlayers}명</b>
            <input type="range" min={2} max={20} value={maxPlayers} onChange={(e) => setPlayers(+e.target.value)} />
            <small>방장은 흰색, 나머지는 색이 랜덤 배정됩니다.</small>
          </label>
        ) : (
          <div className="team-note">
            팀전은 <b>인원 제한 없이</b> 두 팀으로 나뉘어 진행됩니다. 팀 배정은 로비에서 합니다.
          </div>
        )}
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
          <small>
            {mode === "team" ? "팀전" : `${maxPlayers}명`} 추천: {rec.map((s) => `${s}×${s}`).join(", ")}
          </small>
        </label>
        <label>
          승리 길이(몇 목): <b>{winLength}목</b>
          <input type="range" min={3} max={10} value={winLength} onChange={(e) => setWinLength(+e.target.value)} />
        </label>
        <label>
          차례당 제한시간: <b>{turnLimit}초</b>
          <input type="range" min={5} max={120} step={5} value={turnLimit} onChange={(e) => setTurnLimit(+e.target.value)} />
        </label>
        <label>
          비밀번호 (선택)
          <input value={password} maxLength={30} onChange={(e) => setPassword(e.target.value)} placeholder="없으면 비워두세요" />
        </label>
        <button type="submit" className="primary big">방 만들기</button>
      </form>
    </div>
  );
}
