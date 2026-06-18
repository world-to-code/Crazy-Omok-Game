//! 집단지성 체스: 팀 대 팀. 매 턴 ① 움직일 기물 투표 → ② 이동 위치 투표.
//! 체스 규칙(이동/합법수/체크/체크메이트/캐슬링/앙파상/승급)은 서버 권위적으로 판정.
use std::collections::HashMap;

use rand::seq::SliceRandom;
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Color {
    W,
    B,
}
impl Color {
    pub fn other(self) -> Color {
        match self {
            Color::W => Color::B,
            Color::B => Color::W,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Color::W => "w",
            Color::B => "b",
        }
    }
    /// 팀 인덱스: 백=팀0(A), 흑=팀1(B).
    pub fn team(self) -> u8 {
        match self {
            Color::W => 0,
            Color::B => 1,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PT {
    P,
    N,
    B,
    R,
    Q,
    K,
}
impl PT {
    fn as_str(self) -> &'static str {
        match self {
            PT::P => "p",
            PT::N => "n",
            PT::B => "b",
            PT::R => "r",
            PT::Q => "q",
            PT::K => "k",
        }
    }
}

#[derive(Clone, Copy)]
pub struct Piece {
    pub t: PT,
    pub c: Color,
}

type Board = [[Option<Piece>; 8]; 8];

#[derive(Clone, Copy)]
struct Castling {
    wk: bool,
    wq: bool,
    bk: bool,
    bq: bool,
}

#[derive(Clone, Copy)]
struct Move {
    fr: (i32, i32),
    to: (i32, i32),
    t: PT,
    #[allow(dead_code)]
    c: Color,
    cap: bool,
    ep: bool,
    promo: bool,
    castle: Option<u8>, // 0=킹사이드, 1=퀸사이드
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Piece,
    Move,
    Over,
}
impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Piece => "piece",
            Phase::Move => "move",
            Phase::Over => "over",
        }
    }
}

const FILES: [char; 8] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

fn inb(r: i32, f: i32) -> bool {
    (0..8).contains(&r) && (0..8).contains(&f)
}

fn initial_board() -> Board {
    let back = [PT::R, PT::N, PT::B, PT::Q, PT::K, PT::B, PT::N, PT::R];
    let mut b: Board = [[None; 8]; 8];
    for f in 0..8 {
        b[0][f] = Some(Piece { t: back[f], c: Color::B });
        b[1][f] = Some(Piece { t: PT::P, c: Color::B });
        b[6][f] = Some(Piece { t: PT::P, c: Color::W });
        b[7][f] = Some(Piece { t: back[f], c: Color::W });
    }
    b
}

fn find_king(b: &Board, c: Color) -> Option<(i32, i32)> {
    for r in 0..8 {
        for f in 0..8 {
            if let Some(p) = b[r][f] {
                if p.t == PT::K && p.c == c {
                    return Some((r as i32, f as i32));
                }
            }
        }
    }
    None
}

fn at(b: &Board, r: i32, f: i32) -> Option<Piece> {
    if inb(r, f) {
        b[r as usize][f as usize]
    } else {
        None
    }
}

