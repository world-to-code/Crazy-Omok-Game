//! 윷놀이 서버 엔진 (N인 2~5, 서버 권위). 클라이언트 web/src/yut 의 board.ts + engine.ts 를 포팅.
//! 던지기는 서버가 굴린다(공정). 규칙: 지름길/백도/업기/잡기/추가던지기/완주.

use rand::Rng;
use serde::Serialize;
use uuid::Uuid;

pub const PIECES_PER_PLAYER: usize = 4;

// ===== 보드 =====

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Outer,
    A,
    B,
}
impl Lane {
    fn as_str(self) -> &'static str {
        match self {
            Lane::Outer => "outer",
            Lane::A => "A",
            Lane::B => "B",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Diag,
    Straight,
}
impl Route {
    pub fn from_str(s: &str) -> Route {
        if s == "straight" {
            Route::Straight
        } else {
            Route::Diag
        }
    }
}

enum Step {
    Node(String, Lane),
    Goal,
}

fn branch_routes(node: &str) -> Vec<Route> {
    if node == "o5" || node == "o10" {
        vec![Route::Diag, Route::Straight]
    } else {
        vec![Route::Diag]
    }
}

fn outer_index(node: &str) -> Option<i32> {
    node.strip_prefix('o').and_then(|r| r.parse::<i32>().ok())
}

// 대각선: 중앙 제외 4점(모↔중앙 2점씩). o0 = 도착 지점(완주는 o0에서 전진 시).
fn step_forward(from: &str, lane: Lane, is_start: bool, route: Route) -> Step {
    if from == "home" {
        return Step::Node("o1".into(), Lane::Outer);
    }
    if from == "o0" {
        return Step::Goal; // 도착 지점에서 앞으로 = 완주
    }
    if is_start {
        if from == "o5" {
            return if route == Route::Straight {
                Step::Node("o6".into(), Lane::Outer)
            } else {
                Step::Node("a1".into(), Lane::A)
            };
        }
        if from == "o10" {
            return if route == Route::Straight {
                Step::Node("o11".into(), Lane::Outer)
            } else {
                Step::Node("b1".into(), Lane::B)
            };
        }
        if from == "c" {
            return Step::Node("b3".into(), Lane::B); // 방에서 질러가기 → 도착 방향
        }
    }
    match from {
        "a1" => return Step::Node("a2".into(), Lane::A),
        "a2" => return Step::Node("c".into(), Lane::A),
        "b1" => return Step::Node("b2".into(), Lane::B),
        "b2" => return Step::Node("c".into(), Lane::B),
        "c" => {
            return if lane == Lane::A {
                Step::Node("a3".into(), Lane::A)
            } else {
                Step::Node("b3".into(), Lane::B)
            }
        }
        "a3" => return Step::Node("a4".into(), Lane::A),
        "a4" => return Step::Node("o15".into(), Lane::Outer),
        "b3" => return Step::Node("b4".into(), Lane::B),
        "b4" => return Step::Node("o0".into(), Lane::Outer), // 지름길 B → 도착 지점
        _ => {}
    }
    if let Some(i) = outer_index(from) {
        if i >= 19 {
            return Step::Node("o0".into(), Lane::Outer); // o19 다음 = 도착 지점(완주 아님)
        }
        return Step::Node(format!("o{}", i + 1), Lane::Outer);
    }
    Step::Goal
}

fn step_back(from: &str, lane: Lane) -> Step {
    match from {
        "home" => Step::Node("home".into(), Lane::Outer),
        "o0" => Step::Node("o19".into(), Lane::Outer), // 도착에서 뒤로
        "a1" => Step::Node("o5".into(), Lane::Outer),
        "a2" => Step::Node("a1".into(), Lane::A),
        "a3" => Step::Node("c".into(), Lane::A),
        "a4" => Step::Node("a3".into(), Lane::A),
        "b1" => Step::Node("o10".into(), Lane::Outer),
        "b2" => Step::Node("b1".into(), Lane::B),
        "b3" => Step::Node("c".into(), Lane::B),
        "b4" => Step::Node("b3".into(), Lane::B),
        "c" => Step::Node("a2".into(), Lane::A),
        "o16" => Step::Node("o15".into(), Lane::Outer),
        _ => {
            if let Some(i) = outer_index(from) {
                Step::Node(format!("o{}", (i - 1).max(0)), Lane::Outer)
            } else {
                Step::Node(from.into(), lane)
            }
        }
    }
}

fn walk(from: &str, lane: Lane, steps: i32, route: Route) -> Step {
    if steps < 0 {
        return step_back(from, lane);
    }
    let mut cur = from.to_string();
    let mut cl = lane;
    for s in 0..steps {
        match step_forward(&cur, cl, s == 0, route) {
            Step::Goal => return Step::Goal,
            Step::Node(node, l) => {
                cur = node;
                cl = l;
            }
        }
        if cur == "o0" && s < steps - 1 {
            return Step::Node(cur, cl); // 도착 지점에서 멈춤(초과 이동 없음)
        }
    }
    Step::Node(cur, cl)
}

// ===== 게임 상태 =====

struct Piece {
    id: u32,
    owner: usize,
    node: String,
    lane: Lane,
    done: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PieceInfo {
    pub id: u32,
    pub owner: usize,
    pub node: String,
    pub lane: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThrowInfo {
    pub name: String,
    pub steps: i32,
    pub bonus: bool,
    pub sticks: [bool; 4],
    #[serde(default)]
    pub nak: bool, // 낙(판 밖) — 무효, 차례 넘어감
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Throw,
    Move,
    Over,
}
impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Throw => "throw",
            Phase::Move => "move",
            Phase::Over => "over",
        }
    }
}

