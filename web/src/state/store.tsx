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
  FlickEvent,
  FlickMarble,
  FlickObstacle,
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
  // 게임 종류
  game: string; // 현재 방의 게임 ("omok" | "flick")
  selectedGame: "omok" | "flick"; // 메인에서 고른 게임
  // 알까기
  arenaR: number;
  marbles: FlickMarble[];
  obstacles: FlickObstacle[];
  drafting: boolean;
  draftOptions: string[] | null;
  flickResolve: { ids: string[]; timeline: [number, number][][]; events: FlickEvent[]; seq: number } | null;
  // 재생이 끝나면 적용할 다음 차례 상태(돌이 멈춘 뒤 전환).
  flickPending: {
    marbles: FlickMarble[];
    currentTurn: string | null;
    deadlineMs: number | null;
    status: string;
    winner: string | null;
  } | null;
  othersAim: { owner: string; angle: number; power: number } | null;
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
  game: "omok",
  selectedGame: "omok",
  arenaR: 320,
  marbles: [],
  obstacles: [],
  drafting: false,
  draftOptions: null,
  flickResolve: null,
  flickPending: null,
  othersAim: null,
};

const key = (x: number, y: number) => `${x},${y}`;

// 상태에 따른 화면 결정.
// - 이미 방 안(로비/게임): 진행 중이면 게임, 그 외엔 현재 화면 유지(종료 후 로비에서 튕김 방지).
// - 처음 입장/재접속: 진행 중이면 게임, 그 외(대기/종료)는 로비로(새로 들어온 사람은 대기실).
function screenFor(status: string, current: Screen): Screen {
  if (current === "lobby" || current === "game") {
    return status === "playing" ? "game" : current;
  }
  return status === "playing" ? "game" : "lobby";
}

type Action =
  | { kind: "msg"; msg: ServerMsg }
  | { kind: "connected"; value: boolean }
  | { kind: "screen"; screen: Screen }
  | { kind: "linkJoin"; code: string }
  | { kind: "selectGame"; game: "omok" | "flick" }
  | { kind: "flickApply" }
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
    case "selectGame":
      return { ...s, selectedGame: a.game };
    case "flickApply": {
      const p = s.flickPending;
      if (!p) return { ...s, flickResolve: null };
      return {
        ...s,
        marbles: p.marbles,
        currentTurn: p.currentTurn,
        deadlineMs: p.deadlineMs,
        status: p.status,
        winner: p.winner,
        flickResolve: null,
        flickPending: null,
        othersAim: null,
      };
    }
    case "clearError":
      return { ...s, error: null };
    case "reset":
      return {
        ...initial,
        connected: s.connected,
        screen: "home",
        roomList: s.roomList,
        selectedGame: s.selectedGame,
      };
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
  "FlickSnapshot",
  "FlickDraft",
  "FlickResolved",
  "FlickAiming",
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
      const screen = screenFor(m.status, s.screen);
      return {
        ...s,
        settings: m.settings,
        mode: m.settings.mode,
        game: "omok",
        players: m.players,
        order: m.order,
        board,
        status: m.status,
        currentTurn: m.current_turn,
        currentTeam: m.current_team,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
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
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
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
      return {
        ...s,
        currentTurn: m.current_turn,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
      };
    case "TeamTurn":
      return {
        ...s,
        status: "playing",
        currentTeam: m.team,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
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
    case "FlickSnapshot": {
      const screen = screenFor(m.status, s.screen);
      return {
        ...s,
        game: "flick",
        settings: m.settings,
        mode: m.settings.mode,
        players: m.players,
        arenaR: m.arena_r,
        marbles: m.marbles,
        obstacles: m.obstacles,
        status: m.status,
        drafting: m.drafting,
        draftOptions: m.drafting ? s.draftOptions : null,
        currentTurn: m.current_turn,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
        winner: m.winner,
        othersAim: null,
        screen,
        code: m.settings.code,
      };
    }
    case "FlickDraft":
      return { ...s, draftOptions: m.options };
    case "FlickAiming":
      return m.owner === s.myId
        ? s
        : { ...s, othersAim: { owner: m.owner, angle: m.angle, power: m.power } };
    case "FlickResolved":
      // 발사 모션 재생 동안엔 현재 상태(쏜 사람·기존 HP) 유지, 카운트다운 멈춤.
      // 재생이 끝나면 flickApply로 다음 차례를 적용한다(돌이 멈춘 뒤 전환).
      return {
        ...s,
        deadlineMs: null,
        othersAim: null,
        flickResolve: {
          ids: m.ids,
          timeline: m.timeline,
          events: m.events,
          seq: (s.flickResolve?.seq ?? 0) + 1,
        },
        flickPending: {
          marbles: m.marbles,
          currentTurn: m.current_turn,
          deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
          status: m.status,
          winner: m.winner,
        },
      };
    case "Error":
      return { ...s, error: m.message };
    case "Kicked":
      clearSession();
      return {
        ...initial,
        connected: s.connected,
        roomList: s.roomList,
        screen: "home",
        error: "방장에 의해 강퇴되었습니다",
      };
  }
}