/// (r,f)가 `by` 색에 의해 공격받는가.
fn attacked(b: &Board, r: i32, f: i32, by: Color) -> bool {
    let pd = if by == Color::W { 1 } else { -1 };
    for df in [-1, 1] {
        if let Some(p) = at(b, r + pd, f + df) {
            if p.c == by && p.t == PT::P {
                return true;
            }
        }
    }
    let ks = [
        (-2, -1),
        (-2, 1),
        (-1, -2),
        (-1, 2),
        (1, -2),
        (1, 2),
        (2, -1),
        (2, 1),
    ];
    for (dr, df) in ks {
        if let Some(p) = at(b, r + dr, f + df) {
            if p.c == by && p.t == PT::N {
                return true;
            }
        }
    }
    for dr in -1..=1 {
        for df in -1..=1 {
            if dr == 0 && df == 0 {
                continue;
            }
            if let Some(p) = at(b, r + dr, f + df) {
                if p.c == by && p.t == PT::K {
                    return true;
                }
            }
        }
    }
    for (dr, df) in [(-1, -1), (-1, 1), (1, -1), (1, 1)] {
        let (mut nr, mut nf) = (r + dr, f + df);
        while inb(nr, nf) {
            if let Some(p) = b[nr as usize][nf as usize] {
                if p.c == by && (p.t == PT::B || p.t == PT::Q) {
                    return true;
                }
                break;
            }
            nr += dr;
            nf += df;
        }
    }
    for (dr, df) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
        let (mut nr, mut nf) = (r + dr, f + df);
        while inb(nr, nf) {
            if let Some(p) = b[nr as usize][nf as usize] {
                if p.c == by && (p.t == PT::R || p.t == PT::Q) {
                    return true;
                }
                break;
            }
            nr += dr;
            nf += df;
        }
    }
    false
}

fn gen_pseudo(b: &Board, c: Color, castling: &Castling, ep: Option<(i32, i32)>) -> Vec<Move> {
    let mut moves = Vec::new();
    let opp = c.other();
    for r in 0..8i32 {
        for f in 0..8i32 {
            let Some(p) = b[r as usize][f as usize] else {
                continue;
            };
            if p.c != c {
                continue;
            }
            let mut add = |tr: i32, tf: i32, cap: bool, ep_f: bool, promo: bool, castle: Option<u8>| {
                moves.push(Move {
                    fr: (r, f),
                    to: (tr, tf),
                    t: p.t,
                    c,
                    cap,
                    ep: ep_f,
                    promo,
                    castle,
                });
            };
            match p.t {
                PT::P => {
                    let dir = if c == Color::W { -1 } else { 1 };
                    let start = if c == Color::W { 6 } else { 1 };
                    let promo_rank = if c == Color::W { 0 } else { 7 };
                    if inb(r + dir, f) && b[(r + dir) as usize][f as usize].is_none() {
                        add(r + dir, f, false, false, r + dir == promo_rank, None);
                        if r == start && b[(r + 2 * dir) as usize][f as usize].is_none() {
                            add(r + 2 * dir, f, false, false, false, None);
                        }
                    }
                    for df in [-1, 1] {
                        let (nr, nf) = (r + dir, f + df);
                        if !inb(nr, nf) {
                            continue;
                        }
                        if let Some(tg) = b[nr as usize][nf as usize] {
                            if tg.c == opp {
                                add(nr, nf, true, false, nr == promo_rank, None);
                            }
                        } else if ep == Some((nr, nf)) {
                            add(nr, nf, true, true, false, None);
                        }
                    }
                }
                PT::N => {
                    for (dr, df) in [
                        (-2, -1),
                        (-2, 1),
                        (-1, -2),
                        (-1, 2),
                        (1, -2),
                        (1, 2),
                        (2, -1),
                        (2, 1),
                    ] {
                        let (nr, nf) = (r + dr, f + df);
                        if !inb(nr, nf) {
                            continue;
                        }
                        match b[nr as usize][nf as usize] {
                            None => add(nr, nf, false, false, false, None),
                            Some(tg) if tg.c == opp => add(nr, nf, true, false, false, None),
                            _ => {}
                        }
                    }
                }
                PT::K => {
                    for dr in -1..=1 {
                        for df in -1..=1 {
                            if dr == 0 && df == 0 {
                                continue;
                            }
                            let (nr, nf) = (r + dr, f + df);
                            if !inb(nr, nf) {
                                continue;
                            }
                            match b[nr as usize][nf as usize] {
                                None => add(nr, nf, false, false, false, None),
                                Some(tg) if tg.c == opp => add(nr, nf, true, false, false, None),
                                _ => {}
                            }
                        }
                    }
                    let hr = if c == Color::W { 7 } else { 0 };
                    let (ck, cq) = if c == Color::W {
                        (castling.wk, castling.wq)
                    } else {
                        (castling.bk, castling.bq)
                    };
                    let empty = |rr: i32, ff: i32| b[rr as usize][ff as usize].is_none();
                    let rook_ok = |ff: i32| {
                        matches!(b[hr as usize][ff as usize], Some(pp) if pp.t == PT::R)
                    };
                    if ck
                        && empty(hr, 5)
                        && empty(hr, 6)
                        && rook_ok(7)
                        && !attacked(b, hr, 4, opp)
                        && !attacked(b, hr, 5, opp)
                        && !attacked(b, hr, 6, opp)
                    {
                        add(hr, 6, false, false, false, Some(0));
                    }
                    if cq
                        && empty(hr, 1)
                        && empty(hr, 2)
                        && empty(hr, 3)
                        && rook_ok(0)
                        && !attacked(b, hr, 4, opp)
                        && !attacked(b, hr, 3, opp)
                        && !attacked(b, hr, 2, opp)
                    {
                        add(hr, 2, false, false, false, Some(1));
                    }
                }
                _ => {
                    let dirs: &[(i32, i32)] = match p.t {
                        PT::B => &[(-1, -1), (-1, 1), (1, -1), (1, 1)],
                        PT::R => &[(-1, 0), (1, 0), (0, -1), (0, 1)],
                        _ => &[
                            (-1, -1),
                            (-1, 1),
                            (1, -1),
                            (1, 1),
                            (-1, 0),
                            (1, 0),
                            (0, -1),
                            (0, 1),
                        ],
                    };
                    for &(dr, df) in dirs {
                        let (mut nr, mut nf) = (r + dr, f + df);
                        while inb(nr, nf) {
                            match b[nr as usize][nf as usize] {
                                None => add(nr, nf, false, false, false, None),
                                Some(tg) => {
                                    if tg.c == opp {
                                        add(nr, nf, true, false, false, None);
                                    }
                                    break;
                                }
                            }
                            nr += dr;
                            nf += df;
                        }
                    }
                }
            }
        }
    }
    moves
}

