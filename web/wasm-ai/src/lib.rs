//! 오목·체스 봇 엔진 (클라이언트 WebAssembly).
//! - 오목: 윈도우 패턴 평가 + 알파베타.
//! - 체스: 규칙 권위 판정 + 반복심화 알파베타. 상태는 FEN 문자열로 주고받는다.
//!
//! 체스 보드 좌표: board[r][f], r=0 → 8랭크(흑 진영), r=7 → 1랭크(백 진영). 승급은 항상 퀸.

mod chess;
mod clock;
mod omok;

use wasm_bindgen::prelude::*;

use chess::{book_move, outcome, parse_fen, san, search_root, to_fen, Color, Move, Pos, PT};
use clock::now_ms;

// ===== 오목 =====

/// 오목 최적 수. board: 길이 n*n (0 빈/1 흑/2 백). to_move: 1|2. level: 0 쉬움/1 중간/2 어려움.
/// 반환: 둘 칸 인덱스(r*n+c). 둘 곳이 없으면 -1.
#[wasm_bindgen]
pub fn omok_best_move(board: &[u8], n: i32, win: i32, to_move: u8, level: u8, renju: u8) -> i32 {
    if n <= 0 || board.len() != (n * n) as usize {
        return -1;
    }
    let mut g = omok::Omok::new(board.to_vec(), n, win, renju != 0);
    g.best_move(to_move, level)
}

/// 렌주 금수(흑 전용) 빈칸 목록을 인덱스(r*n+c) 배열로 반환. renju=false면 빈 배열.
#[wasm_bindgen]
pub fn omok_forbidden(board: &[u8], n: i32, win: i32) -> Vec<u32> {
    if n <= 0 || board.len() != (n * n) as usize {
        return Vec::new();
    }
    let mut g = omok::Omok::new(board.to_vec(), n, win, true);
    g.forbidden_points()
}

// ===== 체스 =====

fn piece_char(t: PT) -> &'static str {
    match t {
        PT::P => "p",
        PT::N => "n",
        PT::B => "b",
        PT::R => "r",
        PT::Q => "q",
        PT::K => "k",
    }
}

/// board / turn / check / status / winner / pieces(둘 수 있는 출발칸) 을 JSON으로.
fn state_json(p: &Pos) -> String {
    let oc = outcome(p);
    let mut s = String::from("{\"board\":[");
    for r in 0..8 {
        if r > 0 {
            s.push(',');
        }
        s.push('[');
        for f in 0..8 {
            if f > 0 {
                s.push(',');
            }
            match p.board[r][f] {
                None => s.push_str("null"),
                Some(pc) => {
                    let c = if matches!(pc.c, Color::W) { "w" } else { "b" };
                    s.push_str(&format!("{{\"t\":\"{}\",\"c\":\"{}\"}}", piece_char(pc.t), c));
                }
            }
        }
        s.push(']');
    }
    s.push_str("],\"turn\":\"");
    s.push_str(if matches!(p.turn, Color::W) { "w" } else { "b" });
    s.push_str("\",\"check\":");
    s.push_str(if oc.check { "true" } else { "false" });
    s.push_str(",\"status\":\"");
    s.push_str(oc.status);
    s.push_str("\",\"winner\":");
    match oc.winner {
        Some(w) => {
            s.push('"');
            s.push_str(w);
            s.push('"');
        }
        None => s.push_str("null"),
    }
    // 둘 수 있는 출발칸(움직일 기물 선택용).
    s.push_str(",\"pieces\":[");
    let legal = p.legal_moves();
    let mut seen: Vec<(i32, i32)> = Vec::new();
    let mut first = true;
    for m in &legal {
        if !seen.contains(&m.fr) {
            seen.push(m.fr);
            if !first {
                s.push(',');
            }
            first = false;
            s.push_str(&format!("[{},{}]", m.fr.0, m.fr.1));
        }
    }
    s.push_str("]}");
    s
}

