//! 인메모리 게임 상태. 서버 종료 시 모두 소멸.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::protocol::*;

pub type Tx = UnboundedSender<ServerMsg>;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RoomStatus {
    Lobby,
    Playing,
    Finished,
}

impl RoomStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RoomStatus::Lobby => "lobby",
            RoomStatus::Playing => "playing",
            RoomStatus::Finished => "finished",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GameMode {
    Classic,
    Team,
}

impl GameMode {
    pub fn as_str(self) -> &'static str {
        match self {
            GameMode::Classic => "classic",
            GameMode::Team => "team",
        }
    }
}

pub struct Player {
    pub id: Uuid,
    pub nickname: String,
    pub color_index: u8,
    pub connected: bool,
    /// 팀전에서의 소속 팀 (0/1), 미배정이면 None. 클래식에서는 항상 None.
    pub team: Option<u8>,
    pub tx: Tx,
}

pub struct Room {
    pub code: String,
    pub name: String,
    pub password: Option<String>,
    pub max_players: u8,
    pub board_size: u16,
    pub win_length: u8,
    pub turn_limit_secs: u32,
    pub host_id: Uuid,
    pub mode: GameMode,
    pub players: Vec<Player>,
    pub order: Vec<Uuid>,
    pub turn_idx: usize,
    pub board: HashMap<(u16, u16), u8>,
    pub status: RoomStatus,
    pub winner: Option<Uuid>,
    pub winner_team: Option<u8>,
    pub winning_line: Vec<[u16; 2]>,
    /// 차례가 바뀔 때마다 증가. 만료 타이머가 자기 차례인지 식별하는 용도.
    pub turn_generation: u64,
    pub deadline_ms: Option<u64>,
    /// (팀전) 현재 차례 팀 (0/1).
    pub current_team: u8,
    /// (팀전) 현재 팀 차례의 투표: player_id -> (x, y).
    pub votes: HashMap<Uuid, (u16, u16)>,
}

/// 색 팔레트 크기. 인덱스 0 = 흰색(방장 전용), 1..PALETTE_COLORS = 일반 색.
pub const PALETTE_COLORS: u8 = 21;

impl Room {
    pub fn find(&self, id: Uuid) -> Option<&Player> {
        self.players.iter().find(|p| p.id == id)
    }

    pub fn find_mut(&mut self, id: Uuid) -> Option<&mut Player> {
        self.players.iter_mut().find(|p| p.id == id)
    }

    pub fn current_turn(&self) -> Option<Uuid> {
        if self.status == RoomStatus::Playing && self.mode == GameMode::Classic {
            self.order.get(self.turn_idx).copied()
        } else {
            None
        }
    }

    pub fn current_team(&self) -> Option<u8> {
        if self.status == RoomStatus::Playing && self.mode == GameMode::Team {
            Some(self.current_team)
        } else {
            None
        }
    }

    /// 특정 팀의 연결된 인원 수.
    pub fn team_connected(&self, team: u8) -> usize {
        self.players
            .iter()
            .filter(|p| p.connected && p.team == Some(team))
            .count()
    }

    /// 현재 팀의 (전체 투표 대상자 수, 이미 투표한 수).
    pub fn vote_progress(&self) -> (u32, u32) {
        let voters = self.team_connected(self.current_team) as u32;
        let voted = self
            .players
            .iter()
            .filter(|p| {
                p.connected && p.team == Some(self.current_team) && self.votes.contains_key(&p.id)
            })
            .count() as u32;
        (voters, voted)
    }

    /// 현재 팀의 위치별 득표 집계 (연결된 현재 팀원의 표만).
    pub fn tally(&self) -> HashMap<(u16, u16), u32> {
        let mut counts: HashMap<(u16, u16), u32> = HashMap::new();
        for p in &self.players {
            if p.connected && p.team == Some(self.current_team) {
                if let Some(&cell) = self.votes.get(&p.id) {
                    *counts.entry(cell).or_insert(0) += 1;
                }
            }
        }
        counts
    }

    /// 특정 팀의 연결된 인원에게만 전송.
    pub fn broadcast_team(&self, team: u8, msg: &ServerMsg) {
        for p in &self.players {
            if p.connected && p.team == Some(team) {
                let _ = p.tx.send(msg.clone());
            }
        }
    }

    pub fn settings(&self) -> RoomSettings {
        RoomSettings {
            code: self.code.clone(),
            name: self.name.clone(),
            has_password: self.password.is_some(),
            max_players: self.max_players,
            board_size: self.board_size,
            win_length: self.win_length,
            turn_limit_secs: self.turn_limit_secs,
            host_id: self.host_id,
            mode: self.mode.as_str().to_string(),
        }
    }

    pub fn brief(&self) -> RoomBrief {
        RoomBrief {
            code: self.code.clone(),
            name: self.name.clone(),
            players: self.players.len() as u8,
            max_players: self.max_players,
            has_password: self.password.is_some(),
            status: self.status.as_str().to_string(),
            board_size: self.board_size,
            win_length: self.win_length,
            mode: self.mode.as_str().to_string(),
        }
    }

    pub fn player_infos(&self) -> Vec<PlayerInfo> {
        self.players
            .iter()
            .map(|p| PlayerInfo {
                id: p.id,
                nickname: p.nickname.clone(),
                color_index: p.color_index,
                connected: p.connected,
                team: p.team,
            })
            .collect()
    }

    pub fn snapshot(&self) -> ServerMsg {
        let board: Vec<Stone> = self
            .board
            .iter()
            .map(|(&(x, y), &color)| Stone { x, y, color })
            .collect();
        ServerMsg::Snapshot {
            settings: self.settings(),
            players: self.player_infos(),
            order: self.order.clone(),
            board,
            status: self.status.as_str().to_string(),
            current_turn: self.current_turn(),
            current_team: self.current_team(),
            deadline_ms: self.deadline_ms,
            winner: self.winner,
            winning_team: self.winner_team,
            winning_line: self.winning_line.clone(),
        }
    }

    /// 방의 연결된 전원에게 전송 (나갔거나 끊긴 사람은 제외).
    pub fn broadcast(&self, msg: &ServerMsg) {
        for p in &self.players {
            if p.connected {
                let _ = p.tx.send(msg.clone());
            }
        }
    }
}

pub struct AppState {
    pub rooms: Mutex<HashMap<String, Room>>,
    /// 초대 링크에 쓸 공개 호스트/IP.
    pub public_host: String,
    /// 초대 링크에 쓸 공개 포트.
    pub public_port: u16,
}

impl AppState {
    pub fn new(public_host: String, public_port: u16) -> Self {
        AppState {
            rooms: Mutex::new(HashMap::new()),
            public_host,
            public_port,
        }
    }
}
