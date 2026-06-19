//! 오목 AI: 윈도우 패턴 평가 + 알파베타(반복심화) + 즉승/즉방 전술 + VCF.
//! board: 길이 n*n, 0=빈칸, 1=흑(선), 2=백. renju=true면 흑에 렌주 금수 적용
//! (장목·사사·삼삼 금지, 흑은 '정확히 5'로만 승리).

use crate::clock::now_ms;

const WIN: i32 = 100_000_000;
const BLACK: u8 = 1;

pub struct Omok {
    pub n: i32,
    pub win: i32,
    pub cells: Vec<u8>,
    pub renju: bool,
}

impl Omok {
    pub fn new(cells: Vec<u8>, n: i32, win: i32, renju: bool) -> Omok {
        Omok { n, win, cells, renju }
    }
    #[inline]
    fn idx(&self, r: i32, c: i32) -> usize {
        (r * self.n + c) as usize
    }
    #[inline]
    fn get(&self, r: i32, c: i32) -> u8 {
        if r < 0 || c < 0 || r >= self.n || c >= self.n {
            return 255; // 벽
        }
        self.cells[self.idx(r, c)]
    }

    /// (r,c)를 지나는 한 방향의 연속 color 길이(자신 포함).
    fn run_len(&self, r: i32, c: i32, color: u8, dr: i32, dc: i32) -> i32 {
        let mut cnt = 1;
        let mut k = 1;
        while self.get(r + dr * k, c + dc * k) == color {
            cnt += 1;
            k += 1;
        }
        let mut k = 1;
        while self.get(r - dr * k, c - dc * k) == color {
            cnt += 1;
            k += 1;
        }
        cnt
    }

    /// (r,c)에 color를 두면 승리인가. 렌주에서 흑은 '정확히 win목'만 승리(장목은 승리 아님).
    fn makes_win(&self, r: i32, c: i32, color: u8) -> bool {
        let exact = self.renju && color == BLACK;
        for (dr, dc) in [(0, 1), (1, 0), (1, 1), (1, -1)] {
            let cnt = self.run_len(r, c, color, dr, dc);
            if exact {
                if cnt == self.win {
                    return true;
                }
            } else if cnt >= self.win {
                return true;
            }
        }
        false
    }

    // ===== 렌주 금수(흑 전용): 장목·사사·삼삼 =====

    /// (r,c)에 흑을 두는 것이 금수인가. (r,c)는 빈칸 가정.
    fn is_forbidden(&mut self, r: i32, c: i32) -> bool {
        if !self.renju {
            return false;
        }
        let ix = self.idx(r, c);
        if self.cells[ix] != 0 {
            return false;
        }
        self.cells[ix] = BLACK;
        let res = self.classify_forbidden(r, c);
        self.cells[ix] = 0;
        res
    }

    fn classify_forbidden(&self, r: i32, c: i32) -> bool {
        // 정확히 5를 만들면 승리(금수 아님). 5 없이 6목 이상이면 장목.
        let mut overline = false;
        for (dr, dc) in [(0, 1), (1, 0), (1, 1), (1, -1)] {
            let run = self.run_len(r, c, BLACK, dr, dc);
            if run == self.win {
                return false; // 5목 완성 = 승리
            }
            if run > self.win {
                overline = true;
            }
        }
        if overline {
            return true; // 장목
        }
        // 사사/삼삼: 이 수로 새로 생기는 4와 활3의 개수.
        let mut fours = 0;
        let mut threes = 0;
        for (dr, dc) in [(0, 1), (1, 0), (1, 1), (1, -1)] {
            if self.four_in_dir(r, c, dr, dc) {
                fours += 1;
            } else if self.open_three_in_dir(r, c, dr, dc) {
                threes += 1;
            }
        }
        fours >= 2 || threes >= 2
    }

    /// (흑이 (r,c)에 놓인 상태) 이 방향에 '4'(한 수로 정확히 5 완성)가 있는가.
    fn four_in_dir(&self, r: i32, c: i32, dr: i32, dc: i32) -> bool {
        let w = self.win;
        for k in -(w)..=w {
            if k == 0 {
                continue;
            }
            let (er, ec) = (r + dr * k, c + dc * k);
            if self.get(er, ec) != 0 {
                continue;
            }
            // 임시로 채워 정확히 5가 되는지(장목이면 4로 안 침).
            let run = self.run_with(er, ec, BLACK, dr, dc);
            if run == w {
                return true;
            }
        }
        false
    }

