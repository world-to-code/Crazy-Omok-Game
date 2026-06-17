import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";

export default function Chat() {
  const { state, send } = useGame();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.chat]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send({ type: "Chat", text: t });
    setText("");
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
          maxLength={500}
          placeholder="메시지 입력…"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">전송</button>
      </form>
    </div>
  );
}