/// 한 수를 적용해 새 보드/캐슬링/앙파상을 만든다.
fn apply_move(b: &Board, castling: &Castling, m: &Move) -> (Board, Castling, Option<(i32, i32)>) {
    let mut nb = *b;
    let piece = nb[m.fr.0 as usize][m.fr.1 as usize].unwrap();
    if m.ep {
        nb[m.fr.0 as usize][m.to.1 as usize] = None;
    }
    nb[m.fr.0 as usize][m.fr.1 as usize] = None;
    let np = Piece {
        t: if m.promo { PT::Q } else { piece.t },
        c: piece.c,
    };
    nb[m.to.0 as usize][m.to.1 as usize] = Some(np);
    if m.castle == Some(0) {
        nb[m.to.0 as usize][5] = nb[m.to.0 as usize][7];
        nb[m.to.0 as usize][7] = None;
    }
    if m.castle == Some(1) {
        nb[m.to.0 as usize][3] = nb[m.to.0 as usize][0];
        nb[m.to.0 as usize][0] = None;
    }
    let mut cs = *castling;
    if piece.t == PT::K {
        if piece.c == Color::W {
            cs.wk = false;
            cs.wq = false;
        } else {
            cs.bk = false;
            cs.bq = false;
        }
    }
    let mut clr = |r: i32, f: i32| {
        if r == 7 && f == 0 {
            cs.wq = false;
        }
        if r == 7 && f == 7 {
            cs.wk = false;
        }
        if r == 0 && f == 0 {
            cs.bq = false;
        }
        if r == 0 && f == 7 {
            cs.bk = false;
        }
    };
    clr(m.fr.0, m.fr.1);
    clr(m.to.0, m.to.1);
    let ep = if piece.t == PT::P && (m.to.0 - m.fr.0).abs() == 2 {
        Some(((m.to.0 + m.fr.0) / 2, m.fr.1))
    } else {
        None
    };
    (nb, cs, ep)
}

