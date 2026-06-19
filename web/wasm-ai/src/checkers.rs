//! 체커(영국식 드래프트): 8×8 어두운 칸. 강제 점프 + 멀티 점프 + 킹 승급.
//! board 칸값: 0 빈칸, 1 흑(P1)말, 2 백(P2)말, 3 흑킹, 4 백킹.
//! P1(흑)은 위로(행 감소) 전진·0행에서 승급, P2(백)는 아래로(행 증가)·7행 승급. P1 선공.
//! 규칙 판정 + 반복심화 알파베타 AI. 상태는 문자열(64칸 + 차례 + 무진행 카운터)로 주고받는다.

use crate::clock::now_ms;

pub type Board = [[u8; 8]; 8];

const MATE: i32 = 1_000_000;
const NOPROG_DRAW: i32 = 80; // 80 ply(40수) 무진행이면 무승부

#[inline]
fn owner(v: u8) -> u8 {
    match v {
        1 | 3 => 1,
        2 | 4 => 2,
        _ => 0,
    }
}
#[inline]
fn is_king(v: u8) -> bool {
    v >= 3
}
#[inline]
fn king_of(side: u8) -> u8 {
    if side == 1 { 3 } else { 4 }
}
#[inline]
fn inb(r: i32, c: i32) -> bool {
    (0..8).contains(&r) && (0..8).contains(&c)
}
fn promo_row(side: u8) -> i32 {
    if side == 1 { 0 } else { 7 }
}

/// 말/킹의 점프·이동 방향.
fn dirs_of(v: u8) -> &'static [(i32, i32)] {
    if is_king(v) {
        &[(-1, -1), (-1, 1), (1, -1), (1, 1)]
    } else if owner(v) == 1 {
        &[(-1, -1), (-1, 1)] // P1 위로
    } else {
        &[(1, -1), (1, 1)] // P2 아래로
    }
}

#[derive(Clone)]
pub struct Pos {
    pub board: Board,
    pub turn: u8, // 1 P1, 2 P2
    pub noprog: i32,
}

pub fn start() -> Pos {
    let mut board = [[0u8; 8]; 8];
    for r in 0..8 {
        for c in 0..8 {
            if (r + c) % 2 == 1 {
                if r <= 2 {
                    board[r][c] = 2; // 백(위)
                } else if r >= 5 {
                    board[r][c] = 1; // 흑(아래)
                }
            }
        }
    }
    Pos { board, turn: 1, noprog: 0 }
}

#[derive(Clone)]
pub struct CMove {
    pub path: Vec<(i32, i32)>, // [from, ..., to]
    pub caps: Vec<(i32, i32)>, // 잡힌 칸들
    pub promo: bool,
}
impl CMove {
    pub fn from(&self) -> (i32, i32) {
        self.path[0]
    }
    pub fn to(&self) -> (i32, i32) {
        *self.path.last().unwrap()
    }
}

/// (r,c)에서 시작하는 점프들을 재귀적으로 수집(완성된 점프만 out 에).
fn collect_jumps(
    board: &Board,
    r: i32,
    c: i32,
    val: u8,
    side: u8,
    path: &[(i32, i32)],
    caps: &[(i32, i32)],
    out: &mut Vec<CMove>,
) {
    for &(dr, dc) in dirs_of(val) {
        let (mr, mc) = (r + dr, c + dc);
        let (lr, lc) = (r + 2 * dr, c + 2 * dc);
        if !inb(lr, lc) {
            continue;
        }
        if board[lr as usize][lc as usize] != 0 {
            continue;
        }
        let mid = board[mr as usize][mc as usize];
        if mid == 0 || owner(mid) == side {
            continue;
        }
        // 점프 실행.
        let promo = !is_king(val) && lr == promo_row(side);
        let nval = if promo { king_of(side) } else { val };
        let mut nb = *board;
        nb[r as usize][c as usize] = 0;
        nb[mr as usize][mc as usize] = 0;
        nb[lr as usize][lc as usize] = nval;
        let mut npath = path.to_vec();
        npath.push((lr, lc));
        let mut ncaps = caps.to_vec();
        ncaps.push((mr, mc));
        if !promo {
            let pre = out.len();
            collect_jumps(&nb, lr, lc, nval, side, &npath, &ncaps, out);
            if out.len() == pre {
                out.push(CMove { path: npath, caps: ncaps, promo: false });
            }
        } else {
            // 승급하면 그 수에서 멈춤(영국식).
            out.push(CMove { path: npath, caps: ncaps, promo: true });
        }
    }
}

