// 서버 프로토콜과 1:1로 대응하는 타입.

// 참가자 색: 인덱스 0 = 방장(흰색), 그 외는 황금각(137.5°) 기반 HSL.
// 인덱스마다 색조가 충분히 벌어져 비슷한 색이 안 나오고, 같은 인덱스가 아니면
// 절대 같은 색이 나오지 않으며, 색 개수 제한도 없다.
export function playerColor(i: number): string {
  if (i <= 0) return "#ffffff"; // 방장
  const hue = ((i - 1) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 72%, 52%)`;
}

// 팀전: 팀별 색상/이름.
export const TEAM_COLORS = ["#1a1a1a", "#e63946"]; // 1팀 흑, 2팀 적
export const TEAM_NAMES = ["1팀", "2팀"];

export interface PlayerInfo {
  id: string;
  nickname: string;
  color_index: number;
  color: string | null; // 직접 고른 커스텀 색(hex). 없으면 color_index 기본색.
  connected: boolean;
  team: number | null;
  ip: string;
}

// 플레이어의 표시 색: 커스텀 색이 있으면 그것, 없으면 인덱스 기본색.
export function resolvePlayerColor(p: { color?: string | null; color_index: number }): string {
  return p.color || playerColor(p.color_index);
}
// color_index → 표시 색 (오목 돌 등 인덱스로만 식별되는 곳에서 사용).
export function colorForIndex(players: PlayerInfo[], idx: number): string {
  const p = players.find((pp) => pp.color_index === idx);
  return p ? resolvePlayerColor(p) : playerColor(idx);
}

export interface RoomSettings {
  code: string;
  name: string;
  has_password: boolean;
  max_players: number;
  board_size: number;
  win_length: number;
  turn_limit_secs: number;
  host_id: string;
  mode: string;
  game: string;
}

export interface RoomBrief {
  code: string;
  name: string;
  players: number;
  max_players: number;
  has_password: boolean;
  status: string;
  board_size: number;
  win_length: number;
  mode: string;
  game: string;
}

export interface VoteCell {
  x: number;
  y: number;
  count: number;
}

export interface FlickEvent {
  frame: number;
  x: number;
  y: number;
  kind: string; // "hit" | "ko" | "explode" | "spike" | "shield"
  amount: number; // 피해량(0이면 표시 안 함)
  owner: string; // 피해 입은 알(없으면 nil-uuid)
  hp: number; // 그 알의 남은 체력(없으면 -1)
}

export interface FlickItem {
  kind: string;
  x: number;
  y: number;
  r: number;
}

// 필드 아이템 10종 표시 정보
export const ITEM_INFO: Record<string, { name: string; emoji: string; color: string }> = {
  dmg_up: { name: "공격 +20%", emoji: "⚔️", color: "#f59e0b" },
  crit: { name: "치명타 2배", emoji: "💢", color: "#ef4444" },
  shield: { name: "보호막", emoji: "🛡️", color: "#7dd3fc" },
  atk: { name: "공격력 +1", emoji: "🗡️", color: "#fb7185" },
  def: { name: "방어력 +1", emoji: "🔰", color: "#60a5fa" },
  heal: { name: "체력 회복", emoji: "💚", color: "#4ade80" },
  maxhp: { name: "최대체력 +20", emoji: "❤️", color: "#f43f5e" },
  power: { name: "발사세기 +30%", emoji: "🚀", color: "#a78bfa" },
  lifesteal: { name: "흡혈", emoji: "🧛", color: "#c084fc" },
  explode: { name: "폭발탄", emoji: "💣", color: "#fb923c" },
};

export interface FlickObstacle {
  kind: string;
  shape: string; // "circle" | "rect"
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  dir: number;
}

// 장애물 표시 정보
export const OBSTACLE_INFO: Record<string, { name: string; fill: string; stroke: string; solid: boolean; emoji: string }> = {
  rock: { name: "바위", fill: "#6b7280", stroke: "#374151", solid: true, emoji: "🪨" },
  spike: { name: "가시", fill: "#7f1d1d", stroke: "#ef4444", solid: true, emoji: "🌵" },
  bumper: { name: "범퍼", fill: "#f59e0b", stroke: "#b45309", solid: true, emoji: "🟠" },
  bomb: { name: "폭탄", fill: "#1f2937", stroke: "#ef4444", solid: true, emoji: "💣" },
  swamp: { name: "늪(감속)", fill: "rgba(74,124,89,0.35)", stroke: "#4a7c59", solid: false, emoji: "🟢" },
  ice: { name: "빙판(미끄럼)", fill: "rgba(125,211,252,0.28)", stroke: "#7dd3fc", solid: false, emoji: "🧊" },
  lava: { name: "용암(피해)", fill: "rgba(239,68,68,0.35)", stroke: "#ef4444", solid: false, emoji: "🔥" },
  boost: { name: "부스터(가속)", fill: "rgba(34,211,238,0.28)", stroke: "#22d3ee", solid: false, emoji: "⚡" },
  gravity: { name: "중력장", fill: "rgba(139,92,246,0.25)", stroke: "#a78bfa", solid: false, emoji: "🌀" },
  wind: { name: "돌풍", fill: "rgba(148,163,184,0.22)", stroke: "#94a3b8", solid: false, emoji: "💨" },
};

export interface FlickMarble {
  owner: string;
  x: number;
  y: number;
  r: number;
  hp: number;
  max_hp: number;
  atk: number;
  def: number;
  alive: boolean;
  power: string;
  shield: boolean;
  color_index: number;
}

// 초능력 13종 표시 정보 (color = 알 테두리 강조색)
export const POWER_INFO: Record<string, { name: string; emoji: string; desc: string; color: string }> = {
  explosion: { name: "폭발", emoji: "💥", desc: "충돌 시 주변에 광역 넉백 + 피해", color: "#fb923c" },
  pierce: { name: "관통", emoji: "🏹", desc: "충돌해도 멈추지 않고 뚫고 지나감", color: "#38bdf8" },
  iron: { name: "강철", emoji: "🛡️", desc: "방어력↑·무거움(잘 안 밀림)·체력↑", color: "#94a3b8" },
  shield: { name: "보호막", emoji: "🔰", desc: "첫 피해 1회 무효", color: "#7dd3fc" },
  slingshot: { name: "슬링샷", emoji: "🎯", desc: "발사 세기 제한 없음 — 드래그한 만큼 강하게(작게 치면 약함)", color: "#f0b96b" },
  heavy: { name: "헤비샷", emoji: "🔨", desc: "공격력↑·무거움", color: "#b45309" },
  lifesteal: { name: "흡혈", emoji: "🧛", desc: "입힌 피해의 절반만큼 체력 회복", color: "#c084fc" },
  spikes: { name: "가시", emoji: "🌵", desc: "맞을 때 공격자에게 반동 피해", color: "#f87171" },
  giant: { name: "거인", emoji: "🐘", desc: "거대한 몸집·높은 체력/질량(잘 안 밀림)", color: "#a3a3a3" },
  berserker: { name: "광전사", emoji: "😤", desc: "체력이 낮을수록 공격력이 강해짐(최대 2배)", color: "#dc2626" },
  frost: { name: "서리", emoji: "❄️", desc: "맞춘 상대의 다음 발사가 느려짐", color: "#38bdf8" },
  chain: { name: "전격", emoji: "⚡", desc: "충돌 시 주변 알에게 연쇄 피해", color: "#facc15" },
  regen: { name: "재생", emoji: "♻️", desc: "매 차례마다 체력 일부 회복", color: "#34d399" },
};

export interface Stone {
  x: number;
  y: number;
  color: number;
}

// ===== 체스 =====
export interface ChessPiece {
  t: string; // p,n,b,r,q,k
  c: string; // w,b
}
export interface ChessVoteCell {
  r: number;
  f: number;
  count: number;
}
// 기물 유니코드 글리프 + 한글 이름
export const CHESS_GLYPH: Record<string, string> = {
  p: "♟",
  n: "♞",
  b: "♝",
  r: "♜",
  q: "♛",
  k: "♚",
};
export const CHESS_NAME_KR: Record<string, string> = {
  p: "폰",
  n: "나이트",
  b: "비숍",
  r: "룩",
  q: "퀸",
  k: "킹",
};
export const CHESS_FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export interface ChatLine {
  from_id: string;
  from_name: string;
  text: string;
  ts_ms: number;
}

// 서버 → 클라이언트
export type ServerMsg =
  | { type: "RoomCreated"; code: string }
  | { type: "RoomList"; rooms: RoomBrief[] }
  | { type: "Joined"; player_id: string; code: string }
  | {
      type: "Snapshot";
      settings: RoomSettings;
      players: PlayerInfo[];
      order: string[];
      board: Stone[];
      status: string;
      current_turn: string | null;
      current_team: number | null;
      deadline_ms: number | null;
      winner: string | null;
      winning_team: number | null;
      winning_line: [number, number][];
      server_now_ms: number;
    }
  | { type: "GameStarted"; order: string[]; current_turn: string; deadline_ms: number; server_now_ms: number }
  | { type: "StonePlaced"; x: number; y: number; color: number; player_id: string }
  | { type: "TurnChanged"; current_turn: string; deadline_ms: number; server_now_ms: number }
  | { type: "TeamTurn"; team: number; deadline_ms: number; server_now_ms: number }
  | { type: "VoteUpdate"; tallies: VoteCell[]; voters: number; voted: number }
  | { type: "GameOver"; winner: string | null; winning_team: number | null; winning_line: [number, number][] }
  | { type: "Chat"; from_id: string; from_name: string; text: string; ts_ms: number }
  | { type: "Error"; message: string }
  | { type: "Kicked" }
  | {
      type: "FlickSnapshot";
      settings: RoomSettings;
      players: PlayerInfo[];
      arena_r: number;
      marbles: FlickMarble[];
      obstacles: FlickObstacle[];
      items: FlickItem[];
      status: string;
      drafting: boolean;
      current_turn: string | null;
      deadline_ms: number | null;
      server_now_ms: number;
      winner: string | null;
    }
  | {
      type: "ChessSnapshot";
      settings: RoomSettings;
      players: PlayerInfo[];
      board: (ChessPiece | null)[][];
      turn: string;
      phase: string;
      selected: [number, number] | null;
      options: [number, number][];
      last_move: [[number, number], [number, number]] | null;
      history: string[];
      check_status: string;
      status: string;
      current_team: number | null;
      deadline_ms: number | null;
      server_now_ms: number;
      winner: string | null;
      voters: number;
      voted: number;
    }
  | { type: "ChessVoteUpdate"; tallies: ChessVoteCell[]; voters: number; voted: number }
  | { type: "FlickDraft"; options: string[] }
  | { type: "FlickAiming"; owner: string; angle: number; power: number }
  | {
      type: "FlickResolved";
      ids: string[];
      timeline: [number, number][][];
      events: FlickEvent[];
      marbles: FlickMarble[];
      items: FlickItem[];
      current_turn: string | null;
      deadline_ms: number | null;
      server_now_ms: number;
      status: string;
      winner: string | null;
    };

// 클라이언트 → 서버
export type ClientMsg =
  | {
      type: "CreateRoom";
      name: string;
      nickname: string;
      max_players: number;
      board_size: number;
      win_length: number;
      turn_limit_secs: number;
      password: string | null;
      mode: string;
      game: string;
    }
  | { type: "JoinByCode"; code: string; nickname: string; password: string | null }
  | { type: "JoinBySearch"; code: string; nickname: string; password: string | null }
  | { type: "ListRooms"; query: string | null }
  | { type: "Reconnect"; code: string; player_id: string }
  | {
      type: "UpdateSettings";
      name: string;
      max_players: number;
      board_size: number;
      win_length: number;
      turn_limit_secs: number;
      password: string | null;
    }
  | { type: "StartGame"; random: boolean; order: string[]; first_team: number | null }
  | { type: "PlaceStone"; x: number; y: number }
  | { type: "Vote"; x: number; y: number }
  | { type: "ChessVote"; r: number; f: number }
  | { type: "JoinTeam"; team: number | null }
  | { type: "AssignTeam"; player_id: string; team: number | null }
  | { type: "Chat"; text: string }
  | { type: "SetColor"; color: string }
  | { type: "ReturnToLobby" }
  | { type: "LeaveRoom" }
  | { type: "KickPlayer"; player_id: string }
  | { type: "FlickDraftPick"; power: string }
  | { type: "FlickAim"; angle: number; power: number }
  | { type: "FlickAiming"; angle: number; power: number };