fn gen_legal(b: &Board, c: Color, castling: &Castling, ep: Option<(i32, i32)>) -> Vec<Move> {
    let opp = c.other();
    let mut out = Vec::new();
    for m in gen_pseudo(b, c, castling, ep) {
        let (nb, _, _) = apply_move(b, castling, &m);
        if let Some(k) = find_king(&nb, c) {
            if !attacked(&nb, k.0, k.1, opp) {
                out.push(m);
            }
        }
    }
    out
}

fn sq_name(s: (i32, i32)) -> String {
    format!("{}{}", FILES[s.1 as usize], 8 - s.0)
}

fn notation(m: &Move, _board: &Board) -> String {
    if m.castle == Some(0) {
        return "O-O".into();
    }
    if m.castle == Some(1) {
        return "O-O-O".into();
    }
    let pl = if m.t == PT::P {
        String::new()
    } else {
        m.t.as_str().to_uppercase()
    };
    let cap = if m.cap || m.ep { "x" } else { "" };
    let pre = if m.t == PT::P && (m.cap || m.ep) {
        FILES[m.fr.1 as usize].to_string()
    } else {
        String::new()
    };
    let promo = if m.promo { "=Q" } else { "" };
    format!("{}{}{}{}{}", pl, pre, cap, sq_name(m.to), promo)
}

pub struct ChessGame {
    board: Board,
    pub turn: Color,
    castling: Castling,
    ep: Option<(i32, i32)>,
    pub phase: Phase,
    selected: Option<(i32, i32)>,
    pub votes: HashMap<Uuid, (i32, i32)>,
    pub history: Vec<String>,
    last_move: Option<((i32, i32), (i32, i32))>,
    pub status: String,
    pub winner: Option<String>,
    legal: Vec<Move>,
}

impl ChessGame {
    pub fn new() -> ChessGame {
        let board = initial_board();
        let castling = Castling {
            wk: true,
            wq: true,
            bk: true,
            bq: true,
        };
        let legal = gen_legal(&board, Color::W, &castling, None);
        ChessGame {
            board,
            turn: Color::W,
            castling,
            ep: None,
            phase: Phase::Piece,
            selected: None,
            votes: HashMap::new(),
            history: Vec::new(),
            last_move: None,
            status: String::new(),
            winner: None,
            legal,
        }
    }

    /// 현재 단계에서 투표 가능한 칸들.
    pub fn options(&self) -> Vec<(i32, i32)> {
        match self.phase {
            Phase::Piece => {
                let mut seen = Vec::new();
                for m in &self.legal {
                    if !seen.contains(&m.fr) {
                        seen.push(m.fr);
                    }
                }
                seen
            }
            Phase::Move => {
                let sel = match self.selected {
                    Some(s) => s,
                    None => return Vec::new(),
                };
                self.legal
                    .iter()
                    .filter(|m| m.fr == sel)
                    .map(|m| m.to)
                    .collect()
            }
            Phase::Over => Vec::new(),
        }
    }

    pub fn is_votable(&self, sq: (i32, i32)) -> bool {
        self.options().contains(&sq)
    }

    pub fn vote(&mut self, pid: Uuid, sq: (i32, i32)) -> bool {
        if self.phase == Phase::Over || !self.is_votable(sq) {
            return false;
        }
        // 같은 칸 다시 누르면 취소(토글).
        if self.votes.get(&pid) == Some(&sq) {
            self.votes.remove(&pid);
        } else {
            self.votes.insert(pid, sq);
        }
        true
    }

    pub fn tally(&self) -> HashMap<(i32, i32), u32> {
        let mut m = HashMap::new();
        for &sq in self.votes.values() {
            *m.entry(sq).or_insert(0) += 1;
        }
        m
    }