pub struct Target {
    pub key: String,
    pub route: Route,
}

pub struct YutGame {
    pub order: Vec<Uuid>,
    pieces: Vec<Piece>,
    pub turn: usize,
    pub phase: Phase,
    queue: Vec<ThrowInfo>,
    pending_bonus: u32,
    pub winner: Option<usize>,
    pub last_throw: Option<ThrowInfo>,
}

impl YutGame {
    pub fn new(order: &[Uuid]) -> YutGame {
        let mut pieces = Vec::new();
        for owner in 0..order.len() {
            for i in 0..PIECES_PER_PLAYER {
                pieces.push(Piece {
                    id: (owner * PIECES_PER_PLAYER + i) as u32,
                    owner,
                    node: "home".into(),
                    lane: Lane::Outer,
                    done: false,
                });
            }
        }
        YutGame {
            order: order.to_vec(),
            pieces,
            turn: 0,
            phase: Phase::Throw,
            queue: Vec::new(),
            pending_bonus: 0,
            winner: None,
            last_throw: None,
        }
    }

    pub fn current_turn(&self) -> Option<Uuid> {
        self.order.get(self.turn).copied()
    }

    pub fn winner_id(&self) -> Option<Uuid> {
        self.winner.and_then(|w| self.order.get(w).copied())
    }

    // 윷가락 4개를 굴린다(서버 권위). 0번 가락이 백도 표식.
    // power(0~1)가 셀수록 낙 위험↑, 대신 윷/모(대박)도↑.
    pub fn roll(&self, power: f32) -> ThrowInfo {
        let p = power.clamp(0.0, 1.0) as f64;
        let mut rng = rand::thread_rng();
        // 낙: 세게 던질수록 판 밖으로.
        if rng.gen_bool(p * p * 0.3) {
            return ThrowInfo { name: "do".into(), steps: 0, bonus: false, sticks: [false; 4], nak: true };
        }
        // 대박 보너스: 세게 던질수록 윷/모가 더 잘 나온다.
        if rng.gen_bool(p * 0.25) {
            return if rng.gen_bool(0.5) {
                ThrowInfo { name: "yut".into(), steps: 4, bonus: true, sticks: [true; 4], nak: false }
            } else {
                ThrowInfo { name: "mo".into(), steps: 5, bonus: true, sticks: [false; 4], nak: false }
            };
        }
        let sticks = [rng.gen_bool(0.5), rng.gen_bool(0.5), rng.gen_bool(0.5), rng.gen_bool(0.5)];
        let flats = sticks.iter().filter(|b| **b).count();
        let (name, steps): (&str, i32) = if flats == 0 {
            ("mo", 5)
        } else if flats == 4 {
            ("yut", 4)
        } else if flats == 1 && sticks[0] {
            ("backdo", -1)
        } else {
            (["do", "gae", "geol"][flats - 1], flats as i32)
        };
        ThrowInfo { name: name.into(), steps, bonus: name == "yut" || name == "mo", sticks, nak: false }
    }