fn apply_result_json(prev: &Pos, m: &Move, legal: &[Move]) -> String {
    let note = san(prev, m, legal);
    let np = prev.make(m);
    let fen = to_fen(&np);
    let mut s = String::from("{\"ok\":true,\"fen\":\"");
    s.push_str(&fen);
    s.push_str("\",\"san\":\"");
    s.push_str(&note);
    s.push_str("\",\"from\":[");
    s.push_str(&format!("{},{}", m.fr.0, m.fr.1));
    s.push_str("],\"to\":[");
    s.push_str(&format!("{},{}", m.to.0, m.to.1));
    s.push_str("],\"state\":");
    s.push_str(&state_json(&np));
    s.push('}');
    s
}

/// 시작 위치 FEN.
#[wasm_bindgen]
pub fn chess_start() -> String {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string()
}

/// 현재 FEN의 상태 JSON.
#[wasm_bindgen]
pub fn chess_state(fen: &str) -> String {
    match parse_fen(fen) {
        Some(p) => state_json(&p),
        None => "{\"error\":\"bad fen\"}".to_string(),
    }
}

/// (r,f) 기물의 합법 이동 목적지 목록 JSON: [[r,f],...].
#[wasm_bindgen]
pub fn chess_moves_from(fen: &str, r: i32, f: i32) -> String {
    let Some(p) = parse_fen(fen) else {
        return "[]".to_string();
    };
    let mut s = String::from("[");
    let mut first = true;
    for m in p.legal_moves() {
        if m.fr == (r, f) {
            if !first {
                s.push(',');
            }
            first = false;
            s.push_str(&format!("[{},{}]", m.to.0, m.to.1));
        }
    }
    s.push(']');
    s
}

/// 한 수 적용. 합법수가 아니면 {"ok":false}.
#[wasm_bindgen]
pub fn chess_apply(fen: &str, fr_r: i32, fr_f: i32, to_r: i32, to_f: i32) -> String {
    let Some(p) = parse_fen(fen) else {
        return "{\"ok\":false}".to_string();
    };
    let legal = p.legal_moves();
    match legal
        .iter()
        .find(|m| m.fr == (fr_r, fr_f) && m.to == (to_r, to_f))
        .copied()
    {
        Some(m) => apply_result_json(&p, &m, &legal),
        None => "{\"ok\":false}".to_string(),
    }
}

/// AI 최적 수 계산 후 적용. level: 0 쉬움/1 중간/2 어려움/3 헬.
#[wasm_bindgen]
pub fn chess_ai(fen: &str, level: u8) -> String {
    let Some(p) = parse_fen(fen) else {
        return "{\"ok\":false}".to_string();
    };
    let legal = p.legal_moves();
    if legal.is_empty() {
        return "{\"ok\":false}".to_string();
    }
    // 오프닝북(중간 이상): 위치가 책에 있으면 정석 수를 무작위로.
    if level >= 1 {
        if let Some(m) = book_move(&p) {
            return apply_result_json(&p, &m, &legal);
        }
    }
    let (max_depth, budget_ms): (i32, f64) = match level {
        0 => (4, 250.0),    // 쉬움(그래도 즉수 블런더는 회피)
        1 => (12, 1800.0),  // 중간
        2 => (64, 7000.0),  // 어려움
        _ => (64, 14000.0), // 헬
    };
    let deadline = now_ms() + budget_ms;
    let scored = search_root(&p, deadline, max_depth);
    if scored.is_empty() {
        return "{\"ok\":false}".to_string();
    }

    // 쉬움: 약간의 무작위/블런더로 사람이 이길 여지를 둔다.
    let chosen = if level == 0 {
        let best = scored[0].score;
        // 최선과 80cp 이내 수들 중 무작위. 25% 확률로 더 폭넓게.
        let window = if js_sys::Math::random() < 0.25 { 300 } else { 80 };
        let pool: Vec<&chess::ScoredMove> =
            scored.iter().filter(|sm| best - sm.score <= window).collect();
        let k = (js_sys::Math::random() * pool.len() as f64) as usize;
        pool[k.min(pool.len() - 1)].m
    } else {
        scored[0].m
    };

    apply_result_json(&p, &chosen, &legal)
}