    fn pick_winner(&self, opts: &[(i32, i32)]) -> (i32, i32) {
        let mut rng = rand::thread_rng();
        let counts = self.tally();
        let max = counts.values().copied().max().unwrap_or(0);
        if max == 0 {
            // 표가 없으면 무작위.
            return *opts.choose(&mut rng).unwrap();
        }
        let winners: Vec<(i32, i32)> = opts
            .iter()
            .copied()
            .filter(|sq| counts.get(sq).copied().unwrap_or(0) == max)
            .collect();
        *winners.choose(&mut rng).unwrap()
    }

    /// 현재 단계 투표를 확정한다. 반환: 게임 종료 여부.
    /// piece 단계 → move 단계로, move 단계 → 수를 두고 다음 팀 piece 단계로.
    pub fn resolve(&mut self) -> bool {
        let opts = self.options();
        if opts.is_empty() {
            return self.phase == Phase::Over;
        }
        match self.phase {
            Phase::Piece => {
                let sel = self.pick_winner(&opts);
                self.selected = Some(sel);
                self.phase = Phase::Move;
                self.votes.clear();
                false
            }
            Phase::Move => {
                let dest = self.pick_winner(&opts);
                let sel = self.selected.unwrap();
                let mv = self
                    .legal
                    .iter()
                    .find(|m| m.fr == sel && m.to == dest)
                    .copied();
                self.votes.clear();
                self.selected = None;
                let Some(mv) = mv else {
                    // 안전장치: 합법수 못 찾으면 단계만 리셋.
                    self.phase = Phase::Piece;
                    return false;
                };
                let note = notation(&mv, &self.board);
                let (nb, cs, ep) = apply_move(&self.board, &self.castling, &mv);
                self.board = nb;
                self.castling = cs;
                self.ep = ep;
                self.last_move = Some((mv.fr, mv.to));
                self.history.push(note);
                let mover = self.turn;
                self.turn = self.turn.other();
                self.legal = gen_legal(&self.board, self.turn, &self.castling, self.ep);
                let in_check = find_king(&self.board, self.turn)
                    .map(|k| attacked(&self.board, k.0, k.1, self.turn.other()))
                    .unwrap_or(false);
                if self.legal.is_empty() {
                    self.phase = Phase::Over;
                    self.status = if in_check { "체크메이트".into() } else { "스테일메이트".into() };
                    self.winner = Some(if in_check {
                        mover.as_str().to_string()
                    } else {
                        "draw".to_string()
                    });
                    true
                } else {
                    self.status = if in_check { "체크!".into() } else { String::new() };
                    self.phase = Phase::Piece;
                    false
                }
            }
            Phase::Over => true,
        }
    }

    // ===== 직렬화 =====
    pub fn board_infos(&self) -> Vec<Vec<Option<crate::protocol::ChessPiece>>> {
        self.board
            .iter()
            .map(|row| {
                row.iter()
                    .map(|c| {
                        c.map(|p| crate::protocol::ChessPiece {
                            t: p.t.as_str().to_string(),
                            c: p.c.as_str().to_string(),
                        })
                    })
                    .collect()
            })
            .collect()
    }
    pub fn option_infos(&self) -> Vec<[u8; 2]> {
        self.options()
            .iter()
            .map(|&(r, f)| [r as u8, f as u8])
            .collect()
    }
    pub fn selected_info(&self) -> Option<[u8; 2]> {
        self.selected.map(|(r, f)| [r as u8, f as u8])
    }
    pub fn last_move_info(&self) -> Option<[[u8; 2]; 2]> {
        self.last_move
            .map(|(a, b)| [[a.0 as u8, a.1 as u8], [b.0 as u8, b.1 as u8]])
    }
    pub fn tally_infos(&self) -> Vec<crate::protocol::ChessVoteCell> {
        self.tally()
            .into_iter()
            .map(|((r, f), count)| crate::protocol::ChessVoteCell {
                r: r as u8,
                f: f as u8,
                count,
            })
            .collect()
    }
}
