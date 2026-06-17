import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";

const MAX_CHAT = 50;
const CHAT_COOLDOWN_MS = 500;

export default function Chat() {
  const { state, send } = useGame();
  const [text, setText] = useState("");
  const [cooling, setCooling] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.chat]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim().slice(0, MAX_CHAT);
    if (!t || cooling) return;
    send({ type: "Chat", text: t });
    setText("");
    // 0.5초 속도 제한 (서버에서도 강제)
    setCooling(true);
    setTimeout(() => setCooling(false), CHAT_COOLDOWN_MS);
  }

  return (
    <div className="chat">
      <div className="chat-title">채팅</div>
      <div className="chat-list" ref={listRef}>
        {state.chat.map((c, i) => (
          <div key={i} className={`chat-line${c.from_id === state.myId ? " mine" : ""}`}>
            <span className="chat-from">{c.from_name}</span>
            <span className="chat-text">{c.text}</span>
          </div>
        ))}
        {state.chat.length === 0 && <div className="chat-empty">아직 메시지가 없습니다.</div>}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          maxLength={MAX_CHAT}
          placeholder={`메시지 (최대 ${MAX_CHAT}자)`}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={cooling || !text.trim()}>전송</button>
      </form>
    </div>
  );
}