    /// (r,c)를 빈칸으로 가정하지 않고, (er,ec)에 color가 있다고 가정한 연속 길이.
    fn run_with(&self, er: i32, ec: i32, color: u8, dr: i32, dc: i32) -> i32 {
        // (er,ec)는 실제로는 빈칸이지만 'color가 놓였다'고 보고 양방향 연속 계산.
        let mut cnt = 1;
        let mut k = 1;
        while self.get(er + dr * k, ec + dc * k) == color {
            cnt += 1;
            k += 1;
        }
        let mut k = 1;
        while self.get(er - dr * k, ec - dc * k) == color {
            cnt += 1;
            k += 1;
        }
        cnt
    }

    /// 이 방향에 '활3'(한 수로 열린 4 _BBBB_ 를 만들 수 있는 3)이 있는가.
    fn open_three_in_dir(&self, r: i32, c: i32, dr: i32, dc: i32) -> bool {
        let w = self.win;
        for k in -(w)..=w {
            if k == 0 {
                continue;
            }
            let (er, ec) = (r + dr * k, c + dc * k);
            if self.get(er, ec) != 0 {
                continue;
            }
            // (er,ec)에 흑을 놓으면 '열린 4'가 되는가: 연속 정확히 4 + 양끝 빈칸.
            let run = self.run_with(er, ec, BLACK, dr, dc);
            if run != w - 1 {
                continue;
            }
            // 양끝이 빈칸인지 확인(열린 4).
            // run의 양 끝 좌표를 찾는다.
            let mut hi = 1;
            while self.get(er + dr * hi, ec + dc * hi) == BLACK {
                hi += 1;
            }
            let mut lo = 1;
            while self.get(er - dr * lo, ec - dc * lo) == BLACK {
                lo += 1;
            }
            let end_a = self.get(er + dr * hi, ec + dc * hi);
            let end_b = self.get(er - dr * lo, ec - dc * lo);
            if end_a == 0 && end_b == 0 {
                return true;
            }
        }
        false
    }

    /// 모든 빈칸 중 흑에게 금수인 칸들의 인덱스(r*n+c). UI 표시·차단용.
    pub fn forbidden_points(&mut self) -> Vec<u32> {
        if !self.renju {
            return Vec::new();
        }
        let mut out = Vec::new();
        for i in 0..(self.n * self.n) {
            if self.cells[i as usize] == 0 {
                let r = i / self.n;
                let c = i % self.n;
                if self.is_forbidden(r, c) {
                    out.push(i as u32);
                }
            }
        }
        out
    }

    fn has_any_stone(&self) -> bool {
        self.cells.iter().any(|&v| v != 0)
    }

    /// 기존 돌 주변(반경 r) 빈칸 후보.
    fn candidates(&self, radius: i32) -> Vec<i32> {
        let n = self.n;
        let mut mark = vec![false; (n * n) as usize];
        let mut out = Vec::new();
        for rr in 0..n {
            for cc in 0..n {
                if self.cells[self.idx(rr, cc)] == 0 {
                    continue;
                }
                for dr in -radius..=radius {
                    for dc in -radius..=radius {
                        let (a, b) = (rr + dr, cc + dc);
                        if a < 0 || b < 0 || a >= n || b >= n {
                            continue;
                        }
                        let i = self.idx(a, b);
                        if self.cells[i] == 0 && !mark[i] {
                            mark[i] = true;
                            out.push(i as i32);
                        }
                    }
                }
            }
        }
        out
    }

    /// 한 색의 윈도우 패턴 점수. (윈도우 안에 상대 돌이 없을 때만 자기 돌 수로 가중)
    fn score_color(&self, color: u8) -> i64 {
        let n = self.n;
        let w = self.win;
        let weight = |own: i32| -> i64 {
            match own {
                0 => 0,
                1 => 1,
                2 => 18,
                3 => 250,
                4 => 4000,
                _ => 500_000, // win 이상
            }
        };
        let mut total: i64 = 0;
        // 4방향 라인 윈도우 스캔.
        let dirs = [(0i32, 1i32), (1, 0), (1, 1), (1, -1)];
        for (dr, dc) in dirs {
            for r in 0..n {
                for c in 0..n {
                    // 윈도우 시작점이 보드 안에서 끝나는지 확인.
                    let er = r + dr * (w - 1);
                    let ec = c + dc * (w - 1);
                    if er < 0 || er >= n || ec < 0 || ec >= n {
                        continue;
                    }
                    let mut own = 0;
                    let mut opp = false;
                    for k in 0..w {
                        let v = self.cells[self.idx(r + dr * k, c + dc * k)];
                        if v == color {
                            own += 1;
                        } else if v != 0 {
                            opp = true;
                            break;
                        }
                    }
                    if !opp {
                        total += weight(own);
                    }
                }
            }
        }
        total
    }

