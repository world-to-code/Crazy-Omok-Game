//! 요트(주사위) 서버 엔진 (N인 2~5, 서버 권위). 클라 web/src/yacht/engine.ts 포팅.
//! 주사위 눈은 서버가 굴린다(공정). 한 턴 최대 3롤(킵/리롤), 12족보, 총점 최고 승리.

use rand::Rng;
use uuid::Uuid;

pub const NUM_CAT: usize = 12; // 0~5: 1~6 / 6:찬스 7:포카드 8:풀하우스 9:S.스트레이트 10:L.스트레이트 11:요트
pub const UPPER_BONUS_THRESHOLD: i32 = 63;
pub const UPPER_BONUS: i32 = 35;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Roll,
    Over,
}
impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Roll => "roll",
            Phase::Over => "over",
        }
    }
}

fn counts(dice: &[u8]) -> [u8; 7] {
    let mut c = [0u8; 7];
    for &d in dice {
        if (1..=6).contains(&d) {
            c[d as usize] += 1;
        }
    }
    c
}
fn die_sum(dice: &[u8]) -> i32 {
    dice.iter().map(|&d| d as i32).sum()
}
fn has_run(c: &[u8; 7], len: u8) -> bool {
    let mut run = 0u8;
    for v in 1..=6 {
        run = if c[v] > 0 { run + 1 } else { 0 };
        if run >= len {
            return true;
        }
    }
    false
}

pub fn category_score(dice: &[u8], cat: usize) -> i32 {
    let c = counts(dice);
    let total = die_sum(dice);
    match cat {
        0..=5 => c[cat + 1] as i32 * (cat as i32 + 1),
        6 => total,
        7 => {
            if c.iter().any(|&n| n >= 4) {
                total
            } else {
                0
            }
        }
        8 => {
            let mut nz: Vec<u8> = c.iter().copied().filter(|&n| n > 0).collect();
            nz.sort_unstable();
            let ok = (nz.len() == 2 && nz[0] == 2 && nz[1] == 3) || c.iter().any(|&n| n == 5);
            if ok {
                total
            } else {
                0
            }
        }
        9 => {
            if has_run(&c, 4) {
                15
            } else {
                0
            }
        }
        10 => {
            if has_run(&c, 5) {
                30
            } else {
                0
            }
        }
        11 => {
            if c.iter().any(|&n| n == 5) {
                50
            } else {
                0
            }
        }
        _ => 0,
    }
}

pub fn total_score(card: &[Option<i32>; NUM_CAT]) -> i32 {
    let upper: i32 = (0..6).map(|i| card[i].unwrap_or(0)).sum();
    let lower: i32 = (6..NUM_CAT).map(|i| card[i].unwrap_or(0)).sum();
    let bonus = if upper >= UPPER_BONUS_THRESHOLD { UPPER_BONUS } else { 0 };
    upper + bonus + lower
}

pub struct YachtGame {
    pub order: Vec<Uuid>,
    pub turn: usize,
    pub dice: [u8; 5],
    pub keep: [bool; 5],
    pub rolls_left: u8,
    pub rolled: bool,
    pub scores: Vec<[Option<i32>; NUM_CAT]>,
    pub phase: Phase,
    pub winner: Option<usize>,
}

impl YachtGame {
    pub fn new(order: &[Uuid]) -> YachtGame {
        YachtGame {
            order: order.to_vec(),
            turn: 0,
            dice: [1; 5],
            keep: [false; 5],
            rolls_left: 3,
            rolled: false,
            scores: vec![[None; NUM_CAT]; order.len()],
            phase: Phase::Roll,
            winner: None,
        }
    }

    pub fn current_turn(&self) -> Option<Uuid> {
        self.order.get(self.turn).copied()
    }
    pub fn winner_id(&self) -> Option<Uuid> {
        self.winner.and_then(|w| self.order.get(w).copied())
    }

    // 굴림: 킵 안 된 주사위만(첫 굴림은 전부) 다시. (새 주사위, 첫굴림여부) 반환.
    pub fn roll(&mut self) -> Option<([u8; 5], bool)> {
        if self.phase != Phase::Roll || self.rolls_left == 0 {
            return None;
        }
        let first = !self.rolled;
        let mut rng = rand::thread_rng();
        for i in 0..5 {
            if first || !self.keep[i] {
                self.dice[i] = rng.gen_range(1..=6);
            }
        }
        self.rolled = true;
        self.rolls_left -= 1;
        Some((self.dice, first))
    }