/// 차례 측의 합법 수. 점프가 하나라도 있으면 점프만(강제 잡기).
pub fn gen_moves(pos: &Pos) -> Vec<CMove> {
    let side = pos.turn;
    let mut jumps = Vec::new();
    for r in 0..8 {
        for c in 0..8 {
            let v = pos.board[r as usize][c as usize];
            if owner(v) == side {
                collect_jumps(&pos.board, r, c, v, side, &[(r, c)], &[], &mut jumps);
            }
        }
    }
    if !jumps.is_empty() {
        return jumps;
    }
    let mut simple = Vec::new();
    for r in 0..8i32 {
        for c in 0..8i32 {
            let v = pos.board[r as usize][c as usize];
            if owner(v) != side {
                continue;
            }
            for &(dr, dc) in dirs_of(v) {
                let (nr, nc) = (r + dr, c + dc);
                if inb(nr, nc) && pos.board[nr as usize][nc as usize] == 0 {
                    let promo = !is_king(v) && nr == promo_row(side);
                    simple.push(CMove { path: vec![(r, c), (nr, nc)], caps: vec![], promo });
                }
            }
        }
    }
    simple
}

pub fn apply(pos: &Pos, m: &CMove) -> Pos {
    let side = pos.turn;
    let (fr, fc) = m.from();
    let (tr, tc) = m.to();
    let val = pos.board[fr as usize][fc as usize];
    let mut nb = pos.board;
    nb[fr as usize][fc as usize] = 0;
    for &(cr, cc) in &m.caps {
        nb[cr as usize][cc as usize] = 0;
    }
    nb[tr as usize][tc as usize] = if m.promo { king_of(side) } else { val };
    // 무진행 카운터: 잡기 또는 말 전진이면 0, 킹 단순이동이면 +1.
    let noprog = if !m.caps.is_empty() || !is_king(val) { 0 } else { pos.noprog + 1 };
    Pos { board: nb, turn: if side == 1 { 2 } else { 1 }, noprog }
}

pub struct Outcome {
    pub status: &'static str, // "playing" | "win" | "draw"
    pub winner: Option<u8>,   // 1 | 2 | (draw: None with status draw)
}

pub fn outcome(pos: &Pos) -> Outcome {
    if pos.noprog >= NOPROG_DRAW {
        return Outcome { status: "draw", winner: None };
    }
    if gen_moves(pos).is_empty() {
        // 둘 수 없음 → 상대 승.
        let w = if pos.turn == 1 { 2 } else { 1 };
        return Outcome { status: "win", winner: Some(w) };
    }
    Outcome { status: "playing", winner: None }
}

// ===== 평가 =====

// 전진 보너스(행별, P1 기준: 0행이 승급). 인덱스 = 행.
#[rustfmt::skip]
const ADV_P1: [i32; 8] = [0, 30, 24, 18, 12, 7, 3, 0];

fn evaluate(pos: &Pos) -> i32 {
    let mut s = 0i32; // P1 관점
    let mut p1 = 0;
    let mut p2 = 0;
    for r in 0..8usize {
        for c in 0..8usize {
            let v = pos.board[r][c];
            if v == 0 {
                continue;
            }
            let center = if (2..=5).contains(&c) { 4 } else { 0 };
            match v {
                1 => {
                    s += 100 + ADV_P1[r] + center;
                    p1 += 1;
                    if r == 7 { s += 6; } // 백랭크 수비
                }
                2 => {
                    s -= 100 + ADV_P1[7 - r] + center;
                    p2 += 1;
                    if r == 0 { s -= 6; }
                }
                3 => {
                    s += 175 + center;
                    p1 += 1;
                }
                4 => {
                    s -= 175 + center;
                    p2 += 1;
                }
                _ => {}
            }
        }
    }
    // 기물 우세 시 교환 장려(적을수록 우세 측이 단순화).
    if p1 != p2 {
        let lead = s.signum();
        s += lead * (12 - (p1 + p2)).max(0) * 2;
    }
    if pos.turn == 1 { s } else { -s }
}

// ===== 탐색 =====

struct Searcher {
    deadline: f64,
    nodes: u64,
    stop: bool,
}
impl Searcher {
    fn time_up(&mut self) -> bool {
        if self.stop {
            return true;
        }
        if self.nodes & 1023 == 0 && now_ms() >= self.deadline {
            self.stop = true;
        }
        self.stop
    }