// 서버 시각 기준 deadline을 로컬 시각 기준으로 변환 (시계 차이 보정).
function toLocalDeadline(deadlineMs: number | null, serverNowMs: number): number | null {
  if (deadlineMs == null) return null;
  return Date.now() + (deadlineMs - serverNowMs);
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
  selectGame: (g: "omok" | "flick") => void;
  applyFlick: () => void;
  clearError: () => void;
  leave: () => void;
}

const GameContext = createContext<Ctx | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  // 재접속(Reconnect) 시도 중인지. 실패하면 조용히 홈으로 보내기 위함.
  const reconnectPending = useRef(false);

  const send = (m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // 초대 링크(?join=CODE)가 있을 때만 링크 입장 화면으로. (그 외에는 일반 접속)
    const linkCode = new URLSearchParams(location.search).get("join");
    if (linkCode) {
      clearSession();
      dispatch({ kind: "linkJoin", code: linkCode.toUpperCase() });
      // URL에서 쿼리 제거 (새로고침/이탈 시 자동 재참가 방지)
      history.replaceState(null, "", location.pathname);
    }

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        dispatch({ kind: "connected", value: true });
        // 저장된 세션이 있으면 재접속 시도 (링크 입장 시에는 위에서 세션을 비웠으므로 보내지 않음).
        const sess = loadSession();
        if (sess) {
          reconnectPending.current = true;
          ws.send(JSON.stringify({ type: "Reconnect", code: sess.code, player_id: sess.playerId }));
        }
      };

      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        // 재접속 시도의 응답 처리:
        //  - 성공(Joined): 정상 진행
        //  - 실패(Error, 예: 방이 사라짐): 세션 정리 후 조용히 홈으로 (에러 모달 표시 안 함)
        if (reconnectPending.current) {
          if (msg.type === "Joined") {
            reconnectPending.current = false;
          } else if (msg.type === "Error") {
            reconnectPending.current = false;
            clearSession();
            dispatch({ kind: "reset" });
            return;
          }
        }
        dispatch({ kind: "msg", msg });
      };

      ws.onclose = () => {
        dispatch({ kind: "connected", value: false });
        reconnectPending.current = false;
        // 서버 재시작/네트워크 끊김 시 자동 재연결 (배포 후 새로고침 없이 복구).
        if (!stopped) {
          retryTimer = setTimeout(connect, 1500);
        }
      };
    };

    connect();

    // 같은 브라우저의 다른 탭에서 입장/퇴장하면 이 탭도 동기화.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "omok_session") return;
      const ws = wsRef.current;
      if (e.newValue) {
        // 다른 탭이 방에 입장 → 이 탭도 같은 자리로 재접속.
        try {
          const sess = JSON.parse(e.newValue);
          if (ws && ws.readyState === WebSocket.OPEN) {
            reconnectPending.current = true;
            ws.send(JSON.stringify({ type: "Reconnect", code: sess.code, player_id: sess.playerId }));
          }
        } catch {
          // ignore
        }
      } else {
        // 다른 탭이 나감 → 이 탭도 홈으로.
        dispatch({ kind: "reset" });
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      stopped = true;
      window.removeEventListener("storage", onStorage);
      if (retryTimer) clearTimeout(retryTimer);
      reconnectPending.current = false;
      wsRef.current?.close();
    };
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
    selectGame: (game) => dispatch({ kind: "selectGame", game }),
    applyFlick: () => dispatch({ kind: "flickApply" }),
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