    pub fn apply_throw(&mut self, t: ThrowInfo) {
        if self.phase != Phase::Throw {
            return;
        }
        // 낙: 무효 — 쌓인 결과까지 잃고 차례가 넘어간다.
        if t.nak {
            self.last_throw = Some(t);
            self.queue.clear();
            self.pending_bonus = 0;
            self.phase = Phase::Throw;
            if !self.order.is_empty() {
                self.turn = (self.turn + 1) % self.order.len();
            }
            return;
        }
        let bonus = t.bonus;
        self.last_throw = Some(t.clone());
        self.queue.push(t);
        if !bonus {
            self.phase = Phase::Move;
        }
    }

    // 현재 차례 플레이어의 합법 이동 선택지(분기 꼭짓점은 지름길/바깥길 둘 다).
    pub fn legal_targets(&self, t: &ThrowInfo) -> Vec<Target> {
        let owner = self.turn;
        let mut out = Vec::new();
        if t.steps > 0 && self.pieces.iter().any(|p| p.owner == owner && !p.done && p.node == "home") {
            out.push(Target { key: "home".into(), route: Route::Diag });
        }
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for p in &self.pieces {
            if p.owner != owner || p.done || p.node == "home" || !seen.insert(p.node.clone()) {
                continue;
            }
            let mut dseen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for route in branch_routes(&p.node) {
                let dest = walk(&p.node, p.lane, t.steps, route);
                let dk = match &dest {
                    Step::Goal => "goal".to_string(),
                    Step::Node(nd, _) => {
                        if *nd == p.node {
                            continue; // 무의미 이동
                        }
                        nd.clone()
                    }
                };
                if dseen.insert(dk) {
                    out.push(Target { key: p.node.clone(), route });
                }
            }
        }
        out
    }

    pub fn is_legal(&self, throw_index: usize, key: &str, route: Route) -> bool {
        let Some(t) = self.queue.get(throw_index) else {
            return false;
        };
        self.legal_targets(t)
            .iter()
            .any(|tg| tg.key == key && tg.route == route)
    }

    // 이동 적용. 잡기/업기/완주/추가던지기 처리. 게임 종료면 true.
    pub fn apply_move(&mut self, throw_index: usize, key: &str, route: Route) -> bool {
        if self.phase != Phase::Move || throw_index >= self.queue.len() {
            return false;
        }
        let t = self.queue[throw_index].clone();
        let owner = self.turn;
        let movers: Vec<usize> = if key == "home" {
            self.pieces
                .iter()
                .enumerate()
                .filter(|(_, p)| p.owner == owner && !p.done && p.node == "home")
                .map(|(i, _)| i)
                .take(1)
                .collect()
        } else {
            self.pieces
                .iter()
                .enumerate()
                .filter(|(_, p)| p.owner == owner && !p.done && p.node == key)
                .map(|(i, _)| i)
                .collect()
        };
        if movers.is_empty() {
            return false;
        }
        let (from_node, from_lane) = {
            let p = &self.pieces[movers[0]];
            (p.node.clone(), p.lane)
        };
        match walk(&from_node, from_lane, t.steps, route) {
            Step::Goal => {
                for &i in &movers {
                    self.pieces[i].done = true;
                    self.pieces[i].node = "goal".into();
                }
            }
            Step::Node(node, lane) => {
                let captured: Vec<usize> = self
                    .pieces
                    .iter()
                    .enumerate()
                    .filter(|(_, p)| p.owner != owner && !p.done && p.node == node)
                    .map(|(i, _)| i)
                    .collect();
                if !captured.is_empty() {
                    for &i in &captured {
                        self.pieces[i].node = "home".into();
                        self.pieces[i].lane = Lane::Outer;
                    }
                    self.pending_bonus += 1;
                }
                for &i in &movers {
                    self.pieces[i].node = node.clone();
                    self.pieces[i].lane = lane;
                }
            }
        }
        self.queue.remove(throw_index);

        let finished = self.pieces.iter().filter(|p| p.owner == owner && p.done).count();
        if finished >= PIECES_PER_PLAYER {
            self.phase = Phase::Over;
            self.winner = Some(owner);
            return true;
        }
        self.advance();
        false
    }

    // 남은 결과가 적용 불가하면 버리고, 큐가 비면 보너스 소진/턴 넘김.
    pub fn discard_unplayable(&mut self) {
        if self.phase != Phase::Move {
            return;
        }
        let playable: Vec<bool> = self
            .queue
            .iter()
            .map(|t| !self.legal_targets(t).is_empty())
            .collect();
        if playable.iter().all(|&b| b) {
            return;
        }
        let mut idx = 0;
        self.queue.retain(|_| {
            let keep = playable[idx];
            idx += 1;
            keep
        });
        if self.queue.is_empty() {
            self.advance();
        }
    }

