//! WebSocket 연결 핸들러와 메시지 라우팅, 턴 타이머.
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::game::{check_win, gen_code};
use crate::protocol::*;
use crate::state::*;
use rand::seq::SliceRandom;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();

    // 송신 펌프: 이 연결로 가는 모든 메시지를 ws로 흘려보낸다.
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let Ok(text) = serde_json::to_string(&msg) else {
                continue;
            };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // 이 연결이 속한 (방 코드, 플레이어 id)
    let mut session: Option<(String, Uuid)> = None;

    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t.as_str().to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let client_msg: ClientMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                let _ = tx.send(ServerMsg::Error {
                    message: format!("잘못된 메시지: {e}"),
                });
                continue;
            }
        };
        handle_client_msg(client_msg, &state, &tx, &mut session);
    }

    // 연결 종료: 자리 유지(소프트) 또는 제거(로비) 처리.
    if let Some((code, pid)) = session {
        leave_room(&state, &code, pid);
    }
    send_task.abort();
}

fn err(tx: &Tx, message: impl Into<String>) {
    let _ = tx.send(ServerMsg::Error {
        message: message.into(),
    });
}

fn handle_client_msg(
    msg: ClientMsg,
    state: &Arc<AppState>,
    tx: &Tx,
    session: &mut Option<(String, Uuid)>,
) {
    match msg {
        ClientMsg::ListRooms { query } => {
            let rooms = state.rooms.lock().unwrap();
            let q = query.unwrap_or_default().to_lowercase();
            let list: Vec<RoomBrief> = rooms
                .values()
                .filter(|r| q.is_empty() || r.name.to_lowercase().contains(&q))
                .map(|r| r.brief())
                .collect();
            let _ = tx.send(ServerMsg::RoomList { rooms: list });
        }

        ClientMsg::CreateRoom {
            name,
            nickname,
            max_players,
            board_size,
            win_length,
            turn_limit_secs,
            password,
            mode,
        } => {
            let mode = match mode.as_deref() {
                Some("team") => GameMode::Team,
                _ => GameMode::Classic,
            };
            // 팀전은 인원 무제한(과도한 사용 방지로 100 상한), 클래식은 2~20.
            let max_players = if mode == GameMode::Team {
                100
            } else {
                max_players.clamp(2, 20)
            };
            let board_size = board_size.clamp(5, 100);
            let win_length = win_length.clamp(3, 10);
            let turn_limit_secs = turn_limit_secs.clamp(5, 600);
            let name = trim_len(name, 40, "방");
            let nickname = trim_len(nickname, 20, "익명");
            let password = password.filter(|p| !p.is_empty());

            let mut rooms = state.rooms.lock().unwrap();
            let mut code = gen_code();
            while rooms.contains_key(&code) {
                code = gen_code();
            }
            let pid = Uuid::new_v4();
            let host = Player {
                id: pid,
                nickname,
                color_index: 0,
                connected: true,
                team: None,
                tx: tx.clone(),
            };
            let room = Room {
                code: code.clone(),
                name,
                password,
                max_players,
                board_size,
                win_length,
                turn_limit_secs,
                host_id: pid,
                mode,
                players: vec![host],
                order: Vec::new(),
                turn_idx: 0,
                board: std::collections::HashMap::new(),
                status: RoomStatus::Lobby,
                winner: None,
                winner_team: None,
                winning_line: Vec::new(),
                turn_generation: 0,
                deadline_ms: None,
                current_team: 0,
                votes: std::collections::HashMap::new(),
            };
            rooms.insert(code.clone(), room);
            *session = Some((code.clone(), pid));

            let _ = tx.send(ServerMsg::RoomCreated { code: code.clone() });
            let _ = tx.send(ServerMsg::Joined {
                player_id: pid,
                code: code.clone(),
            });
            if let Some(room) = rooms.get(&code) {
                let _ = tx.send(room.snapshot());
            }
        }

        ClientMsg::JoinByCode { code, nickname } => {
            join_room(state, tx, session, &code, nickname, None, false);
        }

        ClientMsg::JoinBySearch {
            code,
            nickname,
            password,
        } => {
            join_room(state, tx, session, &code, nickname, password, true);
        }

        ClientMsg::Reconnect { code, player_id } => {
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                err(tx, "방을 찾을 수 없습니다");
                return;
            };
            let Some(player) = room.find_mut(player_id) else {
                err(tx, "재접속할 자리가 없습니다");
                return;
            };
            player.connected = true;
            player.tx = tx.clone();
            *session = Some((code.clone(), player_id));
            let _ = tx.send(ServerMsg::Joined {
                player_id,
                code: code.clone(),
            });
            let snap = room.snapshot();
            room.broadcast(&snap);
        }

        ClientMsg::UpdateSettings {
            name,
            max_players,
            board_size,
            win_length,
            turn_limit_secs,
            password,
        } => {
            let Some((code, pid)) = session.clone() else {
                err(tx, "방에 참가하지 않았습니다");
                return;
            };
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                return;
            };
            if room.host_id != pid {
                err(tx, "방장만 설정을 변경할 수 있습니다");
                return;
            }
            if room.status == RoomStatus::Playing {
                err(tx, "게임 진행 중에는 설정을 변경할 수 없습니다");
                return;
            }
            // 클래식만 인원 조절(현재 인원보다 작게는 못 줄임). 팀전은 무제한 유지.
            if room.mode == GameMode::Classic {
                let current = room.players.len() as u8;
                room.max_players = max_players.clamp(2, 20).max(current);
            }
            room.board_size = board_size.clamp(5, 100);
            room.win_length = win_length.clamp(3, 10);
            room.turn_limit_secs = turn_limit_secs.clamp(5, 600);
            room.name = trim_len(name, 40, "오목방");
            // password: None = 변경 안 함, Some("") = 제거, Some(x) = 설정.
            if let Some(p) = password {
                room.password = if p.is_empty() { None } else { Some(p) };
            }

            let snap = room.snapshot();
            room.broadcast(&snap);
        }

        ClientMsg::StartGame {
            random,
            order,
            first_team,
        } => {
            let Some((code, pid)) = session.clone() else {
                err(tx, "방에 참가하지 않았습니다");
                return;
            };
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                return;
            };
            if room.host_id != pid {
                err(tx, "방장만 게임을 시작할 수 있습니다");
                return;
            }
            if room.status == RoomStatus::Playing {
                err(tx, "이미 진행 중인 게임입니다");
                return;
            }

            // 공통 초기화
            room.board.clear();
            room.winner = None;
            room.winner_team = None;
            room.winning_line.clear();
            room.votes.clear();

            if room.mode == GameMode::Team {
                if room.team_connected(0) == 0 || room.team_connected(1) == 0 {
                    err(tx, "양 팀에 각각 1명 이상 있어야 시작할 수 있습니다");
                    return;
                }
                let first = if random {
                    *[0u8, 1u8].choose(&mut rand::thread_rng()).unwrap()
                } else {
                    first_team.unwrap_or(0).min(1)
                };
                room.current_team = first;
                room.status = RoomStatus::Playing;
                room.turn_generation += 1;
                room.deadline_ms = Some(now_ms() + room.turn_limit_secs as u64 * 1000);
                let generation = room.turn_generation;
                let limit = room.turn_limit_secs;
                let deadline = room.deadline_ms.unwrap();
                room.broadcast(&ServerMsg::TeamTurn {
                    team: first,
                    deadline_ms: deadline,
                });
                let snap = room.snapshot();
                room.broadcast(&snap);
                spawn_turn_timer(state.clone(), code, generation, limit);
            } else {
                if room.players.len() < 2 {
                    err(tx, "2명 이상이어야 시작할 수 있습니다");
                    return;
                }
                let ids: Vec<Uuid> = room.players.iter().map(|p| p.id).collect();
                let final_order = if random {
                    shuffle(ids)
                } else if is_permutation(&order, &room.players) {
                    order
                } else {
                    ids
                };
                room.order = final_order;
                room.turn_idx = 0;
                room.status = RoomStatus::Playing;

                if let Some(current) = begin_turn(room) {
                    let deadline = room.deadline_ms.unwrap();
                    let generation = room.turn_generation;
                    let limit = room.turn_limit_secs;
                    room.broadcast(&ServerMsg::GameStarted {
                        order: room.order.clone(),
                        current_turn: current,
                        deadline_ms: deadline,
                    });
                    let snap = room.snapshot();
                    room.broadcast(&snap);
                    spawn_turn_timer(state.clone(), code, generation, limit);
                }
            }
        }

        ClientMsg::JoinTeam { team } => {
            let Some((code, pid)) = session.clone() else {
                return;
            };
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                return;
            };
            if room.mode != GameMode::Team {
                return;
            }
            if room.status != RoomStatus::Lobby {
                err(tx, "게임 중에는 팀을 바꿀 수 없습니다");
                return;
            }
            let t = team.map(|v| v.min(1));
            if let Some(p) = room.find_mut(pid) {
                p.team = t;
            }
            let snap = room.snapshot();
            room.broadcast(&snap);
        }

        ClientMsg::AssignTeam { player_id, team } => {
            let Some((code, pid)) = session.clone() else {
                return;
            };
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                return;
            };
            if room.mode != GameMode::Team {
                return;
            }
            if room.host_id != pid {
                err(tx, "방장만 팀을 배정할 수 있습니다");
                return;
            }
            if room.status != RoomStatus::Lobby {
                err(tx, "게임 중에는 팀을 바꿀 수 없습니다");
                return;
            }
            let t = team.map(|v| v.min(1));
            if let Some(p) = room.find_mut(player_id) {
                p.team = t;
            }
            let snap = room.snapshot();
            room.broadcast(&snap);
        }

        ClientMsg::Vote { x, y } => {
            let Some((code, pid)) = session.clone() else {
                return;
            };
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                return;
            };
            if room.mode != GameMode::Team || room.status != RoomStatus::Playing {
                return;
            }
            let my_team = room.find(pid).and_then(|p| p.team);
            if my_team != Some(room.current_team) {
                err(tx, "당신 팀의 차례가 아닙니다");
                return;
            }
            if x >= room.board_size || y >= room.board_size || room.board.contains_key(&(x, y)) {
                err(tx, "둘 수 없는 자리입니다");
                return;
            }
            room.votes.insert(pid, (x, y));

            // 현재 팀에게 투표 현황 전송
            let (voters, voted) = room.vote_progress();
            let tallies: Vec<VoteCell> = room
                .tally()
                .into_iter()
                .map(|((x, y), count)| VoteCell { x, y, count })
                .collect();
            room.broadcast_team(
                room.current_team,
                &ServerMsg::VoteUpdate {
                    tallies,
                    voters,
                    voted,
                },
            );

            // 전원 투표 완료 시 즉시 확정
            if voters > 0 && voted >= voters {
                resolve_team_turn(state, room, &code);
            }
        }

        ClientMsg::PlaceStone { x, y } => {
            let Some((code, pid)) = session.clone() else {
                err(tx, "방에 참가하지 않았습니다");
                return;
            };
            let mut rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get_mut(&code) else {
                return;
            };
            if room.mode == GameMode::Team {
                return; // 팀전은 Vote 사용
            }
            if room.status != RoomStatus::Playing {
                err(tx, "게임이 진행 중이 아닙니다");
                return;
            }
            if room.current_turn() != Some(pid) {
                err(tx, "당신의 차례가 아닙니다");
                return;
            }
            if x >= room.board_size || y >= room.board_size {
                err(tx, "보드 범위를 벗어났습니다");
                return;
            }
            if room.board.contains_key(&(x, y)) {
                err(tx, "이미 돌이 놓인 자리입니다");
                return;
            }
            let color = room.find(pid).map(|p| p.color_index).unwrap_or(0);
            room.board.insert((x, y), color);
            room.broadcast(&ServerMsg::StonePlaced {
                x,
                y,
                color,
                player_id: pid,
            });

            // 승리 판정
            if let Some(line) = check_win(&room.board, x, y, color, room.win_length) {
                room.status = RoomStatus::Finished;
                room.winner = Some(pid);
                room.winning_line = line.clone();
                room.deadline_ms = None;
                room.broadcast(&ServerMsg::GameOver {
                    winner: Some(pid),
                    winning_team: None,
                    winning_line: line,
                });
                return;
            }

            // 다음 차례로
            let n = room.order.len();
            room.turn_idx = (room.turn_idx + 1) % n;
            if let Some(next) = begin_turn(room) {
                let deadline = room.deadline_ms.unwrap();
                let generation = room.turn_generation;
                let limit = room.turn_limit_secs;
                room.broadcast(&ServerMsg::TurnChanged {
                    current_turn: next,
                    deadline_ms: deadline,
                });
                spawn_turn_timer(state.clone(), code, generation, limit);
            }
        }

        ClientMsg::Chat { text } => {
            let Some((code, pid)) = session.clone() else {
                return;
            };
            let text = trim_len(text, 500, "");
            if text.is_empty() {
                return;
            }
            let rooms = state.rooms.lock().unwrap();
            let Some(room) = rooms.get(&code) else {
                return;
            };
            let Some(from_name) = room.find(pid).map(|p| p.nickname.clone()) else {
                return;
            };
            room.broadcast(&ServerMsg::Chat {
                from_id: pid,
                from_name,
                text,
                ts_ms: now_ms(),
            });
        }

        ClientMsg::LeaveRoom => {
            if let Some((code, pid)) = session.take() {
                leave_room(state, &code, pid);
            }
        }
    }
}

