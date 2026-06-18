import { useEffect, useState } from "react";
import { useGame } from "../state/store";
import type { RoomBrief } from "../types";

export default function FindRooms() {
  const { state, send, setScreen } = useGame();
  const [query, setQuery] = useState("");
  const [nickname, setNickname] = useState("");
  const [selected, setSelected] = useState<RoomBrief | null>(null);
  const [password, setPassword] = useState("");

  function refresh(q = query) {
    send({ type: "ListRooms", query: q.trim() || null });
  }

  useEffect(() => {
    refresh("");
    const id = setInterval(() => refresh(query), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function join() {
    if (!selected) return;
    send({
      type: "JoinBySearch",
      code: selected.code,
      nickname: nickname.trim() || "익명",
      password: selected.has_password ? password : null,
    });
  }

  return (
    <div className="card form-card wide">
      <button className="back" onClick={() => setScreen("home")}>← 뒤로</button>
      <h2>방 찾기</h2>
      <div className="find-top">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="방 이름 검색…"
        />
        <button onClick={() => refresh()}>새로고침</button>
      </div>
      <label className="nick-field">
        내 닉네임
        <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="익명" />
      </label>

      <div className="room-list">
        {(() => {
          const list = state.roomList.filter((r) => (r.game || "omok") === state.selectedGame);
          if (list.length === 0) return <div className="empty">열린 방이 없습니다.</div>;
          return list.map((r) => {
            const flick = r.game === "flick";
            const chess = r.game === "chess";
            return (
              <div
                key={r.code}
                className={`room-item${selected?.code === r.code ? " sel" : ""}`}
                onClick={() => {
                  setSelected(r);
                  setPassword("");
                }}
              >
                <span className="room-name">
                  {r.has_password ? "🔒 " : ""}
                  {flick ? "🌀 " : chess ? "♛ " : r.mode === "team" ? "🤝 " : ""}
                  {r.name}
                </span>
                <span className="room-meta">
                  {chess
                    ? `집단지성 체스 · ${r.players}명`
                    : flick
                      ? `알까기 · ${r.players}/${r.max_players}명`
                      : r.mode === "team"
                        ? `팀전 · ${r.players}명`
                        : `${r.players}/${r.max_players}명 · ${r.board_size}×${r.board_size} · ${r.win_length}목`}{" "}
                  · {r.status === "playing" ? "게임중" : "대기중"}
                </span>
              </div>
            );
          });
        })()}
      </div>

      {selected && (
        <div className="join-panel">
          <div>
            <b>{selected.name}</b> 입장
          </div>
          {selected.has_password && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
            />
          )}
          <button
            className="primary"
            disabled={selected.status === "playing" || selected.players >= selected.max_players}
            onClick={join}
          >
            {selected.status === "playing"
              ? "입장 불가 (게임 진행 중)"
              : selected.players >= selected.max_players
                ? "방이 가득 참"
                : "입장"}
          </button>
        </div>
      )}
    </div>
  );
}
