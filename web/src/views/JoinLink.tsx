import { useState } from "react";
import { useGame } from "../state/store";

// 초대 링크로 들어온 사람: 닉네임만 정하면 코드/비번 없이 바로 참가.
export default function JoinLink() {
  const { state, send, setScreen } = useGame();
  const [nickname, setNickname] = useState(() => `게스트${Math.floor(1000 + Math.random() * 9000)}`);
  const code = state.linkCode ?? "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    send({ type: "JoinByCode", code, nickname: nickname.trim() || "게스트" });
  }

  return (
    <div className="card form-card">
      <h2>초대 링크로 참가</h2>
      <p className="subtitle">
        방 <b style={{ letterSpacing: "0.15em" }}>{code}</b> 에 초대받았습니다. 닉네임만 정하면 바로 입장해요.
      </p>
      <form onSubmit={submit} className="form">
        <label>
          내 닉네임
          <input
            value={nickname}
            maxLength={20}
            autoFocus
            onChange={(e) => setNickname(e.target.value)}
            placeholder="게스트"
          />
        </label>
        <button type="submit" className="primary big">바로 입장</button>
        <button type="button" className="back" onClick={() => setScreen("home")}>
          취소하고 홈으로
        </button>
      </form>
    </div>
  );
}
