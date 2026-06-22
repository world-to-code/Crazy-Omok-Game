import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  ChatLine,
  ChessPiece,
  ClientMsg,
  FlickEvent,
  FlickItem,
  FlickMarble,
  FlickObstacle,
  PlayerInfo,
  RoomBrief,
  RoomSettings,
  ServerMsg,
  YutPieceInfo,
  YutThrowInfo,
} from "../types";

export type Screen =
  | "home"
  | "create"
  | "joinCode"
  | "find"
  | "lobby"
  | "game"
  | "joinLink"
  | "botSetup"
  | "botGame";

// 봇전(로컬, 서버 없음) 설정.
export interface BotConfig {
  game: "omok" | "chess" | "checkers" | "yut" | "yacht";
  level: 0 | 1 | 2 | 3; // 쉬움 · 중간 · 어려움 · 헬
  humanFirst: boolean; // 오목=사람 흑(선), 체스/체커=사람이 선공
  zodiac?: string; // 윷놀이: 사람이 고른 12지신 id
}

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
  game: string; // 현재 방의 게임 ("omok" | "flick" | "chess" | "checkers" | "yut" | "yacht")
  selectedGame: "omok" | "flick" | "chess" | "checkers" | "yut" | "yacht"; // 메인에서 고른 게임
  bot: BotConfig | null; // 봇전 진행 중이면 설정
  // 체스
  chess: {
    board: (ChessPiece | null)[][];
    turn: string;
    phase: string;
    selected: [number, number] | null;
    options: [number, number][];
    lastMove: [[number, number], [number, number]] | null;
    history: string[];
    checkStatus: string;
    winner: string | null;
    currentTeam: number | null;
  } | null;
  chessTally: Map<string, number>; // "r,f" -> 표수 (내 팀 한정)
  // 알까기
  arenaR: number;
  marbles: FlickMarble[];
  obstacles: FlickObstacle[];
  items: FlickItem[];
  drafting: boolean;
  draftOptions: string[] | null;
  flickResolve: { ids: string[]; timeline: [number, number][][]; events: FlickEvent[]; seq: number } | null;
  // 재생이 끝나면 적용할 다음 차례 상태(돌이 멈춘 뒤 전환).
  flickPending: {
    marbles: FlickMarble[];
    items: FlickItem[];
    currentTurn: string | null;
    deadlineMs: number | null;
    status: string;
    winner: string | null;
  } | null;
  othersAim: { owner: string; angle: number; power: number } | null;
  // 윷놀이(멀티)
  yut: {
    pieces: YutPieceInfo[];
    order: string[];
    turn: string | null; // 현재 차례 플레이어 id
    phase: string; // throw | move | over
    queue: YutThrowInfo[];
    winner: string | null;
  } | null;
  // 애니메이션 트리거(던지기/이동). 컴포넌트가 seq 변화로 소비.
  yutEvent:
    | { seq: number; kind: "throw"; by: string; result: YutThrowInfo; power: number }
    | { seq: number; kind: "move"; by: string; throwIndex: number; key: string; route: string }
    | null;
  // 요트(주사위, 멀티)
  yacht: {
    order: string[];
    turn: string | null;
    dice: number[];
    keep: boolean[];
    rollsLeft: number;
    rolled: boolean;
    scores: (number | null)[][];
    phase: string; // roll | over
    winner: string | null;
  } | null;
  yachtEvent: { seq: number; by: string; dice: number[]; keep: boolean[]; firstRoll: boolean } | null;
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
  bot: null,
  chess: null,
  chessTally: new Map(),
  arenaR: 320,
  marbles: [],
  obstacles: [],
  items: [],
  drafting: false,
  draftOptions: null,
  flickResolve: null,
  flickPending: null,
  othersAim: null,
  yut: null,
  yutEvent: null,
  yacht: null,
  yachtEvent: null,
};

const key = (x: number, y: number) => `${x},${y}`;

// 상태에 따른 화면 결정.
// - 이미 방 안(로비/게임): 진행 중이면 게임, 그 외엔 현재 화면 유지(종료 후 로비에서 튕김 방지).
// - 처음 입장/재접속: 진행 중이면 게임, 그 외(대기/종료)는 로비로(새로 들어온 사람은 대기실).
function screenFor(status: string, current: Screen): Screen {
  if (status === "playing") return "game";
  if (status === "lobby") return "lobby"; // 로비 상태면 항상 로비(종료 후 되돌리기 포함)
  // 종료: 이미 방 안이면 종료 화면 유지, 새로 들어온 사람은 로비(대기실)
  return current === "lobby" || current === "game" ? current : "lobby";
}