    fn order(&self, moves: &mut [CMove]) {
        // 잡기 많은 수 먼저(강제 점프면 모두 잡기), 승급 우선.
        moves.sort_by_key(|m| -((m.caps.len() as i32) * 10 + if m.promo { 3 } else { 0 }));
    }

    fn search(&mut self, pos: &Pos, depth: i32, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        if self.time_up() {
            return alpha;
        }
        self.nodes += 1;
        if pos.noprog >= NOPROG_DRAW {
            return 0;
        }
        let mut moves = gen_moves(pos);
        if moves.is_empty() {
            return -MATE + ply; // 둘 수 없음 = 패배
        }
        // 잡기가 남아있으면(전술 진행 중) 깊이 연장.
        let captures_forced = moves[0].caps.len() > 0;
        let d = if captures_forced && depth < 1 { 1 } else { depth };
        if d <= 0 {
            return evaluate(pos);
        }
        self.order(&mut moves);
        let mut best = -MATE * 2;
        for (i, m) in moves.iter().enumerate() {
            let np = apply(pos, m);
            let ext = if m.caps.len() >= 2 { 1 } else { 0 }; // 멀티점프 연장
            let score = if i == 0 {
                -self.search(&np, d - 1 + ext, -beta, -alpha, ply + 1)
            } else {
                let mut sc = -self.search(&np, d - 1 + ext, -alpha - 1, -alpha, ply + 1);
                if sc > alpha && sc < beta {
                    sc = -self.search(&np, d - 1 + ext, -beta, -alpha, ply + 1);
                }
                sc
            };
            if self.stop {
                return best.max(alpha);
            }
            if score > best {
                best = score;
            }
            if score > alpha {
                alpha = score;
            }
            if alpha >= beta {
                break;
            }
        }
        best
    }
}

pub struct Scored {
    pub m: CMove,
    pub score: i32,
}

/// 루트: 반복심화로 deadline까지. 점수 내림차순 정렬된 수 목록.
pub fn search_root(pos: &Pos, deadline: f64, max_depth: i32) -> Vec<Scored> {
    let root = gen_moves(pos);
    if root.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<Scored> = root.into_iter().map(|m| Scored { m, score: 0 }).collect();
    let mut s = Searcher { deadline, nodes: 0, stop: false };
    for depth in 1..=max_depth {
        scored.sort_by(|a, b| b.score.cmp(&a.score));
        let mut alpha = -MATE * 2;
        let beta = MATE * 2;
        let mut completed = true;
        let mut iter: Vec<(usize, i32)> = Vec::new();
        for (idx, sm) in scored.iter().enumerate() {
            let np = apply(pos, &sm.m);
            let sc = -s.search(&np, depth - 1, -beta, -alpha, 1);
            if s.stop {
                completed = false;
                break;
            }
            iter.push((idx, sc));
            if sc > alpha {
                alpha = sc;
            }
        }
        for (idx, sc) in iter {
            scored[idx].score = sc;
        }
        if !completed {
            break;
        }
        if scored.iter().map(|x| x.score).max().unwrap_or(0) >= MATE - 100 {
            break;
        }
        if now_ms() >= deadline {
            break;
        }
    }
    scored.sort_by(|a, b| b.score.cmp(&a.score));
    scored
}

// ===== 직렬화 =====

pub fn parse(s: &str) -> Option<Pos> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    let cells = parts[0].as_bytes();
    if cells.len() != 64 {
        return None;
    }
    let mut board = [[0u8; 8]; 8];
    for i in 0..64 {
        board[i / 8][i % 8] = match cells[i] {
            b'b' => 1,
            b'w' => 2,
            b'B' => 3,
            b'W' => 4,
            _ => 0,
        };
    }
    let turn = if parts.get(1) == Some(&"w") { 2 } else { 1 };
    let noprog = parts.get(2).and_then(|x| x.parse().ok()).unwrap_or(0);
    Some(Pos { board, turn, noprog })
}

pub fn serialize(pos: &Pos) -> String {
    let mut s = String::with_capacity(70);
    for r in 0..8 {
        for c in 0..8 {
            s.push(match pos.board[r][c] {
                1 => 'b',
                2 => 'w',
                3 => 'B',
                4 => 'W',
                _ => '.',
            });
        }
    }
    s.push(' ');
    s.push(if pos.turn == 1 { 'b' } else { 'w' });
    s.push(' ');
    s.push_str(&pos.noprog.to_string());
    s
}
