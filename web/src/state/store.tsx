import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  ChatLine,
  ClientMsg,
  PlayerInfo,
  RoomBrief,
  RoomSettings,
  ServerMsg,
} from "../types";

export type Screen = "home" | "create" | "joinCode" | "find" | "lobby" | "game" | "joinLink";

export interface GameState {
  connected: boolean;
  screen: Screen;
  myId: string | null;
  code: string | null;
  settings: RoomSettings | null;
  players: PlayerInfo[];
  order: string[];
  board: Map<string, number>;
  status: string;
  mode: string;
  currentTurn: string | null;
  currentTeam: number | null;
  deadlineMs: number | null;
  winner: string | null;
  winningTeam: number | null;
  winningLine: Set<string>;
  lastMove: { x: number; y: number } | null;
  votes: Map<string, number>;
  voteVoters: number;
  voteVoted: number;
  roomList: RoomBrief[];
  chat: ChatLine[];
  error: string | null;
  linkCode: string | null;
}

const initial: GameState = {
  connected: false,
  screen: "home",
  myId: null,
  code: null,
  settings: null,
  players: [],
  order: [],
  board: new Map(),
  status: "lobby",
  mode: "classic",
  currentTurn: null,
  currentTeam: null,
  deadlineMs: null,
  winner: null,
  winningTeam: null,
  winningLine: new Set(),
  lastMove: null,
  votes: new Map(),
  voteVoters: 0,
  voteVoted: 0,
  roomList: [],
  chat: [],
  error: null,
  linkCode: null,
};

const key = (x: number, y: number) => `${x},${y}`;

type Action =
  | { kind: "msg"; msg: ServerMsg }
  | { kind: "connected"; value: boolean }
  | { kind: "screen"; screen: Screen }
  | { kind: "linkJoin"; code: string }
  | { kind: "clearError" }
  | { kind: "reset" };

function reducer(s: GameState, a: Action): GameState {
  switch (a.kind) {
    case "connected":
      return { ...s, connected: a.value };
    case "screen":
      return { ...s, screen: a.screen };
    case "linkJoin":
      return { ...s, screen: "joinLink", linkCode: a.code };
    case "clearError":
      return { ...s, error: null };
    case "reset":
      return { ...initial, connected: s.connected, screen: "home", roomList: s.roomList };
    case "msg":
      return applyMsg(s, a.msg);
  }
}

// 방을 떠난 뒤(code=null) 뒤늦게 도착하는 방 메시지는 무시 — 화면이 다시 게임으로 튀는 것 방지.
const IN_ROOM_MSGS = new Set([
  "Snapshot",
  "GameStarted",
  "TeamTurn",
  "StonePlaced",
  "TurnChanged",
  "VoteUpdate",
  "GameOver",
  "Chat",
]);