type Action =
  | { kind: "msg"; msg: ServerMsg }
  | { kind: "connected"; value: boolean }
  | { kind: "screen"; screen: Screen }
  | { kind: "linkJoin"; code: string }
  | { kind: "selectGame"; game: "omok" | "flick" | "chess" | "checkers" | "yut" | "yacht" }
  | { kind: "startBot"; cfg: BotConfig }
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
    case "startBot":
      return { ...s, bot: a.cfg, screen: "botGame" };
    case "flickApply": {
      const p = s.flickPending;
      if (!p) return { ...s, flickResolve: null };
      return {
        ...s,
        marbles: p.marbles,
        items: p.items,
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
  "ChessSnapshot",
  "ChessVoteUpdate",
  "YutSnapshot",
  "YutThrown",
  "YutMoved",
  "YachtSnapshot",
  "YachtRolled",
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
        items: m.items,
        status: m.status,
        drafting: m.drafting,
        draftOptions: m.drafting ? s.draftOptions : null,
        currentTurn: m.current_turn,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
        winner: m.winner,
        othersAim: null,
        // 스냅샷이 최신 상태이므로 재생 대기 상태는 폐기(재접속/지연 시 되돌림 방지)
        flickResolve: null,
        flickPending: null,
        screen,
        code: m.settings.code,
      };
    }
    case "ChessSnapshot": {
      const screen = screenFor(m.status, s.screen);
      return {
        ...s,
        game: "chess",
        settings: m.settings,
        mode: m.settings.mode,
        players: m.players,
        status: m.status,
        currentTeam: m.current_team,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
        voteVoters: m.voters,
        voteVoted: m.voted,
        chess: {
          board: m.board,
          turn: m.turn,
          phase: m.phase,
          selected: m.selected,
          options: m.options,
          lastMove: m.last_move,
          history: m.history,
          checkStatus: m.check_status,
          winner: m.winner,
          currentTeam: m.current_team,
        },
        // 새 단계/스냅샷 → 내 집계 초기화(서버가 표를 비웠음)
        chessTally: new Map(),
        screen,
        code: m.settings.code,
      };
    }
    case "ChessVoteUpdate": {
      const t = new Map<string, number>();
      for (const c of m.tallies) t.set(`${c.r},${c.f}`, c.count);
      return { ...s, chessTally: t, voteVoters: m.voters, voteVoted: m.voted };
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
          items: m.items,
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
    case "YutSnapshot": {
      const screen = screenFor(m.status, s.screen);
      return {
        ...s,
        settings: m.settings,
        mode: m.settings.mode,
        game: "yut",
        players: m.players,
        order: m.order,
        status: m.status,
        currentTurn: m.current_turn,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
        winner: m.winner,
        screen,
        code: m.settings.code,
        yut: {
          pieces: m.pieces,
          order: m.order,
          turn: m.current_turn,
          phase: m.phase,
          queue: m.queue,
          winner: m.winner,
        },
      };
    }
    case "YutThrown":
      return {
        ...s,
        yutEvent: { seq: (s.yutEvent?.seq ?? 0) + 1, kind: "throw", by: m.by, result: m.result, power: m.power },
      };
    case "YutMoved":
      return {
        ...s,
        yutEvent: {
          seq: (s.yutEvent?.seq ?? 0) + 1,
          kind: "move",
          by: m.by,
          throwIndex: m.throw_index,
          key: m.key,
          route: m.route,
        },
      };
    case "YachtSnapshot": {
      const screen = screenFor(m.status, s.screen);
      return {
        ...s,
        settings: m.settings,
        mode: m.settings.mode,
        game: "yacht",
        players: m.players,
        order: m.order,
        status: m.status,
        currentTurn: m.current_turn,
        deadlineMs: toLocalDeadline(m.deadline_ms, m.server_now_ms),
        winner: m.winner,
        screen,
        code: m.settings.code,
        yacht: {
          order: m.order,
          turn: m.current_turn,
          dice: m.dice,
          keep: m.keep,
          rollsLeft: m.rolls_left,
          rolled: m.rolled,
          scores: m.scores,
          phase: m.phase,
          winner: m.winner,
        },
      };
    }
    case "YachtRolled":
      return {
        ...s,
        yachtEvent: { seq: (s.yachtEvent?.seq ?? 0) + 1, by: m.by, dice: m.dice, keep: m.keep, firstRoll: m.first_roll },
      };
  }
  return s;
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
  selectGame: (g: "omok" | "flick" | "chess" | "checkers" | "yut" | "yacht") => void;
  startBot: (cfg: BotConfig) => void;
  applyFlick: () => void;
  returnToLobby: () => void;
  clearError: () => void;
  leave: () => void;
}

const GameContext = createContext<Ctx | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  // 재접속(Reconnect) 시도 중인지. 실패하면 조용히 홈으로 보내기 위함.
  const reconnectPending = useRef(false);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

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

  const leave = useCallback(() => {
    send({ type: "LeaveRoom" });
    clearSession();
    dispatch({ kind: "reset" });
  }, [send]);

  // dispatch는 안정적이므로 콜백들도 안정적. ctx는 state가 바뀔 때만 새로 만든다.
  const setScreen = useCallback((screen: Screen) => dispatch({ kind: "screen", screen }), []);
  const selectGame = useCallback((game: "omok" | "flick" | "chess" | "checkers" | "yut" | "yacht") => dispatch({ kind: "selectGame", game }), []);
  const startBot = useCallback((cfg: BotConfig) => dispatch({ kind: "startBot", cfg }), []);
  const applyFlick = useCallback(() => dispatch({ kind: "flickApply" }), []);
  const returnToLobby = useCallback(() => send({ type: "ReturnToLobby" }), [send]);
  const clearError = useCallback(() => dispatch({ kind: "clearError" }), []);

  const ctx: Ctx = useMemo(
    () => ({ state, send, setScreen, selectGame, startBot, applyFlick, returnToLobby, clearError, leave }),
    [state, send, setScreen, selectGame, startBot, applyFlick, returnToLobby, clearError, leave],
  );

  return <GameContext.Provider value={ctx}>{children}</GameContext.Provider>;
}

export function useGame(): Ctx {
  const c = useContext(GameContext);
  if (!c) throw new Error("useGame must be used within GameProvider");
  return c;
}