    pub fn toggle_keep(&mut self, i: usize) {
        if self.rolled && self.phase == Phase::Roll && i < 5 {
            self.keep[i] = !self.keep[i];
        }
    }

    // cat 칸에 현재 주사위로 점수 기록 → 다음 차례. 모두 12칸 채우면 종료(true).
    pub fn score(&mut self, cat: usize) -> bool {
        if self.phase != Phase::Roll || !self.rolled || cat >= NUM_CAT {
            return false;
        }
        if self.scores[self.turn][cat].is_some() {
            return false;
        }
        self.scores[self.turn][cat] = Some(category_score(&self.dice, cat));
        let all_done = self.scores.iter().all(|c| c.iter().all(|v| v.is_some()));
        if all_done {
            let mut best = i32::MIN;
            let mut win = 0;
            for (p, c) in self.scores.iter().enumerate() {
                let t = total_score(c);
                if t > best {
                    best = t;
                    win = p;
                }
            }
            self.phase = Phase::Over;
            self.winner = Some(win);
            return true;
        }
        self.next_turn();
        false
    }

    fn next_turn(&mut self) {
        self.dice = [1; 5];
        self.keep = [false; 5];
        self.rolls_left = 3;
        self.rolled = false;
        if !self.order.is_empty() {
            self.turn = (self.turn + 1) % self.order.len();
        }
    }

    // 시간 초과 등: 강제로 차례 넘김(미기록 시 가장 손해 적은 칸에 0 기록).
    pub fn skip_turn(&mut self) {
        if self.phase == Phase::Over {
            return;
        }
        // 열린 칸 중 하나에 현재 주사위 점수(또는 0) 기록 후 진행 — 게임이 멈추지 않게.
        let open: Vec<usize> = (0..NUM_CAT).filter(|&i| self.scores[self.turn][i].is_none()).collect();
        if let Some(&cat) = open.iter().min_by_key(|&&i| category_score(&self.dice, i)) {
            self.score(cat);
        }
    }

    pub fn scores_flat(&self) -> Vec<Vec<Option<i32>>> {
        self.scores.iter().map(|c| c.to_vec()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_games_terminate() {
        for g in 0..200usize {
            let n = 2 + (g % 4);
            let order: Vec<Uuid> = (0..n).map(|_| Uuid::new_v4()).collect();
            let mut y = YachtGame::new(&order);
            let mut guard = 0;
            while y.phase != Phase::Over && guard < 100_000 {
                guard += 1;
                // 한 턴: 3롤 후 최선 칸 기록.
                while y.rolls_left > 0 {
                    y.roll();
                }
                let open: Vec<usize> =
                    (0..NUM_CAT).filter(|&i| y.scores[y.turn][i].is_none()).collect();
                let cat = *open.iter().max_by_key(|&&i| category_score(&y.dice, i)).unwrap();
                y.score(cat);
            }
            assert_eq!(y.phase, Phase::Over, "game {} ({}인) stuck", g, n);
            assert!(y.winner.is_some());
        }
    }

    #[test]
    fn scoring() {
        assert_eq!(category_score(&[5, 5, 5, 5, 5], 11), 50); // 요트
        assert_eq!(category_score(&[1, 2, 3, 4, 5], 10), 30); // L.스트레이트
        assert_eq!(category_score(&[2, 3, 4, 5, 5], 9), 15); // S.스트레이트
        assert_eq!(category_score(&[3, 3, 3, 2, 2], 8), 13); // 풀하우스 = 합
        assert_eq!(category_score(&[6, 6, 6, 6, 1], 7), 25); // 포카드 = 합
        assert_eq!(category_score(&[6, 6, 6, 6, 1], 4), 0); // '파이브(5눈)' 없음 → 0
        assert_eq!(category_score(&[6, 6, 6, 6, 1], 5), 24); // '식스(6눈)' = 6×4
        assert_eq!(category_score(&[6, 6, 6, 6, 1], 6), 25); // 찬스 = 합
    }
}