/// 입장 처리 (코드 입장/검색 입장 공용).
fn join_room(
    state: &Arc<AppState>,
    tx: &Tx,
    session: &mut Option<(String, Uuid)>,
    code: &str,
    nickname: String,
    password: Option<String>,
    require_password: bool,
) {
    let nickname = trim_len(nickname, 20, "익명");
    let mut rooms = state.rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(code) else {
        err(tx, "방을 찾을 수 없습니다");
        return;
    };
    if require_password {
        if let Some(real) = &room.password {
            if password.as_deref() != Some(real.as_str()) {
                err(tx, "비밀번호가 올바르지 않습니다");
                return;
            }
        }
    }
    if room.status != RoomStatus::Lobby {
        err(tx, "이미 시작된 게임입니다");
        return;
    }
    if room.players.len() as u8 >= room.max_players {
        err(tx, "방이 가득 찼습니다");
        return;
    }

    let pid = Uuid::new_v4();
    let color = assign_color(room);
    room.players.push(Player {
        id: pid,
        nickname,
        color_index: color,
        connected: true,
        team: None,
        tx: tx.clone(),
    });
    *session = Some((code.to_string(), pid));

    let _ = tx.send(ServerMsg::Joined {
        player_id: pid,
        code: code.to_string(),
    });
    let snap = room.snapshot();
    room.broadcast(&snap);
}

