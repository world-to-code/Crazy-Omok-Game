import { useEffect, useState } from "react";
import { useGame } from "../state/store";
import { TEAM_NAMES, resolvePlayerColor } from "../types";
import PlayerList from "../components/PlayerList";
import Chat from "../components/Chat";
import SettingsEditor from "../components/SettingsEditor";
import InviteLink from "../components/InviteLink";
import TeamAssign from "../components/TeamAssign";
import { copyText } from "../util/clipboard";
import { ZODIAC } from "../yut/zodiac";

export default function Lobby() {
  const { state, send, leave } = useGame();
  const { settings, players, myId, status, mode, game } = state;
  const isHost = settings?.host_id === myId;
  const isFlick = game === "flick";
  const isChess = game === "chess";
  const isYut = game === "yut";
  const isTeam = mode === "team" && !isFlick;

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
    if (isFlick) {
      send({ type: "StartGame", random: true, order: [], first_team: null });
      return;
    }
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
          {settings.name} {isChess ? <span className="mode-pill">♛ 집단지성 체스</span> : isTeam && <span className="mode-pill">🤝 팀전</span>}
          {isFlick && <span className="mode-pill">🌀 알까기</span>}
          {isYut && <span className="mode-pill">🎲 윷놀이</span>}
        </h2>
        <div className="code-box">
          <span>방 코드</span>
          <strong>{settings.code}</strong>
          <button onClick={() => copyText(settings.code)}>복사</button>
        </div>
        <InviteLink />
        <div className="settings-summary">
          {isChess ? (
            <>단계별 투표 {settings.turn_limit_secs}초 · 백 vs 흑 집단지성 </>
          ) : isFlick ? (
            <>조준 {settings.turn_limit_secs}초 · 최대 {settings.max_players}명 · 최후 1인 승리 </>
          ) : isYut ? (
            <>차례당 {settings.turn_limit_secs}초 · 최대 {settings.max_players}명 · 말 4개 완주 시 승리 </>
          ) : (
            <>
              {settings.board_size}×{settings.board_size} 보드 · {settings.win_length}목 승리 · 차례당{" "}
              {settings.turn_limit_secs}초 · {isTeam ? "팀전(인원 무제한)" : `최대 ${settings.max_players}명`}{" "}
            </>
          )}
          {settings.has_password ? "· 🔒 비밀방" : ""}
          {isHost && !isChess && !isYut && (
            <button className="edit-toggle" onClick={() => setEditing((v) => !v)}>
              {editing ? "닫기" : "⚙️ 설정 수정"}
            </button>
          )}
        </div>

        {isHost && editing && <SettingsEditor onSaved={() => setEditing(false)} />}

        {isYut ? <ZodiacPicker /> : !isTeam && <ColorPicker />}

        {status === "finished" && <div className="banner">이전 게임이 종료되었습니다. 다시 시작할 수 있어요.</div>}

        {isTeam && <TeamAssign />}

        {isHost ? (
          <div className="host-controls">
            {isFlick ? (
              <>
                <p className="hint">시작하면 각자 초능력 2개 중 1개를 고르고, 차례대로 알을 튕깁니다.</p>
                <button className="primary big" disabled={players.length < 2} onClick={start}>
                  {players.length < 2 ? "2명 이상 필요" : status === "finished" ? "다시 시작" : "게임 시작"}
                </button>
              </>
            ) : isChess ? (
              <>
                <p className="hint">백 팀(Team A)이 선공입니다. 매 턴 팀 투표로 기물과 이동을 결정합니다.</p>
                <button className="primary big" disabled={!canStartTeam} onClick={start}>
                  {!canStartTeam ? "양 팀에 1명 이상 필요" : status === "finished" ? "다시 시작" : "게임 시작"}
                </button>
              </>
            ) : isTeam ? (
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
                          <span className="color-dot" style={{ background: resolvePlayerColor(p) }} />
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

// 내 알/돌 색 자유 선택 (컬러 피커 + 빠른 추천색).
const QUICK_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#ffffff", "#94a3b8",
];

// (윷놀이) 내 12지신 선택. 이미 다른 사람이 고른 지신은 비활성.
function ZodiacPicker() {
  const { state, send } = useGame();
  const me = state.players.find((p) => p.id === state.myId);
  const taken = new Map<string, string>();
  for (const p of state.players) if (p.zodiac && p.id !== state.myId) taken.set(p.zodiac, p.nickname);
  return (
    <div className="color-picker">
      <div className="cp-label">🐯 내 캐릭터(12지신) — 하나 고르세요</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 8 }}>
        {ZODIAC.map((z) => {
          const mine = me?.zodiac === z.id;
          const by = taken.get(z.id);
          return (
            <button
              key={z.id}
              className={`game-card${mine ? " active" : ""}`}
              disabled={!!by}
              onClick={() => send({ type: "SetZodiac", zodiac: z.id })}
              style={{ padding: "8px 2px", opacity: by ? 0.4 : 1 }}
              title={by ? `${by} 선택됨` : z.name}
            >
              <div style={{ fontSize: 22, lineHeight: 1 }}>{z.emoji}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>{z.name}</div>
              {by && <div style={{ fontSize: 9, color: "#a99a86" }}>{by}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorPicker() {
  const { state, send } = useGame();
  const me = state.players.find((p) => p.id === state.myId);
  const current = me ? resolvePlayerColor(me) : "#ffffff";
  // <input type=color>는 #rrggbb만 받으므로 6자리로 정규화.
  const inputVal = /^#[0-9a-fA-F]{6}$/.test(current) ? current : "#ffffff";
  return (
    <div className="color-picker">
      <div className="cp-label">🎨 내 색 — 원하는 색을 직접 고르세요</div>
      <div className="cp-row">
        <input
          type="color"
          className="cp-input"
          value={inputVal}
          onChange={(e) => send({ type: "SetColor", color: e.target.value })}
          title="색을 클릭해서 고르기"
        />
        <span className="cp-current" style={{ background: current }} />
        <span className="cp-hex">{current}</span>
        <div className="cp-quick">
          {QUICK_COLORS.map((c) => (
            <button
              key={c}
              className="cp-sw"
              style={{ background: c }}
              title={c}
              onClick={() => send({ type: "SetColor", color: c })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
