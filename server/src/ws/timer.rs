//! 턴 제한시간 타이머 통합.
//!
//! 기존의 5개 함수(spawn_turn / chess / flick / yut / yacht)는
//! `sleep → 방 잠금 → 조회 → generation/status 가드`라는 동일한 골격을 반복했다.
//! 그 골격을 [`spawn`] 한 곳에 모으고, 게임별 본문만 [`TurnKind`]로 분기한다.
//! 게임 종류별 추가 가드(`room.game != X`)는 각 arm 안에서 처리한다.
use std::sync::Arc;
use std::time::Duration;

use crate::state::{AppState, GameKind, GameMode, RoomStatus};

/// 어떤 게임의 타임아웃 처리를 할지.
pub(crate) enum TurnKind {
    /// 오목 클래식/팀전(내부에서 `room.mode`로 다시 분기).
    Turn,
    Chess,
    Flick,
    Yut,
    Yacht,
}

/// 제한시간이 지나면 해당 게임의 타임아웃 처리를 한 뒤 다음 차례 타이머를 재무장한다.
/// `generation`이 그 사이 바뀌었으면(차례가 이미 진행됨) 아무것도 하지 않는다.
pub(crate) fn spawn(
    state: Arc<AppState>,
    code: String,
    generation: u64,
    limit_secs: u32,
    kind: TurnKind,
) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(limit_secs as u64)).await;
        let mut rooms = state.rooms();
        let Some(room) = rooms.get_mut(&code) else {
            return;
        };
        // 그 사이 차례가 바뀌었으면(=generation 변경) 무효.
        if room.status != RoomStatus::Playing || room.turn_generation != generation {
            return;
        }
        match kind {
            TurnKind::Turn => {
                // 팀전: 만료 시 현재까지의 투표로 확정(없으면 스킵) 후 다음 팀.
                if room.mode == GameMode::Team {
                    super::resolve_team_turn(&state, room, &code);
                    return;
                }
                super::advance_classic_turn(&state, room, &code);
            }

            TurnKind::Chess => {
                if room.game != GameKind::Chess {
                    return;
                }
                super::resolve_chess(&state, room, &code);
            }

            TurnKind::Flick => {
                if room.game != GameKind::Flick {
                    return;
                }
                let drafting = room.flick.as_ref().map(|f| f.drafting).unwrap_or(false);
                if drafting {
                    // 드래프트 미선택자 자동 선택 후 첫 차례 시작.
                    if let Some(f) = room.flick.as_mut() {
                        f.auto_pick_remaining();
                        f.drafting = false;
                    }
                    super::start_flick_first_turn(&state, room, &code);
                    return;
                }
                // 차례 시간 초과 → 발사 못 함, 다음 차례로.
                let n = room.order.len();
                if n == 0 {
                    return;
                }
                room.turn_idx = (room.turn_idx + 1) % n;
                if super::advance_flick_turn(room).is_some() {
                    if let Some(f) = room.flick.as_mut() {
                        f.tick_items();
                    }
                    let gen = room.turn_generation;
                    let limit = room.turn_limit_secs;
                    let snap = room.snapshot();
                    room.broadcast(&snap);
                    spawn(state.clone(), code.clone(), gen, limit, TurnKind::Flick);
                }
            }

            TurnKind::Yut => {
                if room.game != GameKind::Yut {
                    return;
                }
                super::skip_yut_turn(&state, room, &code);
            }

            TurnKind::Yacht => {
                if room.game != GameKind::Yacht {
                    return;
                }
                super::skip_yacht_turn(&state, room, &code);
            }
        }
    });
}