/// 나가기/연결 종료 공용 처리.
fn leave_room(state: &Arc<AppState>, code: &str, pid: Uuid) {
    let mut rooms = state.rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(code) else {
        return;
    };
    let was_turn = room.current_turn() == Some(pid);

    // 진행 중이 아니면(로비/종료) 완전히 제거, 진행 중이면 자리 유지(끊김 표시).
    if room.status != RoomStatus::Playing {
        room.players.retain(|p| p.id != pid);
        room.order.retain(|&id| id != pid);
        room.votes.remove(&pid);
    } else if let Some(p) = room.find_mut(pid) {
        p.connected = false;
    }

    // 방장 위임 (새 방장은 흰색으로)
    if room.host_id == pid {
        if let Some(next) = room.players.iter().find(|p| p.connected).map(|p| p.id) {
            room.host_id = next;
            if let Some(p) = room.find_mut(next) {
                p.color_index = 0;
            }
        }
    }

    // 연결된 사람이 없으면 방 삭제
    if room.players.is_empty() || !room.players.iter().any(|p| p.connected) {
        rooms.remove(code);
        return;
    }

    let snap = room.snapshot();
    room.broadcast(&snap);

    // (클래식) 떠난 사람 차례였다면 다음으로 넘긴다.
    if room.mode == GameMode::Classic
        && room.status == RoomStatus::Playing
        && was_turn
        && !room.order.is_empty()
    {
        room.turn_idx = (room.turn_idx + 1) % room.order.len();
        if let Some(next) = begin_turn(room) {
            let deadline = room.deadline_ms.unwrap();
            let generation = room.turn_generation;
            let limit = room.turn_limit_secs;
            room.broadcast(&ServerMsg::TurnChanged {
                current_turn: next,
                deadline_ms: deadline,
            });
            spawn_turn_timer(state.clone(), code.to_string(), generation, limit);
        }
    }

    // (팀전) 떠난 사람의 표 제거 후, 남은 인원이 모두 투표했거나
    // 현재 팀에 연결자가 없으면 즉시 확정/스킵.
    if room.mode == GameMode::Team && room.status == RoomStatus::Playing {
        room.votes.remove(&pid);
        let (voters, voted) = room.vote_progress();
        if voters == 0 || voted >= voters {
            resolve_team_turn(state, room, code);
        }
    }
}

