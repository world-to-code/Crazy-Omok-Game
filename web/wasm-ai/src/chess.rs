//! 클라이언트 권위 체스 엔진: 규칙(이동/합법수/체크/메이트/캐슬링/앙파상/승급) +
//! 반복심화 알파베타 탐색 AI. 서버 chess.rs 규칙을 포팅하고 탐색/평가를 추가했다.

use crate::clock::now_ms;

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
    fn as_str(self) -> &'static str {
        match self {
            Color::W => "w",
            Color::B => "b",
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
    fn as_char(self) -> char {
        match self {
            PT::P => 'p',
            PT::N => 'n',
            PT::B => 'b',
            PT::R => 'r',
            PT::Q => 'q',
            PT::K => 'k',
        }
    }
    fn from_char(c: char) -> Option<PT> {
        Some(match c.to_ascii_lowercase() {
            'p' => PT::P,
            'n' => PT::N,
            'b' => PT::B,
            'r' => PT::R,
            'q' => PT::Q,
            'k' => PT::K,
            _ => return None,
        })
    }
    fn value(self) -> i32 {
        match self {
            PT::P => 100,
            PT::N => 320,
            PT::B => 330,
            PT::R => 500,
            PT::Q => 900,
            PT::K => 20000,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Piece {
    pub t: PT,
    pub c: Color,
}

pub type Board = [[Option<Piece>; 8]; 8];

#[derive(Clone, Copy)]
pub struct Castling {
    pub wk: bool,
    pub wq: bool,
    pub bk: bool,
    pub bq: bool,
}

#[derive(Clone, Copy)]
pub struct Move {
    pub fr: (i32, i32),
    pub to: (i32, i32),
    pub t: PT,
    pub cap: bool,
    pub cap_t: Option<PT>,
    pub ep: bool,
    pub promo: bool,
    pub castle: Option<u8>, // 0=킹사이드, 1=퀸사이드
}

const FILES: [char; 8] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

fn inb(r: i32, f: i32) -> bool {
    (0..8).contains(&r) && (0..8).contains(&f)
}

fn at(b: &Board, r: i32, f: i32) -> Option<Piece> {
    if inb(r, f) {
        b[r as usize][f as usize]
    } else {
        None
    }
}

pub fn find_king(b: &Board, c: Color) -> Option<(i32, i32)> {
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

/// (r,f)가 `by` 색에 의해 공격받는가.
pub fn attacked(b: &Board, r: i32, f: i32, by: Color) -> bool {
    let pd = if by == Color::W { 1 } else { -1 };
    for df in [-1, 1] {
        if let Some(p) = at(b, r + pd, f + df) {
            if p.c == by && p.t == PT::P {
                return true;
            }
        }
    }
    let ks = [
        (-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1),
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
    let mut moves = Vec::with_capacity(48);
    let opp = c.other();
    for r in 0..8i32 {
        for f in 0..8i32 {
            let Some(p) = b[r as usize][f as usize] else {
                continue;
            };
            if p.c != c {
                continue;
            }
            let mut add = |tr: i32, tf: i32, ep_f: bool, promo: bool, castle: Option<u8>| {
                let cap_t = at(b, tr, tf).map(|q| q.t);
                moves.push(Move {
                    fr: (r, f),
                    to: (tr, tf),
                    t: p.t,
                    cap: cap_t.is_some() || ep_f,
                    cap_t: if ep_f { Some(PT::P) } else { cap_t },
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
                        add(r + dir, f, false, r + dir == promo_rank, None);
                        if r == start && b[(r + 2 * dir) as usize][f as usize].is_none() {
                            add(r + 2 * dir, f, false, false, None);
                        }
                    }
                    for df in [-1, 1] {
                        let (nr, nf) = (r + dir, f + df);
                        if !inb(nr, nf) {
                            continue;
                        }
                        if let Some(tg) = b[nr as usize][nf as usize] {
                            if tg.c == opp {
                                add(nr, nf, false, nr == promo_rank, None);
                            }
                        } else if ep == Some((nr, nf)) {
                            add(nr, nf, true, false, None);
                        }
                    }
                }
                PT::N => {
                    for (dr, df) in [
                        (-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1),
                    ] {
                        let (nr, nf) = (r + dr, f + df);
                        if !inb(nr, nf) {
                            continue;
                        }
                        match b[nr as usize][nf as usize] {
                            None => add(nr, nf, false, false, None),
                            Some(tg) if tg.c == opp => add(nr, nf, false, false, None),
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
                                None => add(nr, nf, false, false, None),
                                Some(tg) if tg.c == opp => add(nr, nf, false, false, None),
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
                    let rook_ok = |ff: i32| matches!(b[hr as usize][ff as usize], Some(pp) if pp.t == PT::R);
                    if ck
                        && empty(hr, 5)
                        && empty(hr, 6)
                        && rook_ok(7)
                        && !attacked(b, hr, 4, opp)
                        && !attacked(b, hr, 5, opp)
                        && !attacked(b, hr, 6, opp)
                    {
                        add(hr, 6, false, false, Some(0));
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
                        add(hr, 2, false, false, Some(1));
                    }
                }
                _ => {
                    let dirs: &[(i32, i32)] = match p.t {
                        PT::B => &[(-1, -1), (-1, 1), (1, -1), (1, 1)],
                        PT::R => &[(-1, 0), (1, 0), (0, -1), (0, 1)],
                        _ => &[
                            (-1, -1), (-1, 1), (1, -1), (1, 1), (-1, 0), (1, 0), (0, -1), (0, 1),
                        ],
                    };
                    for &(dr, df) in dirs {
                        let (mut nr, mut nf) = (r + dr, f + df);
                        while inb(nr, nf) {
                            match b[nr as usize][nf as usize] {
                                None => add(nr, nf, false, false, None),
                                Some(tg) => {
                                    if tg.c == opp {
                                        add(nr, nf, false, false, None);
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

fn apply_to_board(b: &Board, castling: &Castling, m: &Move) -> (Board, Castling, Option<(i32, i32)>) {
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
        if r == 7 && f == 0 { cs.wq = false; }
        if r == 7 && f == 7 { cs.wk = false; }
        if r == 0 && f == 0 { cs.bq = false; }
        if r == 0 && f == 7 { cs.bk = false; }
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

// ===== 위치(Position) =====

#[derive(Clone)]
pub struct Pos {
    pub board: Board,
    pub turn: Color,
    pub castling: Castling,
    pub ep: Option<(i32, i32)>,
}

impl Pos {
    pub fn make(&self, m: &Move) -> Pos {
        let (nb, cs, ep) = apply_to_board(&self.board, &self.castling, m);
        Pos {
            board: nb,
            turn: self.turn.other(),
            castling: cs,
            ep,
        }
    }

    pub fn legal_moves(&self) -> Vec<Move> {
        let opp = self.turn.other();
        let mut out = Vec::with_capacity(48);
        for m in gen_pseudo(&self.board, self.turn, &self.castling, self.ep) {
            let (nb, _, _) = apply_to_board(&self.board, &self.castling, &m);
            if let Some(k) = find_king(&nb, self.turn) {
                if !attacked(&nb, k.0, k.1, opp) {
                    out.push(m);
                }
            }
        }
        out
    }

    pub fn in_check(&self, c: Color) -> bool {
        find_king(&self.board, c)
            .map(|k| attacked(&self.board, k.0, k.1, c.other()))
            .unwrap_or(false)
    }
}

// ===== FEN =====

pub fn parse_fen(fen: &str) -> Option<Pos> {
    let parts: Vec<&str> = fen.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let mut board: Board = [[None; 8]; 8];
    let ranks: Vec<&str> = parts[0].split('/').collect();
    if ranks.len() != 8 {
        return None;
    }
    for (r, rank) in ranks.iter().enumerate() {
        let mut f = 0usize;
        for ch in rank.chars() {
            if let Some(d) = ch.to_digit(10) {
                f += d as usize;
            } else {
                let t = PT::from_char(ch)?;
                let c = if ch.is_ascii_uppercase() { Color::W } else { Color::B };
                if r < 8 && f < 8 {
                    board[r][f] = Some(Piece { t, c });
                }
                f += 1;
            }
        }
    }
    let turn = if parts[1] == "w" { Color::W } else { Color::B };
    let cr = parts.get(2).copied().unwrap_or("-");
    let castling = Castling {
        wk: cr.contains('K'),
        wq: cr.contains('Q'),
        bk: cr.contains('k'),
        bq: cr.contains('q'),
    };
    let ep = match parts.get(3).copied().unwrap_or("-") {
        "-" => None,
        s => {
            let b = s.as_bytes();
            if b.len() == 2 {
                let f = (b[0] - b'a') as i32;
                let rank = (b[1] - b'0') as i32; // 1..8
                Some((8 - rank, f))
            } else {
                None
            }
        }
    };
    Some(Pos { board, turn, castling, ep })
}

pub fn to_fen(p: &Pos) -> String {
    let mut s = String::new();
    for r in 0..8 {
        let mut empty = 0;
        for f in 0..8 {
            match p.board[r][f] {
                None => empty += 1,
                Some(pc) => {
                    if empty > 0 {
                        s.push_str(&empty.to_string());
                        empty = 0;
                    }
                    let ch = pc.t.as_char();
                    s.push(if pc.c == Color::W { ch.to_ascii_uppercase() } else { ch });
                }
            }
        }
        if empty > 0 {
            s.push_str(&empty.to_string());
        }
        if r < 7 {
            s.push('/');
        }
    }
    s.push(' ');
    s.push_str(if p.turn == Color::W { "w" } else { "b" });
    s.push(' ');
    let mut cr = String::new();
    if p.castling.wk { cr.push('K'); }
    if p.castling.wq { cr.push('Q'); }
    if p.castling.bk { cr.push('k'); }
    if p.castling.bq { cr.push('q'); }
    if cr.is_empty() { cr.push('-'); }
    s.push_str(&cr);
    s.push(' ');
    match p.ep {
        Some((r, f)) => {
            s.push(FILES[f as usize]);
            s.push_str(&(8 - r).to_string());
        }
        None => s.push('-'),
    }
    s.push_str(" 0 1");
    s
}

// ===== SAN 표기 =====

fn sq_name(s: (i32, i32)) -> String {
    format!("{}{}", FILES[s.1 as usize], 8 - s.0)
}

/// 이동 전 위치(pos)에서 m에 대한 SAN. 체크/메이트 접미사 포함.
pub fn san(pos: &Pos, m: &Move, legal: &[Move]) -> String {
    if m.castle == Some(0) {
        return with_check_suffix("O-O".into(), pos, m);
    }
    if m.castle == Some(1) {
        return with_check_suffix("O-O-O".into(), pos, m);
    }
    let mut s = String::new();
    if m.t == PT::P {
        if m.cap {
            s.push(FILES[m.fr.1 as usize]);
            s.push('x');
        }
        s.push_str(&sq_name(m.to));
        if m.promo {
            s.push_str("=Q");
        }
    } else {
        s.push(m.t.as_char().to_ascii_uppercase());
        // 동종 기물 모호성 해소.
        let ambig: Vec<&Move> = legal
            .iter()
            .filter(|o| o.t == m.t && o.to == m.to && o.fr != m.fr)
            .collect();
        if !ambig.is_empty() {
            let same_file = ambig.iter().any(|o| o.fr.1 == m.fr.1);
            let same_rank = ambig.iter().any(|o| o.fr.0 == m.fr.0);
            if !same_file {
                s.push(FILES[m.fr.1 as usize]);
            } else if !same_rank {
                s.push_str(&(8 - m.fr.0).to_string());
            } else {
                s.push(FILES[m.fr.1 as usize]);
                s.push_str(&(8 - m.fr.0).to_string());
            }
        }
        if m.cap {
            s.push('x');
        }
        s.push_str(&sq_name(m.to));
    }
    with_check_suffix(s, pos, m)
}

fn with_check_suffix(mut s: String, pos: &Pos, m: &Move) -> String {
    let np = pos.make(m);
    if np.in_check(np.turn) {
        if np.legal_moves().is_empty() {
            s.push('#');
        } else {
            s.push('+');
        }
    }
    s
}

// ===== 게임 상태 =====

pub struct Outcome {
    pub status: &'static str, // "playing" | "checkmate" | "stalemate"
    pub winner: Option<&'static str>, // "w"|"b"|"draw"|None
    pub check: bool,
}

pub fn outcome(pos: &Pos) -> Outcome {
    let legal = pos.legal_moves();
    let check = pos.in_check(pos.turn);
    if legal.is_empty() {
        if check {
            Outcome {
                status: "checkmate",
                winner: Some(pos.turn.other().as_str()),
                check: true,
            }
        } else {
            Outcome {
                status: "stalemate",
                winner: Some("draw"),
                check: false,
            }
        }
    } else {
        Outcome {
            status: "playing",
            winner: None,
            check,
        }
    }
}

// ===== 평가 (negamax 관점: 둘 차례 쪽이 양수) =====

#[rustfmt::skip]
const PST_P: [[i32; 8]; 8] = [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [ 5,  5, 10, 25, 25, 10,  5,  5],
    [ 0,  0,  0, 20, 20,  0,  0,  0],
    [ 5, -5,-10,  0,  0,-10, -5,  5],
    [ 5, 10, 10,-20,-20, 10, 10,  5],
    [ 0,  0,  0,  0,  0,  0,  0,  0],
];
#[rustfmt::skip]
const PST_N: [[i32; 8]; 8] = [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50],
];
#[rustfmt::skip]
const PST_B: [[i32; 8]; 8] = [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20],
];
#[rustfmt::skip]
const PST_R: [[i32; 8]; 8] = [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [ 5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [ 0,  0,  0,  5,  5,  0,  0,  0],
];
#[rustfmt::skip]
const PST_Q: [[i32; 8]; 8] = [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20],
];
#[rustfmt::skip]
const PST_K_MID: [[i32; 8]; 8] = [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20],
];
#[rustfmt::skip]
const PST_K_END: [[i32; 8]; 8] = [
    [-50,-40,-30,-20,-20,-30,-40,-50],
    [-30,-20,-10,  0,  0,-10,-20,-30],
    [-30,-10, 20, 30, 30, 20,-10,-30],
    [-30,-10, 30, 40, 40, 30,-10,-30],
    [-30,-10, 30, 40, 40, 30,-10,-30],
    [-30,-10, 20, 30, 30, 20,-10,-30],
    [-30,-30,  0,  0,  0,  0,-30,-30],
    [-50,-30,-30,-30,-30,-30,-30,-50],
];

fn pst(t: PT, c: Color, r: usize, f: usize, endgame: bool) -> i32 {
    // 표는 백 관점(r=0 → rank8). 흑은 상하 반전.
    let (rr, ff) = if c == Color::W { (r, f) } else { (7 - r, f) };
    match t {
        PT::P => PST_P[rr][ff],
        PT::N => PST_N[rr][ff],
        PT::B => PST_B[rr][ff],
        PT::R => PST_R[rr][ff],
        PT::Q => PST_Q[rr][ff],
        PT::K => if endgame { PST_K_END[rr][ff] } else { PST_K_MID[rr][ff] },
    }
}

/// 둘 차례 쪽 관점의 평가(센티폰).
fn evaluate(pos: &Pos) -> i32 {
    let mut mat_total = 0;
    let mut score = 0; // 백 관점
    let mut wb = 0; // 백 비숍 수
    let mut bb = 0;
    let mut wpawn_file = [0i32; 8]; // 파일별 백 폰 수
    let mut bpawn_file = [0i32; 8];
    for r in 0..8 {
        for f in 0..8 {
            if let Some(p) = pos.board[r][f] {
                if p.t != PT::K && p.t != PT::P {
                    mat_total += p.t.value();
                }
                match p.t {
                    PT::B => {
                        if p.c == Color::W { wb += 1; } else { bb += 1; }
                    }
                    PT::P => {
                        if p.c == Color::W { wpawn_file[f] += 1; } else { bpawn_file[f] += 1; }
                    }
                    _ => {}
                }
            }
        }
    }
    let endgame = mat_total <= 1300;
    for r in 0..8 {
        for f in 0..8 {
            if let Some(p) = pos.board[r][f] {
                let v = p.t.value() + pst(p.t, p.c, r, f, endgame);
                if p.c == Color::W {
                    score += v;
                } else {
                    score -= v;
                }
            }
        }
    }
    if wb >= 2 { score += 30; }
    if bb >= 2 { score -= 30; }

    // 폰 구조: 더블폰·고립폰 패널티.
    for f in 0..8 {
        if wpawn_file[f] > 1 { score -= (wpawn_file[f] - 1) * 14; }
        if bpawn_file[f] > 1 { score += (bpawn_file[f] - 1) * 14; }
        let left = if f > 0 { f - 1 } else { f };
        let right = if f < 7 { f + 1 } else { f };
        if wpawn_file[f] > 0 && wpawn_file[left] == 0 && wpawn_file[right] == 0 {
            score -= 14;
        }
        if bpawn_file[f] > 0 && bpawn_file[left] == 0 && bpawn_file[right] == 0 {
            score += 14;
        }
    }

    // 중반: 캐슬링권 유지 보너스(섣부른 킹 이동·캐슬링권 상실 억제) + 킹 폰 방패.
    if !endgame {
        let cr = &pos.castling;
        if cr.wk || cr.wq { score += 20; }
        if cr.bk || cr.bq { score -= 20; }
        score += king_shield(pos, Color::W, &wpawn_file);
        score -= king_shield(pos, Color::B, &bpawn_file);
    }

    if pos.turn == Color::W { score } else { -score }
}

/// 킹 앞 3파일에 자기 폰 방패가 없으면 패널티(중반 한정). 백 관점 부호.
fn king_shield(pos: &Pos, c: Color, _pawn_file: &[i32; 8]) -> i32 {
    let Some((kr, kf)) = find_king(&pos.board, c) else {
        return 0;
    };
    let dir = if c == Color::W { -1 } else { 1 }; // 폰이 전진하는 방향(킹 앞)
    let mut pen = 0;
    for df in -1..=1 {
        let f = kf + df;
        if !(0..8).contains(&f) {
            continue;
        }
        // 킹 바로 앞 두 칸 중 한 칸에라도 자기 폰이 있으면 방패로 인정.
        let mut covered = false;
        for k in 1..=2 {
            let r = kr + dir * k;
            if (0..8).contains(&r) {
                if let Some(p) = pos.board[r as usize][f as usize] {
                    if p.t == PT::P && p.c == c {
                        covered = true;
                        break;
                    }
                }
            }
        }
        if !covered {
            pen += 12;
        }
    }
    -pen
}

// ===== 탐색 =====

const MATE: i32 = 1_000_000;

// ===== Zobrist 해시 + 치환표(TT) =====
use std::sync::OnceLock;

struct Zobrist {
    pieces: [[u64; 64]; 12],
    side: u64,
    castle: [u64; 4],
}

fn splitmix64(x: &mut u64) -> u64 {
    *x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn zobrist() -> &'static Zobrist {
    static Z: OnceLock<Zobrist> = OnceLock::new();
    Z.get_or_init(|| {
        let mut s = 0x0123_4567_89AB_CDEFu64;
        let mut pieces = [[0u64; 64]; 12];
        for row in pieces.iter_mut() {
            for v in row.iter_mut() {
                *v = splitmix64(&mut s);
            }
        }
        let side = splitmix64(&mut s);
        let mut castle = [0u64; 4];
        for v in castle.iter_mut() {
            *v = splitmix64(&mut s);
        }
        Zobrist { pieces, side, castle }
    })
}

fn piece_index(t: PT, c: Color) -> usize {
    let base = match t {
        PT::P => 0,
        PT::N => 1,
        PT::B => 2,
        PT::R => 3,
        PT::Q => 4,
        PT::K => 5,
    };
    base * 2 + if matches!(c, Color::W) { 0 } else { 1 }
}

fn hash(pos: &Pos) -> u64 {
    let z = zobrist();
    let mut h = 0u64;
    for r in 0..8 {
        for f in 0..8 {
            if let Some(p) = pos.board[r][f] {
                h ^= z.pieces[piece_index(p.t, p.c)][r * 8 + f];
            }
        }
    }
    if matches!(pos.turn, Color::B) {
        h ^= z.side;
    }
    if pos.castling.wk { h ^= z.castle[0]; }
    if pos.castling.wq { h ^= z.castle[1]; }
    if pos.castling.bk { h ^= z.castle[2]; }
    if pos.castling.bq { h ^= z.castle[3]; }
    h
}

const TT_BITS: usize = 18;
const TT_SIZE: usize = 1 << TT_BITS;
const TT_MASK: u64 = (TT_SIZE as u64) - 1;

#[derive(Clone, Copy)]
struct TtEntry {
    key: u64,
    depth: i32,
    flag: u8, // 0 exact · 1 lower(>=beta) · 2 upper(<=alpha)
    score: i32,
    mv: (i32, i32, i32, i32),
    used: bool,
}

pub struct Searcher {
    deadline: f64,
    nodes: u64,
    stop: bool,
    killers: Vec<[Option<(i32, i32, i32, i32)>; 2]>,
    tt: Vec<TtEntry>,
}

fn mv_key(m: &Move) -> (i32, i32, i32, i32) {
    (m.fr.0, m.fr.1, m.to.0, m.to.1)
}

impl Searcher {
    fn new(deadline: f64) -> Searcher {
        Searcher {
            deadline,
            nodes: 0,
            stop: false,
            killers: vec![[None, None]; 64],
            tt: vec![
                TtEntry { key: 0, depth: 0, flag: 0, score: 0, mv: (0, 0, 0, 0), used: false };
                TT_SIZE
            ],
        }
    }

    fn time_up(&mut self) -> bool {
        if self.stop {
            return true;
        }
        if self.nodes & 1023 == 0 && now_ms() >= self.deadline {
            self.stop = true;
        }
        self.stop
    }

    fn order(&self, pos: &Pos, moves: &mut Vec<Move>, tt_move: Option<(i32, i32, i32, i32)>, ply: usize) {
        let killers = self.killers.get(ply).copied().unwrap_or([None, None]);
        moves.sort_by_cached_key(|m| {
            let mut s = 0i32;
            if Some(mv_key(m)) == tt_move {
                s += 1_000_000;
            }
            if m.cap {
                let victim = m.cap_t.map(|t| t.value()).unwrap_or(100);
                s += 10_000 + victim - m.t.value() / 10;
            } else if killers[0] == Some(mv_key(m)) || killers[1] == Some(mv_key(m)) {
                s += 9_000;
            }
            if m.promo {
                s += 8_000;
            }
            let _ = pos;
            -s // 오름차순 정렬이므로 부호 반전
        });
    }

    fn quiesce(&mut self, pos: &Pos, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        let stand = evaluate(pos);
        if stand >= beta {
            return beta;
        }
        if stand > alpha {
            alpha = stand;
        }
        if self.time_up() {
            return alpha;
        }
        let mut caps: Vec<Move> = pos.legal_moves().into_iter().filter(|m| m.cap || m.promo).collect();
        caps.sort_by_cached_key(|m| {
            let victim = m.cap_t.map(|t| t.value()).unwrap_or(0);
            -(victim - m.t.value() / 10 + if m.promo { 800 } else { 0 })
        });
        for m in caps {
            let np = pos.make(&m);
            let score = -self.quiesce(&np, -beta, -alpha);
            if self.stop {
                return alpha;
            }
            if score >= beta {
                return beta;
            }
            if score > alpha {
                alpha = score;
            }
        }
        alpha
    }

    fn negamax(&mut self, pos: &Pos, depth: i32, mut alpha: i32, beta: i32, ply: usize) -> i32 {
        if self.time_up() {
            return alpha;
        }
        self.nodes += 1;
        let in_check = pos.in_check(pos.turn);
        let d = if in_check { depth + 1 } else { depth }; // 체크 연장
        if d <= 0 {
            return self.quiesce(pos, alpha, beta);
        }
        // 치환표 조회.
        let key = hash(pos);
        let mut tt_move = None;
        {
            let e = &self.tt[(key & TT_MASK) as usize];
            if e.used && e.key == key {
                tt_move = Some(e.mv);
                if e.depth >= d {
                    match e.flag {
                        0 => return e.score,
                        1 => {
                            if e.score >= beta {
                                return e.score;
                            }
                        }
                        2 => {
                            if e.score <= alpha {
                                return e.score;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        let mut moves = pos.legal_moves();
        if moves.is_empty() {
            return if in_check { -MATE + ply as i32 } else { 0 };
        }
        self.order(pos, &mut moves, tt_move, ply);
        let alpha_orig = alpha;
        let mut best = -MATE * 2;
        let mut best_move = mv_key(&moves[0]);
        for (i, m) in moves.iter().enumerate() {
            let np = pos.make(m);
            // 후반 무이동 감축(LMR): 깊고, 비포획, 체크 아님.
            let mut score;
            if i >= 4 && d >= 3 && !m.cap && !m.promo && !in_check {
                score = -self.negamax(&np, d - 2, -alpha - 1, -alpha, ply + 1);
                if score > alpha {
                    score = -self.negamax(&np, d - 1, -beta, -alpha, ply + 1);
                }
            } else {
                score = -self.negamax(&np, d - 1, -beta, -alpha, ply + 1);
            }
            if self.stop {
                return best.max(alpha);
            }
            if score > best {
                best = score;
                best_move = mv_key(m);
            }
            if score > alpha {
                alpha = score;
            }
            if alpha >= beta {
                if !m.cap {
                    if let Some(k) = self.killers.get_mut(ply) {
                        if k[0] != Some(mv_key(m)) {
                            k[1] = k[0];
                            k[0] = Some(mv_key(m));
                        }
                    }
                }
                break;
            }
        }
        // 치환표 저장(깊이 우선 교체).
        let flag = if best <= alpha_orig {
            2
        } else if best >= beta {
            1
        } else {
            0
        };
        let slot = &mut self.tt[(key & TT_MASK) as usize];
        if !slot.used || slot.depth <= d || slot.key != key {
            *slot = TtEntry { key, depth: d, flag, score: best, mv: best_move, used: true };
        }
        best
    }
}

// ===== 오프닝북 =====

use std::collections::HashMap;

/// 위치 키(배치+차례+캐슬링) → 정석 후보 수(UCI 좌표). 앙파상/수번호는 키에서 제외.
fn opening_book() -> &'static HashMap<&'static str, Vec<&'static str>> {
    static B: OnceLock<HashMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    B.get_or_init(|| {
        let mut m: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
        let mut e = |k: &'static str, v: Vec<&'static str>| {
            m.insert(k, v);
        };
        // 1수
        e("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq", vec!["e2e4", "d2d4", "g1f3", "c2c4"]);
        // 1.e4 응수
        e("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq", vec!["c7c5", "e7e5", "e7e6", "c7c6", "d7d5"]);
        // 1.d4 응수
        e("rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq", vec!["g8f6", "d7d5", "e7e6"]);
        // 1.c4 응수
        e("rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq", vec!["e7e5", "g8f6", "c7c5", "e7e6"]);
        // 1.Nf3 응수
        e("rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq", vec!["d7d5", "g8f6", "c7c5"]);
        // 1.e4 e5
        e("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq", vec!["g1f3", "f1c4", "b1c3"]);
        // 1.e4 e5 2.Nf3
        e("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq", vec!["b8c6", "g8f6"]);
        // 1.e4 e5 2.Nf3 Nc6
        e("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq", vec!["f1b5", "f1c4", "b1c3"]);
        // 1.e4 c5 (시실리안)
        e("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq", vec!["g1f3", "b1c3", "c2c3"]);
        // 1.e4 c5 2.Nf3
        e("rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq", vec!["d7d6", "b8c6", "e7e6"]);
        // 1.e4 e6 (프렌치)
        e("rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq", vec!["d2d4"]);
        // 1.e4 c6 (카로칸)
        e("rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq", vec!["d2d4"]);
        // 1.d4 d5
        e("rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq", vec!["c2c4", "g1f3"]);
        // 1.d4 Nf6
        e("rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq", vec!["c2c4", "g1f3"]);
        // 1.d4 d5 2.c4 (퀸즈갬빗)
        e("rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq", vec!["e7e6", "c7c6", "d5c4"]);
        // 1.c4 e5
        e("rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq", vec!["b1c3", "g1f3"]);
        // 1.Nf3 d5
        e("rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq", vec!["d2d4", "c2c4", "g2g3"]);
        m
    })
}

fn book_key(pos: &Pos) -> String {
    let f = to_fen(pos);
    f.split_whitespace().take(3).collect::<Vec<_>>().join(" ")
}

fn parse_uci(s: &str) -> ((i32, i32), (i32, i32)) {
    let b = s.as_bytes();
    let ff = (b[0] - b'a') as i32;
    let fr = 8 - (b[1] - b'0') as i32;
    let tf = (b[2] - b'a') as i32;
    let tr = 8 - (b[3] - b'0') as i32;
    ((fr, ff), (tr, tf))
}

/// 책에 위치가 있으면 합법 후보 중 하나를 무작위로. 없으면 None.
pub fn book_move(pos: &Pos) -> Option<Move> {
    let entries = opening_book().get(book_key(pos).as_str())?;
    let legal = pos.legal_moves();
    let mut ok: Vec<Move> = Vec::new();
    for s in entries {
        let (fr, to) = parse_uci(s);
        if let Some(m) = legal.iter().find(|m| m.fr == fr && m.to == to) {
            ok.push(*m);
        }
    }
    if ok.is_empty() {
        return None;
    }
    let i = (js_sys::Math::random() * ok.len() as f64) as usize;
    Some(ok[i.min(ok.len() - 1)])
}

pub struct ScoredMove {
    pub m: Move,
    pub score: i32,
}

/// 루트 탐색: 반복심화로 deadline까지. (점수 내림차순 정렬된) 루트 수 목록 반환.
pub fn search_root(pos: &Pos, deadline: f64, max_depth: i32) -> Vec<ScoredMove> {
    let root_moves = pos.legal_moves();
    if root_moves.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<ScoredMove> = root_moves
        .into_iter()
        .map(|m| ScoredMove { m, score: 0 })
        .collect();
    let mut s = Searcher::new(deadline);

    for depth in 1..=max_depth {
        // 직전 반복 점수 순으로 정렬(이동 정렬 향상).
        scored.sort_by(|a, b| b.score.cmp(&a.score));
        let mut alpha = -MATE * 2;
        let beta = MATE * 2;
        let mut completed = true;
        let mut iter_scores: Vec<(usize, i32)> = Vec::new();
        for (idx, sm) in scored.iter().enumerate() {
            let np = pos.make(&sm.m);
            let score = -s.negamax(&np, depth - 1, -beta, -alpha, 1);
            if s.stop {
                completed = false;
                break;
            }
            iter_scores.push((idx, score));
            if score > alpha {
                alpha = score;
            }
        }
        for (idx, sc) in iter_scores {
            scored[idx].score = sc;
        }
        if !completed {
            break;
        }
        // 확실한 메이트를 찾았으면 더 볼 필요 없음.
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
