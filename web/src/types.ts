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
  connected: boolean;
  team: number | null;
  ip: string;
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

// 초능력 8종 표시 정보
export const POWER_INFO: Record<string, { name: string; emoji: string; desc: string }> = {
  explosion: { name: "폭발", emoji: "💥", desc: "충돌 시 주변에 광역 넉백 + 피해" },
  pierce: { name: "관통", emoji: "🏹", desc: "충돌해도 멈추지 않고 뚫고 지나감" },
  iron: { name: "강철", emoji: "🛡️", desc: "방어력↑·무거움(잘 안 밀림)·체력↑" },
  shield: { name: "보호막", emoji: "🔰", desc: "첫 피해 1회 무효" },
  slingshot: { name: "슬링샷", emoji: "🎯", desc: "발사 세기 강화(멀리)" },
  heavy: { name: "헤비샷", emoji: "🔨", desc: "공격력↑·무거움" },
  lifesteal: { name: "흡혈", emoji: "🧛", desc: "입힌 피해의 절반만큼 체력 회복" },
  spikes: { name: "가시", emoji: "🌵", desc: "맞을 때 공격자에게 반동 피해" },
};

export interface Stone {
  x: number;
  y: number;
  color: number;
}

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
      status: string;
      drafting: boolean;
      current_turn: string | null;
      deadline_ms: number | null;
      server_now_ms: number;
      winner: string | null;
    }
  | { type: "FlickDraft"; options: string[] }
  | {
      type: "FlickResolved";
      ids: string[];
      timeline: [number, number][][];
      marbles: FlickMarble[];
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
  | { type: "JoinByCode"; code: string; nickname: string }
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
  | { type: "JoinTeam"; team: number | null }
  | { type: "AssignTeam"; player_id: string; team: number | null }
  | { type: "Chat"; text: string }
  | { type: "LeaveRoom" }
  | { type: "KickPlayer"; player_id: string }
  | { type: "FlickDraftPick"; power: string }
  | { type: "FlickAim"; angle: number; power: number };