/// (팀전) 현재 팀의 투표를 집계해 최다 득표 위치에 착수하고 다음 팀으로 전환.
/// 표가 없으면 착수 없이 다음 팀으로 넘긴다. 승리 시 게임 종료.
fn resolve_team_turn(state: &Arc<AppState>, room: &mut Room, code: &str) {
    let counts = room.tally();
    if !counts.is_empty() {
        let max = counts.values().copied().max().unwrap_or(0);
        // 최다 득표가 동률이면 랜덤 선택.
        let mut top: Vec<(u16, u16)> = counts
            .iter()
            .filter(|(_, &c)| c == max)
            .map(|(&cell, _)| cell)
            .collect();
        top.sort_unstable();
        let cell = *top.choose(&mut rand::thread_rng()).unwrap();
        let color = room.current_team;
        room.board.insert(cell, color);
        room.votes.clear();
        room.broadcast(&ServerMsg::StonePlaced {
            x: cell.0,
            y: cell.1,
            color,
            player_id: Uuid::nil(),
        });
        if let Some(line) = check_win(&room.board, cell.0, cell.1, color, room.win_length) {
            room.status = RoomStatus::Finished;
            room.winner_team = Some(color);
            room.winning_line = line.clone();
            room.deadline_ms = None;
            room.broadcast(&ServerMsg::GameOver {
                winner: None,
                winning_team: Some(color),
                winning_line: line,
            });
            return;
        }
    } else {
        room.votes.clear();
    }

    // 다음 팀으로 전환
    room.current_team = 1 - room.current_team;
    room.turn_generation += 1;
    room.deadline_ms = Some(now_ms() + room.turn_limit_secs as u64 * 1000);
    let team = room.current_team;
    let deadline = room.deadline_ms.unwrap();
    let generation = room.turn_generation;
    let limit = room.turn_limit_secs;
    room.broadcast(&ServerMsg::TeamTurn {
        team,
        deadline_ms: deadline,
    });
    spawn_turn_timer(state.clone(), code.to_string(), generation, limit);
}

