//! 순수 게임 로직: 방 코드 생성, 승리(연속 N목) 판정.
use std::collections::HashMap;

use rand::Rng;

/// 혼동을 줄이려 0/O/1/I 제외한 6자리 영숫자 코드.
pub fn gen_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// (x, y)에 color를 둔 직후 승리 여부 판정.
/// 승리 시 연속된 돌들의 좌표 목록을 반환.
pub fn check_win(
    board: &HashMap<(u16, u16), u8>,
    x: u16,
    y: u16,
    color: u8,
    win_length: u8,
) -> Option<Vec<[u16; 2]>> {
    const DIRS: [(i32, i32); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];
    let need = win_length as usize;

    for (dx, dy) in DIRS {
        let mut line: Vec<[u16; 2]> = vec![[x, y]];

        // 양의 방향
        let mut cx = x as i32 + dx;
        let mut cy = y as i32 + dy;
        while cx >= 0 && cy >= 0 && same(board, cx, cy, color) {
            line.push([cx as u16, cy as u16]);
            cx += dx;
            cy += dy;
        }
        // 음의 방향
        let mut cx = x as i32 - dx;
        let mut cy = y as i32 - dy;
        while cx >= 0 && cy >= 0 && same(board, cx, cy, color) {
            line.insert(0, [cx as u16, cy as u16]);
            cx -= dx;
            cy -= dy;
        }

        if line.len() >= need {
            return Some(line);
        }
    }
    None
}

fn same(board: &HashMap<(u16, u16), u8>, x: i32, y: i32, color: u8) -> bool {
    board.get(&(x as u16, y as u16)).copied() == Some(color)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizontal_win() {
        let mut b = HashMap::new();
        for i in 0..4u16 {
            b.insert((i, 5), 0);
        }
        b.insert((4, 5), 0);
        assert!(check_win(&b, 4, 5, 0, 5).is_some());
    }

    #[test]
    fn not_enough() {
        let mut b = HashMap::new();
        for i in 0..4u16 {
            b.insert((i, 5), 0);
        }
        assert!(check_win(&b, 3, 5, 0, 5).is_none());
    }

    #[test]
    fn diagonal_win_len3() {
        let mut b = HashMap::new();
        b.insert((0, 0), 2);
        b.insert((1, 1), 2);
        b.insert((2, 2), 2);
        assert!(check_win(&b, 2, 2, 2, 3).is_some());
    }
}