    /// to_move 관점 평가(negamax). 수비를 약간 더 중시.
    fn evaluate(&self, to_move: u8) -> i64 {
        let opp = 3 - to_move;
        self.score_color(to_move) - (self.score_color(opp) * 11) / 10
    }

    /// 후보를 빠른 휴리스틱(공격+수비 가치)으로 정렬해 상위 top_k 반환.
    /// 렌주: 흑(선) 차례면 금수(장목·사사·삼삼)를 후보에서 제외한다.
    fn ordered(&mut self, color: u8, radius: i32, top_k: usize) -> Vec<i32> {
        let opp = 3 - color;
        let filter_forbidden = self.renju && color == BLACK;
        let cands = self.candidates(radius);
        let mut scored: Vec<(i64, i32)> = Vec::with_capacity(cands.len());
        for i in cands {
            let r = i / self.n;
            let c = i % self.n;
            if filter_forbidden && self.is_forbidden(r, c) {
                continue;
            }
            let s = self.place_gain(r, c, color) + self.place_gain(r, c, opp);
            scored.push((s, i));
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.truncate(top_k.max(1));
        scored.into_iter().map(|(_, i)| i).collect()
    }

    /// (r,c)에 color를 두었을 때의 국소 가치(주변 라인 점수 변화 근사).
    fn place_gain(&mut self, r: i32, c: i32, color: u8) -> i64 {
        let i = self.idx(r, c);
        self.cells[i] = color;
        let g = self.local_score(r, c, color);
        self.cells[i] = 0;
        g
    }

    /// (r,c)를 지나는 라인들에서 color의 국소 위협 점수.
    fn local_score(&self, r: i32, c: i32, color: u8) -> i64 {
        let mut s = 0i64;
        for (dr, dc) in [(0i32, 1i32), (1, 0), (1, 1), (1, -1)] {
            let mut cnt = 1;
            let mut open = 0;
            let mut k = 1;
            loop {
                let v = self.get(r + dr * k, c + dc * k);
                if v == color {
                    cnt += 1;
                    k += 1;
                } else {
                    if v == 0 {
                        open += 1;
                    }
                    break;
                }
            }
            let mut k = 1;
            loop {
                let v = self.get(r - dr * k, c - dc * k);
                if v == color {
                    cnt += 1;
                    k += 1;
                } else {
                    if v == 0 {
                        open += 1;
                    }
                    break;
                }
            }
            s += match cnt {
                c if c >= self.win => 1_000_000,
                4 => if open >= 2 { 50_000 } else { open as i64 * 4000 },
                3 => if open >= 2 { 3_000 } else { open as i64 * 250 },
                2 => if open >= 2 { 200 } else { open as i64 * 18 },
                _ => open as i64,
            };
        }
        s
    }

    fn negamax(
        &mut self,
        color: u8,
        depth: i32,
        mut alpha: i64,
        beta: i64,
        ply: i32,
        radius: i32,
        top_k: usize,
        deadline: f64,
        nodes: &mut u64,
        stop: &mut bool,
    ) -> i64 {
        *nodes += 1;
        if *nodes & 511 == 0 && now_ms() >= deadline {
            *stop = true;
        }
        if *stop {
            return self.evaluate(color);
        }
        if depth == 0 {
            return self.evaluate(color);
        }
        let opp = 3 - color;
        // 즉승 수가 있으면 바로.
        let cands = self.ordered(color, radius, top_k);
        if cands.is_empty() {
            return self.evaluate(color);
        }
        let mut best = -WIN as i64 * 2;
        for i in cands {
            let r = i / self.n;
            let c = i % self.n;
            let ix = self.idx(r, c);
            // 즉승 검사.
            self.cells[ix] = color;
            if self.makes_win(r, c, color) {
                self.cells[ix] = 0;
                return WIN as i64 - ply as i64;
            }
            let score = -self.negamax(
                opp, depth - 1, -beta, -alpha, ply + 1, radius, top_k, deadline, nodes, stop,
            );
            self.cells[ix] = 0;
            if *stop {
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

    // ===== VCF (연속 4 강제승 완전탐색) =====

    /// (r,c)에 color를 둔 직후, 그 돌을 지나는 라인에서 'win목을 완성하는 빈칸'들.
    /// (= 그 색이 만든 '열린 4/단순 4'의 완성점) out 에 중복 없이 채운다.
    fn five_pts_through(&self, r: i32, c: i32, color: u8, out: &mut Vec<i32>) {
        out.clear();
        let w = self.win;
        for (dr, dc) in [(0i32, 1i32), (1, 0), (1, 1), (1, -1)] {
            // (r,c)를 포함하는 길이 w 윈도우들.
            for off in -(w - 1)..=0 {
                let sr = r + dr * off;
                let sc = c + dc * off;
                let er = sr + dr * (w - 1);
                let ec = sc + dc * (w - 1);
                if sr < 0 || sc < 0 || sr >= self.n || sc >= self.n {
                    continue;
                }
                if er < 0 || ec < 0 || er >= self.n || ec >= self.n {
                    continue;
                }
                let mut cnt = 0;
                let mut empty_idx = -1;
                let mut empty_cnt = 0;
                let mut opp = false;
                for k in 0..w {
                    let cell = self.cells[self.idx(sr + dr * k, sc + dc * k)];
                    if cell == color {
                        cnt += 1;
                    } else if cell == 0 {
                        empty_idx = self.idx(sr + dr * k, sc + dc * k) as i32;
                        empty_cnt += 1;
                    } else {
                        opp = true;
                        break;
                    }
                }
                if !opp && cnt == w - 1 && empty_cnt == 1 && !out.contains(&empty_idx) {
                    out.push(empty_idx);
                }
            }
        }
    }

    /// VCF: color 차례. 연속으로 '4(포)'만 두어 상대를 강제 수비시키며 강제승 수순을 찾는다.
    /// 강제승의 '첫 수' 인덱스를 반환, 없으면 None. (호출 전제: color에 즉승(완성된 4)이 없음)
    fn vcf(&mut self, color: u8, depth: i32, deadline: f64, nodes: &mut u64) -> Option<i32> {
        if depth <= 0 {
            return None;
        }
        *nodes += 1;
        if *nodes & 255 == 0 && now_ms() >= deadline {
            return None;
        }
        let opp = 3 - color;
        let n = self.n;
        let filter_forbidden = self.renju && color == BLACK;
        let mut tmp: Vec<i32> = Vec::new();
        for m in self.candidates(1) {
            let r = m / n;
            let c = m % n;
            // 렌주: 흑은 금수(사사 등)로 강제승을 만들 수 없다.
            if filter_forbidden && self.is_forbidden(r, c) {
                continue;
            }
            let mi = m as usize;
            self.cells[mi] = color;

            let mut found: Option<i32> = None;
            if self.makes_win(r, c, color) {
                found = Some(m); // 사실상 즉승(전제 위반 대비 안전장치)
            } else {
                self.five_pts_through(r, c, color, &mut tmp);
                if tmp.len() >= 2 {
                    found = Some(m); // 더블 4 = 막을 수 없음
                } else if tmp.len() == 1 {
                    let d = tmp[0];
                    let dr2 = d / n;
                    let dc2 = d % n;
                    let di = d as usize;
                    self.cells[di] = opp; // 상대는 유일 완성점을 강제로 막음
                    let opp_five = self.makes_win(dr2, dc2, opp); // 막는 수가 상대 5를 만들면 실패
                    let win = !opp_five && self.vcf(color, depth - 1, deadline, nodes).is_some();
                    self.cells[di] = 0;
                    if win {
                        found = Some(m);
                    }
                }
            }
            self.cells[mi] = 0;
            if found.is_some() {
                return found;
            }
        }
        None
    }

    /// 루트: 최적 칸 인덱스를 고른다. level: 0 쉬움, 1 중간, 2 어려움, 3 헬.
    pub fn best_move(&mut self, color: u8, level: u8) -> i32 {
        let n = self.n;
        if !self.has_any_stone() {
            return self.idx(n / 2, n / 2) as i32; // 첫 수는 중앙
        }
        // 1) 즉승.
        for i in self.candidates(1) {
            let (r, c) = (i / n, i % n);
            let ix = self.idx(r, c);
            self.cells[ix] = color;
            let win = self.makes_win(r, c, color);
            self.cells[ix] = 0;
            if win {
                return i;
            }
        }
        // 2) 상대 즉승 차단(필수).
        let opp = 3 - color;
        let mut block: Option<i32> = None;
        for i in self.candidates(1) {
            let (r, c) = (i / n, i % n);
            let ix = self.idx(r, c);
            self.cells[ix] = opp;
            let win = self.makes_win(r, c, opp);
            self.cells[ix] = 0;
            if win {
                block = Some(i);
                break;
            }
        }
        if let Some(b) = block {
            // 쉬움은 가끔 못 막게(beatable). 중간 이상은 항상 차단.
            if level == 0 {
                if rand01() < 0.7 {
                    return b;
                }
            } else {
                return b;
            }
        }

        // 3) VCF 강제승 탐색(어려움·헬). 강제승 수순이 있으면 즉시 그 첫 수.
        if level >= 2 {
            let (vdepth, vbudget) = if level >= 3 { (25, 4000.0) } else { (13, 1500.0) };
            let vdeadline = now_ms() + vbudget;
            let mut vnodes: u64 = 0;
            if let Some(m) = self.vcf(color, vdepth, vdeadline, &mut vnodes) {
                return m;
            }
        }

        let (depth, top_k, radius, budget_ms) = match level {
            0 => (2, 8, 1, 150.0),
            1 => (4, 12, 2, 900.0),
            2 => (12, 16, 2, 5000.0),
            _ => (20, 24, 2, 10000.0), // 헬
        };
        let deadline = now_ms() + budget_ms;

        // 루트 후보.
        let root = self.ordered(color, radius, top_k);
        if root.is_empty() {
            // 안전장치: 빈칸 아무거나.
            for i in 0..(n * n) {
                if self.cells[i as usize] == 0 {
                    return i;
                }
            }
            return 0;
        }

        // 쉬움: 얕게 + 무작위성(beatable).
        if level == 0 {
            if rand01() < 0.4 {
                let k = (rand01() * root.len() as f64) as usize;
                return root[k.min(root.len() - 1)];
            }
        }

        let mut best_i = root[0];
        let mut best_score = -WIN as i64 * 2;
        let mut order = root.clone();

        // 반복심화.
        let max_depth = depth;
        let mut nodes: u64 = 0;
        let mut stop = false;
        for d in 1..=max_depth {
            let mut alpha = -WIN as i64 * 2;
            let beta = WIN as i64 * 2;
            let mut iter_best_i = order[0];
            let mut iter_best = -WIN as i64 * 2;
            let mut scores: Vec<(i32, i64)> = Vec::new();
            let mut completed = true;
            for &i in &order {
                let (r, c) = (i / n, i % n);
                let ix = self.idx(r, c);
                self.cells[ix] = color;
                let s = if self.makes_win(r, c, color) {
                    WIN as i64 - 1
                } else {
                    -self.negamax(
                        opp, d - 1, -beta, -alpha, 1, radius, top_k, deadline, &mut nodes, &mut stop,
                    )
                };
                self.cells[ix] = 0;
                if stop {
                    completed = false;
                    break;
                }
                scores.push((i, s));
                if s > iter_best {
                    iter_best = s;
                    iter_best_i = i;
                }
                if s > alpha {
                    alpha = s;
                }
            }
            if completed {
                best_i = iter_best_i;
                best_score = iter_best;
                // 다음 반복을 위해 점수순 재정렬.
                scores.sort_by(|a, b| b.1.cmp(&a.1));
                order = scores.iter().map(|x| x.0).collect();
                if best_score >= WIN as i64 - 1000 {
                    break; // 필승 발견
                }
            }
            if now_ms() >= deadline {
                break;
            }
        }
        let _ = best_score;
        best_i
    }
}

// JS Math.random() 기반 0..1.
fn rand01() -> f64 {
    js_sys::Math::random()
}