function applyMsg(s: GameState, m: ServerMsg): GameState {
  if (s.code == null && IN_ROOM_MSGS.has(m.type)) return s;
  switch (m.type) {
    case "RoomCreated":
      return { ...s, code: m.code };
    case "RoomList":
      return { ...s, roomList: m.rooms };
    case "Joined":
      saveSession(m.code, m.player_id);
      return { ...s, myId: m.player_id, code: m.code };
    case "Snapshot": {
      const board = new Map<string, number>();
      for (const st of m.board) board.set(key(st.x, st.y), st.color);
      const winningLine = new Set(m.winning_line.map(([x, y]) => key(x, y)));
      const screen: Screen = m.status === "lobby" ? "lobby" : "game";
      return {
        ...s,
        settings: m.settings,
        mode: m.settings.mode,
        players: m.players,
        order: m.order,
        board,
        status: m.status,
        currentTurn: m.current_turn,
        currentTeam: m.current_team,
        deadlineMs: m.deadline_ms,
        winner: m.winner,
        winningTeam: m.winning_team,
        winningLine,
        lastMove: null,
        votes: new Map(),
        voteVoters: 0,
        voteVoted: 0,
        screen,
        code: m.settings.code,
      };
    }
    case "GameStarted":
      return {
        ...s,
        status: "playing",
        order: m.order,
        currentTurn: m.current_turn,
        deadlineMs: m.deadline_ms,
        winner: null,
        winningLine: new Set(),
        lastMove: null,
        screen: "game",
      };
    case "StonePlaced": {
      const board = new Map(s.board);
      board.set(key(m.x, m.y), m.color);
      // 팀전: 착수 후 투표 표시 초기화.
      return {
        ...s,
        board,
        lastMove: { x: m.x, y: m.y },
        votes: new Map(),
        voteVoters: 0,
        voteVoted: 0,
      };
    }
    case "TurnChanged":
      return { ...s, currentTurn: m.current_turn, deadlineMs: m.deadline_ms };
    case "TeamTurn":
      return {
        ...s,
        status: "playing",
        currentTeam: m.team,
        deadlineMs: m.deadline_ms,
        winner: null,
        winningTeam: null,
        winningLine: new Set(),
        votes: new Map(),
        voteVoters: 0,
        voteVoted: 0,
        screen: "game",
      };
    case "VoteUpdate": {
      const votes = new Map<string, number>();
      for (const c of m.tallies) votes.set(key(c.x, c.y), c.count);
      return { ...s, votes, voteVoters: m.voters, voteVoted: m.voted };
    }
    case "GameOver":
      return {
        ...s,
        status: "finished",
        winner: m.winner,
        winningTeam: m.winning_team,
        winningLine: new Set(m.winning_line.map(([x, y]) => key(x, y))),
        currentTurn: null,
        currentTeam: null,
        deadlineMs: null,
        votes: new Map(),
      };
    case "Chat":
      return {
        ...s,
        chat: [
          ...s.chat,
          {
            from_id: m.from_id,
            from_name: m.from_name,
            text: m.text,
            ts_ms: m.ts_ms,
          },
        ].slice(-200),
      };
    case "Error":
      return { ...s, error: m.message };
  }
}

function saveSession(code: string, playerId: string) {
  try {
    localStorage.setItem("omok_session", JSON.stringify({ code, playerId }));
  } catch {
    // ignore
  }
}
function loadSession(): { code: string; playerId: string } | null {
  try {
    const raw = localStorage.getItem("omok_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    localStorage.removeItem("omok_session");
  } catch {
    // ignore
  }
}

interface Ctx {
  state: GameState;
  send: (m: ClientMsg) => void;
  setScreen: (s: Screen) => void;
  clearError: () => void;
  leave: () => void;
}

const GameContext = createContext<Ctx | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);

  const send = (m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  useEffect(() => {
    // 초대 링크(?join=CODE)로 들어온 경우: 코드 입장 화면으로, 기존 세션 재접속은 건너뜀.
    const linkCode = new URLSearchParams(location.search).get("join");
    if (linkCode) {
      clearSession();
      dispatch({ kind: "linkJoin", code: linkCode.toUpperCase() });
      // URL에서 쿼리 제거 (새로고침/이탈 시 자동 재참가 방지)
      history.replaceState(null, "", location.pathname);
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      dispatch({ kind: "connected", value: true });
      if (linkCode) return; // 링크 입장은 닉네임 입력 후 수동 참가
      const sess = loadSession();
      if (sess) {
        ws.send(JSON.stringify({ type: "Reconnect", code: sess.code, player_id: sess.playerId }));
      }
    };
    ws.onclose = () => dispatch({ kind: "connected", value: false });
    ws.onmessage = (ev) => {
      try {
        const msg: ServerMsg = JSON.parse(ev.data);
        dispatch({ kind: "msg", msg });
      } catch {
        // ignore malformed
      }
    };

    return () => ws.close();
  }, []);

  const leave = () => {
    send({ type: "LeaveRoom" });
    clearSession();
    dispatch({ kind: "reset" });
  };

  const ctx: Ctx = {
    state,
    send,
    setScreen: (screen) => dispatch({ kind: "screen", screen }),
    clearError: () => dispatch({ kind: "clearError" }),
    leave,
  };

  return <GameContext.Provider value={ctx}>{children}</GameContext.Provider>;
}

export function useGame(): Ctx {
  const c = useContext(GameContext);
  if (!c) throw new Error("useGame must be used within GameProvider");
  return c;
}
