// 서버 프로토콜과 1:1로 대응하는 타입.

// 인덱스 0 = 흰색(방장 전용). 1~20 = 일반 참가자 색 (서버 PALETTE_COLORS와 일치).
export const COLORS = [
  "#ffffff", // 0 흰색 (방장)
  "#1a1a1a", // 1 검정
  "#e6194b", // 2 빨강
  "#3cb44b", // 3 초록
  "#4363d8", // 4 파랑
  "#f58231", // 5 주황
  "#911eb4", // 6 보라
  "#008080", // 7 청록
  "#f032e6", // 8 자홍
  "#9a6324", // 9 갈색
  "#800000", // 10 적갈
  "#808000", // 11 올리브
  "#000075", // 12 남색
  "#ff1493", // 13 분홍
  "#00ced1", // 14 터키옥
  "#b15928", // 15 황토
  "#6a3d9a", // 16 진보라
  "#b30059", // 17 자주
  "#1f78b4", // 18 강철파랑
  "#33a02c", // 19 숲초록
  "#5d5d5d", // 20 회색
];
export const COLOR_NAMES = [
  "흰색",
  "검정",
  "빨강",
  "초록",
  "파랑",
  "주황",
  "보라",
  "청록",
  "자홍",
  "갈색",
  "적갈",
  "올리브",
  "남색",
  "분홍",
  "터키옥",
  "황토",
  "진보라",
  "자주",
  "강철파랑",
  "숲초록",
  "회색",
];

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
    }
  | { type: "GameStarted"; order: string[]; current_turn: string; deadline_ms: number }
  | { type: "StonePlaced"; x: number; y: number; color: number; player_id: string }
  | { type: "TurnChanged"; current_turn: string; deadline_ms: number }
  | { type: "TeamTurn"; team: number; deadline_ms: number }
  | { type: "VoteUpdate"; tallies: VoteCell[]; voters: number; voted: number }
  | { type: "GameOver"; winner: string | null; winning_team: number | null; winning_line: [number, number][] }
  | { type: "Chat"; from_id: string; from_name: string; text: string; ts_ms: number }
  | { type: "Error"; message: string };

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
  | { type: "LeaveRoom" };