/// 현재 turn_idx에서 시작해 연결된 플레이어를 찾아 차례를 확정한다.
/// generation/deadline을 갱신하고 그 플레이어 id를 반환. 아무도 없으면 None.
fn begin_turn(room: &mut Room) -> Option<Uuid> {
    let n = room.order.len();
    if n == 0 {
        return None;
    }
    for _ in 0..n {
        let id = room.order[room.turn_idx];
        let connected = room.find(id).map(|p| p.connected).unwrap_or(false);
        if connected {
            room.turn_generation += 1;
            room.deadline_ms = Some(now_ms() + room.turn_limit_secs as u64 * 1000);
            return Some(id);
        }
        room.turn_idx = (room.turn_idx + 1) % n;
    }
    None
}

/// 제한시간이 지나면 자동으로 다음 차례로 넘기는 타이머.
fn spawn_turn_timer(state: Arc<AppState>, code: String, generation: u64, limit_secs: u32) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(limit_secs as u64)).await;
        let mut rooms = state.rooms.lock().unwrap();
        let Some(room) = rooms.get_mut(&code) else {
            return;
        };
        // 그 사이 차례가 바뀌었으면(=generation 변경) 무효.
        if room.status != RoomStatus::Playing || room.turn_generation != generation {
            return;
        }
        // 팀전: 만료 시 현재까지의 투표로 확정(없으면 스킵) 후 다음 팀.
        if room.mode == GameMode::Team {
            resolve_team_turn(&state, room, &code);
            return;
        }
        let n = room.order.len();
        if n == 0 {
            return;
        }
        room.turn_idx = (room.turn_idx + 1) % n;
        if let Some(next) = begin_turn(room) {
            let deadline = room.deadline_ms.unwrap();
            let new_gen = room.turn_generation;
            let limit = room.turn_limit_secs;
            room.broadcast(&ServerMsg::TurnChanged {
                current_turn: next,
                deadline_ms: deadline,
            });
            spawn_turn_timer(state.clone(), code.clone(), new_gen, limit);
        }
    });
}

fn shuffle(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.shuffle(&mut rand::thread_rng());
    ids
}

/// 일반 참가자 색 배정: 흰색(0, 방장 전용)을 제외한 1..PALETTE_COLORS 중
/// 아직 쓰이지 않은 색을 랜덤으로. 모두 쓰였으면 그냥 랜덤.
fn assign_color(room: &Room) -> u8 {
    let used: std::collections::HashSet<u8> = room.players.iter().map(|p| p.color_index).collect();
    let mut rng = rand::thread_rng();
    let avail: Vec<u8> = (1..PALETTE_COLORS).filter(|c| !used.contains(c)).collect();
    if let Some(&c) = avail.choose(&mut rng) {
        c
    } else {
        (1..PALETTE_COLORS).collect::<Vec<u8>>().choose(&mut rng).copied().unwrap_or(1)
    }
}

fn is_permutation(order: &[Uuid], players: &[Player]) -> bool {
    if order.len() != players.len() {
        return false;
    }
    players.iter().all(|p| order.contains(&p.id))
}

fn trim_len(s: String, max: usize, fallback: &str) -> String {
    let t = s.trim();
    if t.is_empty() {
        return fallback.to_string();
    }
    t.chars().take(max).collect()
}
