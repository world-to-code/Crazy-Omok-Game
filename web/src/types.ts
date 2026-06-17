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
}

export interface VoteCell {
  x: number;
  y: number;
  count: number;
}

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
  | { type: "Kicked" };

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
  | { type: "KickPlayer"; player_id: string };