    fn advance(&mut self) {
        if !self.queue.is_empty() {
            let applicable = self.queue.iter().any(|t| !self.legal_targets(t).is_empty());
            if applicable {
                self.phase = Phase::Move;
                return;
            }
            self.queue.clear();
        }
        if self.pending_bonus > 0 {
            self.pending_bonus -= 1;
            self.phase = Phase::Throw;
            return;
        }
        self.phase = Phase::Throw;
        if !self.order.is_empty() {
            self.turn = (self.turn + 1) % self.order.len();
        }
    }

    // 차례를 강제로 넘긴다(시간 초과 등). 큐/보너스 비우고 다음 사람.
    pub fn skip_turn(&mut self) {
        if self.phase == Phase::Over {
            return;
        }
        self.queue.clear();
        self.pending_bonus = 0;
        self.phase = Phase::Throw;
        if !self.order.is_empty() {
            self.turn = (self.turn + 1) % self.order.len();
        }
    }

    pub fn piece_infos(&self) -> Vec<PieceInfo> {
        self.pieces
            .iter()
            .map(|p| PieceInfo {
                id: p.id,
                owner: p.owner,
                node: p.node.clone(),
                lane: p.lane.as_str().into(),
                done: p.done,
            })
            .collect()
    }

    pub fn queue_infos(&self) -> Vec<ThrowInfo> {
        self.queue.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_games_terminate_2_to_5() {
        for g in 0..400usize {
            let n = 2 + (g % 4); // 2~5인
            let order: Vec<Uuid> = (0..n).map(|_| Uuid::new_v4()).collect();
            let mut y = YutGame::new(&order);
            let mut steps = 0;
            while y.phase != Phase::Over && steps < 200_000 {
                steps += 1;
                match y.phase {
                    Phase::Throw => {
                        let pw = ((g * 13 + steps) % 11) as f32 / 11.0; // 다양한 세기로 낙/대박 검증
                        let r = y.roll(pw);
                        y.apply_throw(r);
                        y.discard_unplayable();
                    }
                    Phase::Move => {
                        let mut acted = false;
                        for ti in 0..y.queue.len() {
                            let t = y.queue[ti].clone();
                            let pick = y.legal_targets(&t).first().map(|tg| (tg.key.clone(), tg.route));
                            if let Some((k, rt)) = pick {
                                y.apply_move(ti, &k, rt);
                                if y.phase == Phase::Move {
                                    y.discard_unplayable();
                                }
                                acted = true;
                                break;
                            }
                        }
                        if !acted {
                            y.skip_turn();
                        }
                    }
                    Phase::Over => break,
                }
            }
            assert_eq!(y.phase, Phase::Over, "game {} ({}인) did not terminate in {} steps", g, n, steps);
            assert!(y.winner.is_some(), "game {} ended without winner", g);
        }
    }

    #[test]
    fn shortcut_and_entry() {
        // home+5 = o5(모). 모서리→중앙은 걸(3): o5+3(diag) = c.
        assert!(matches!(walk("home", Lane::Outer, 5, Route::Diag), Step::Node(ref n, _) if n == "o5"));
        assert!(matches!(walk("o5", Lane::Outer, 3, Route::Diag), Step::Node(ref n, _) if n == "c"));
        assert!(matches!(walk("o5", Lane::Outer, 2, Route::Diag), Step::Node(ref n, _) if n == "a2"));
        // 방에서 질러가기: c+3 = o0(도착 지점). 완주는 그 뒤 전진에서만.
        assert!(matches!(walk("c", Lane::B, 3, Route::Diag), Step::Node(ref n, _) if n == "o0"));
        assert!(matches!(walk("o0", Lane::Outer, 1, Route::Diag), Step::Goal));
        // 도착 지점은 초과 이동 없이 멈춘다: o18+모(5) = o0 (캡).
        assert!(matches!(walk("o18", Lane::Outer, 5, Route::Diag), Step::Node(ref n, _) if n == "o0"));
        // 지름길 A: a4 다음은 o15. 바깥길: o5+4 straight = o9.
        assert!(matches!(walk("a4", Lane::A, 1, Route::Diag), Step::Node(ref n, _) if n == "o15"));
        assert!(matches!(walk("o5", Lane::Outer, 4, Route::Straight), Step::Node(ref n, _) if n == "o9"));
        // 도착 지점에서 백도 → o19.
        assert!(matches!(walk("o0", Lane::Outer, -1, Route::Diag), Step::Node(ref n, _) if n == "o19"));
    }
}
