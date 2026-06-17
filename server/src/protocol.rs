//! WebSocket 메시지 프로토콜 (serde 태그드 enum).
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 클라이언트 → 서버
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMsg {
    /// 방 생성. 생성자는 곧바로 첫 플레이어(방장)가 된다.
    CreateRoom {
        name: String,
        nickname: String,
        max_players: u8,
        board_size: u16,
        win_length: u8,
        turn_limit_secs: u32,
        #[serde(default)]
        password: Option<String>,
        /// "classic" | "team" (기본 classic)
        #[serde(default)]
        mode: Option<String>,
    },
    /// 방 코드로 입장 (비밀번호 불필요).
    JoinByCode { code: String, nickname: String },
    /// 방 찾기로 입장 (비밀번호 필요시 검증).
    JoinBySearch {
        code: String,
        nickname: String,
        #[serde(default)]
        password: Option<String>,
    },
    /// 방 목록 조회 (선택적 이름 검색).
    ListRooms {
        #[serde(default)]
        query: Option<String>,
    },
    /// 재접속: 기존 자리 재점유.
    Reconnect { code: String, player_id: Uuid },
    /// 방 설정 변경 (방장만, 게임 진행 중이 아닐 때).
    UpdateSettings {
        name: String,
        max_players: u8,
        board_size: u16,
        win_length: u8,
        turn_limit_secs: u32,
        #[serde(default)]
        password: Option<String>,
    },
    /// 게임 시작 (방장만). random=true면 서버가 순서 셔플.
    /// 팀전에서는 first_team(0/1)으로 선공 팀 지정, random이면 선공 팀 랜덤.
    StartGame {
        #[serde(default)]
        random: bool,
        #[serde(default)]
        order: Vec<Uuid>,
        #[serde(default)]
        first_team: Option<u8>,
    },
    /// (클래식) 착수.
    PlaceStone { x: u16, y: u16 },
    /// (팀전) 본인 팀 차례에 원하는 위치 투표.
    Vote { x: u16, y: u16 },
    /// (팀전) 본인이 팀 선택/이동 (로비). None = 미배정.
    JoinTeam {
        #[serde(default)]
        team: Option<u8>,
    },
    /// (팀전) 방장이 특정 인원을 팀에 배정 (로비).
    AssignTeam {
        player_id: Uuid,
        #[serde(default)]
        team: Option<u8>,
    },
    /// 채팅.
    Chat { text: String },
    /// 방 나가기.
    LeaveRoom,
}

/// 서버 → 클라이언트
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ServerMsg {
    RoomCreated {
        code: String,
    },
    RoomList {
        rooms: Vec<RoomBrief>,
    },
    /// 입장 성공 시 본인 정보 전달.
    Joined {
        player_id: Uuid,
        code: String,
    },
    /// 방 전체 스냅샷.
    Snapshot {
        settings: RoomSettings,
        players: Vec<PlayerInfo>,
        order: Vec<Uuid>,
        board: Vec<Stone>,
        status: String,
        current_turn: Option<Uuid>,
        current_team: Option<u8>,
        deadline_ms: Option<u64>,
        winner: Option<Uuid>,
        winning_team: Option<u8>,
        winning_line: Vec<[u16; 2]>,
    },
    GameStarted {
        order: Vec<Uuid>,
        current_turn: Uuid,
        deadline_ms: u64,
    },
    StonePlaced {
        x: u16,
        y: u16,
        color: u8,
        player_id: Uuid,
    },
    TurnChanged {
        current_turn: Uuid,
        deadline_ms: u64,
    },
    /// (팀전) 팀 차례 시작/전환. 클라이언트는 투표 표시를 초기화.
    TeamTurn {
        team: u8,
        deadline_ms: u64,
    },
    /// (팀전) 현재 팀의 투표 현황 — 해당 팀원에게만 전송.
    VoteUpdate {
        tallies: Vec<VoteCell>,
        voters: u32,
        voted: u32,
    },
    GameOver {
        winner: Option<Uuid>,
        winning_team: Option<u8>,
        winning_line: Vec<[u16; 2]>,
    },
    Chat {
        from_id: Uuid,
        from_name: String,
        text: String,
        ts_ms: u64,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct VoteCell {
    pub x: u16,
    pub y: u16,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomBrief {
    pub code: String,
    pub name: String,
    pub players: u8,
    pub max_players: u8,
    pub has_password: bool,
    pub status: String,
    pub board_size: u16,
    pub win_length: u8,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomSettings {
    pub code: String,
    pub name: String,
    pub has_password: bool,
    pub max_players: u8,
    pub board_size: u16,
    pub win_length: u8,
    pub turn_limit_secs: u32,
    pub host_id: Uuid,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerInfo {
    pub id: Uuid,
    pub nickname: String,
    pub color_index: u8,
    pub connected: bool,
    pub team: Option<u8>,
    pub ip: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stone {
    pub x: u16,
    pub y: u16,
    pub color: u8,
}
