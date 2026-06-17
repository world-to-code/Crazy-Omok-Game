import { useState } from "react";
import { useGame } from "../state/store";

export default function JoinByCode() {
  const { send, setScreen } = useGame();
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    send({ type: "JoinByCode", code: c, nickname: nickname.trim() || "익명" });
  }

  return (
    <div className="card form-card">
      <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
      <h2>방 참여하기</h2>
      <p className="subtitle">방 코드로 입장하면 비밀번호가 필요 없습니다.</p>
      <form onSubmit={submit} className="form">
        <label>
          방 코드
          <input
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="예: ABC123"
            style={{ textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 700 }}
          />
        </label>
        <label>
          내 닉네임
          <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="익명" />
        </label>
        <button type="submit" className="primary big">입장</button>
      </form>
    </div>
  );
}
