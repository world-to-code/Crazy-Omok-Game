//! in-room 핸들러의 공통 보일러플레이트(세션 확인 + 방 잠금 + 조회)를 묶는 RoomGuard.
//!
//! 거의 모든 arm이 반복하던 다음 3줄을 1~2줄로 줄인다.
//! ```ignore
//! let Some((code, pid)) = session.clone() else { return };
//! let mut rooms = state.rooms();
//! let Some(room) = rooms.get_mut(&code) else { return };
//! ```
use std::collections::HashMap;
use std::sync::{Arc, MutexGuard};

use uuid::Uuid;

use crate::protocol::ServerMsg;
use crate::state::{AppState, Room, Tx};

/// 잠긴 rooms 맵 + 현재 세션의 (방 코드, 플레이어 id)를 함께 들고 있는다.
/// 가드를 들고 코드로 매번 조회해 자기참조(self-reference)를 피한다.
pub(crate) struct RoomGuard<'a> {
    pub rooms: MutexGuard<'a, HashMap<String, Room>>,
    pub code: String,
    pub pid: Uuid,
}

impl RoomGuard<'_> {
    /// (코드, 플레이어 id, &mut Room)을 한 번에 꺼낸다. 방이 사라졌으면 None.
    /// 세 값은 서로 다른 필드에서 나오므로 동시에 사용할 수 있다.
    pub fn parts(&mut self) -> Option<(&str, Uuid, &mut Room)> {
        let room = self.rooms.get_mut(&self.code)?;
        Some((&self.code, self.pid, room))
    }
}

/// 세션 확인 + 방 잠금. 세션이 없으면 **조용히** None (에러 메시지 없음).
pub(crate) fn open<'a>(
    state: &'a Arc<AppState>,
    session: &Option<(String, Uuid)>,
) -> Option<RoomGuard<'a>> {
    let (code, pid) = session.clone()?;
    Some(RoomGuard {
        rooms: state.rooms(),
        code,
        pid,
    })
}

/// 세션 확인 + 방 잠금. 세션이 없으면 에러 메시지를 보내고 None.
pub(crate) fn open_or_err<'a>(
    state: &'a Arc<AppState>,
    session: &Option<(String, Uuid)>,
    tx: &Tx,
) -> Option<RoomGuard<'a>> {
    if session.is_none() {
        let _ = tx.send(ServerMsg::Error {
            message: "방에 참가하지 않았습니다".to_string(),
        });
        return None;
    }
    open(state, session)
}
