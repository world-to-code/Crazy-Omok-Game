//! 알까기(초능력) 게임: 턴제 2D 물리. 서버가 권위적으로 발사를 시뮬레이션하고
//! 위치 타임라인을 만들어 클라이언트가 재생한다.
use std::collections::HashMap;

use rand::seq::SliceRandom;
use uuid::Uuid;

use crate::protocol::FlickMarble;

pub const ARENA_R: f64 = 320.0;
pub const MARBLE_R: f64 = 20.0;
const MAX_SPEED: f64 = 1500.0; // power=1 일 때 발사 속도(units/s)
const DT: f64 = 1.0 / 120.0;
const FRICTION: f64 = 1.7; // 속도 감쇠 계수
const RESTITUTION: f64 = 0.92;
const MAX_STEPS: usize = 720; // 최대 6초
const KEYFRAME_EVERY: usize = 5; // 약 24fps로 기록
const STOP_SPEED: f64 = 6.0;
const DMG_K: f64 = 0.006; // 충돌속도→데미지 계수
const EXPLOSION_R: f64 = 120.0;

/// 공격 계열 / 유틸 계열에서 하나씩 뽑아 2개 제시(서로 다른 성격).
const OFFENSE: [&str; 5] = ["explosion", "heavy", "pierce", "spikes", "lifesteal"];
const UTILITY: [&str; 3] = ["iron", "shield", "slingshot"];

pub fn offer_powers() -> Vec<String> {
    let mut rng = rand::thread_rng();
    let a = OFFENSE.choose(&mut rng).copied().unwrap_or("heavy");
    let b = UTILITY.choose(&mut rng).copied().unwrap_or("iron");
    let mut v = vec![a.to_string(), b.to_string()];
    v.shuffle(&mut rng);
    v
}

pub fn is_valid_power(p: &str) -> bool {
    OFFENSE.contains(&p) || UTILITY.contains(&p)
}

pub struct Marble {
    pub owner: Uuid,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub r: f64,
    pub mass: f64,
    pub hp: i32,
    pub max_hp: i32,
    pub atk: i32,
    pub def: i32,
    pub alive: bool,
    pub power: String,
    pub shield: bool,
    pub color_index: u8,
}

impl Marble {
    pub fn info(&self) -> FlickMarble {
        FlickMarble {
            owner: self.owner,
            x: self.x as f32,
            y: self.y as f32,
            r: self.r as f32,
            hp: self.hp,
            max_hp: self.max_hp,
            atk: self.atk,
            def: self.def,
            alive: self.alive,
            power: self.power.clone(),
            shield: self.shield,
            color_index: self.color_index,
        }
    }
}

pub struct DraftOffer {
    pub options: Vec<String>,
    pub picked: Option<String>,
}

pub struct FlickGame {
    pub arena_r: f64,
    pub marbles: Vec<Marble>,
    pub drafting: bool,
    pub draft: HashMap<Uuid, DraftOffer>,
}

impl FlickGame {
    /// 게임 시작: 참가자별 알을 원형으로 배치하고 드래프트 제시.
    pub fn new(order: &[Uuid], colors: &HashMap<Uuid, u8>) -> FlickGame {
        let n = order.len().max(1);
        let ring = ARENA_R * 0.45;
        let mut marbles = Vec::new();
        let mut draft = HashMap::new();
        for (i, &id) in order.iter().enumerate() {
            let ang = std::f64::consts::TAU * (i as f64) / (n as f64) - std::f64::consts::FRAC_PI_2;
            marbles.push(Marble {
                owner: id,
                x: ring * ang.cos(),
                y: ring * ang.sin(),
                vx: 0.0,
                vy: 0.0,
                r: MARBLE_R,
                mass: 1.0,
                hp: 100,
                max_hp: 100,
                atk: 10,
                def: 5,
                alive: true,
                power: String::new(),
                shield: false,
                color_index: colors.get(&id).copied().unwrap_or(0),
            });
            draft.insert(
                id,
                DraftOffer {
                    options: offer_powers(),
                    picked: None,
                },
            );
        }
        FlickGame {
            arena_r: ARENA_R,
            marbles,
            drafting: true,
            draft,
        }
    }

    pub fn marble(&self, owner: Uuid) -> Option<&Marble> {
        self.marbles.iter().find(|m| m.owner == owner)
    }

    pub fn marble_mut(&mut self, owner: Uuid) -> Option<&mut Marble> {
        self.marbles.iter_mut().find(|m| m.owner == owner)
    }

    pub fn infos(&self) -> Vec<FlickMarble> {
        self.marbles.iter().map(|m| m.info()).collect()
    }

    pub fn alive_count(&self) -> usize {
        self.marbles.iter().filter(|m| m.alive).count()
    }

    pub fn last_alive(&self) -> Option<Uuid> {
        let alive: Vec<&Marble> = self.marbles.iter().filter(|m| m.alive).collect();
        if alive.len() == 1 {
            Some(alive[0].owner)
        } else {
            None
        }
    }

    /// 드래프트 선택 적용 + 능력별 기본 스탯 보정.
    pub fn pick(&mut self, owner: Uuid, power: &str) {
        let valid = {
            let Some(d) = self.draft.get_mut(&owner) else {
                return;
            };
            if d.picked.is_some() || !d.options.iter().any(|o| o == power) {
                return;
            }
            d.picked = Some(power.to_string());
            true
        };
        if !valid {
            return;
        }
        if let Some(m) = self.marble_mut(owner) {
            m.power = power.to_string();
            apply_power_stats(m);
        }
    }

    pub fn all_picked(&self) -> bool {
        self.draft.values().all(|d| d.picked.is_some())
    }

    /// 아직 안 고른 사람은 첫 옵션으로 자동 선택.
    pub fn auto_pick_remaining(&mut self) {
        let pending: Vec<(Uuid, String)> = self
            .draft
            .iter()
            .filter(|(_, d)| d.picked.is_none())
            .map(|(&id, d)| (id, d.options.first().cloned().unwrap_or_else(|| "iron".into())))
            .collect();
        for (id, p) in pending {
            self.pick(id, &p);
        }
    }

    /// 발사 해석. shooter가 angle 방향으로 power(0~1) 세기로 발사 →
    /// 멈출 때까지 시뮬, 위치 타임라인 반환. 마블 상태(hp/alive/위치)는 갱신된다.
    /// 반환: (소유자 id 순서, 키프레임별 위치[i16])
    pub fn resolve(
        &mut self,
        shooter: Uuid,
        angle: f64,
        power: f64,
    ) -> (Vec<Uuid>, Vec<Vec<[i16; 2]>>) {
        let ids: Vec<Uuid> = self.marbles.iter().map(|m| m.owner).collect();
        let mut timeline: Vec<Vec<[i16; 2]>> = Vec::new();

        // 발사 속도 설정
        let slingshot = self
            .marble(shooter)
            .map(|m| m.power == "slingshot")
            .unwrap_or(false);
        let speed = power.clamp(0.0, 1.0) * MAX_SPEED * if slingshot { 1.4 } else { 1.0 };
        if let Some(m) = self.marble_mut(shooter) {
            m.vx = angle.cos() * speed;
            m.vy = angle.sin() * speed;
        }

        let mut explosion_fired = false;
        timeline.push(self.frame());

        for step in 0..MAX_STEPS {
            // 적분 + 마찰
            for m in self.marbles.iter_mut() {
                if !m.alive {
                    continue;
                }
                m.x += m.vx * DT;
                m.y += m.vy * DT;
                let decay = 1.0 - FRICTION * DT;
                m.vx *= decay;
                m.vy *= decay;
            }

            // 충돌 (쌍별)
            let n = self.marbles.len();
            for i in 0..n {
                for j in (i + 1)..n {
                    if !self.marbles[i].alive || !self.marbles[j].alive {
                        continue;
                    }
                    self.collide(i, j, shooter, &mut explosion_fired);
                }
            }

            // 장외 판정
            for m in self.marbles.iter_mut() {
                if m.alive && (m.x * m.x + m.y * m.y).sqrt() > self.arena_r {
                    m.alive = false;
                    m.vx = 0.0;
                    m.vy = 0.0;
                }
            }

            if step % KEYFRAME_EVERY == 0 {
                timeline.push(self.frame());
            }

            // 모두 거의 멈추면 종료
            let moving = self
                .marbles
                .iter()
                .any(|m| m.alive && (m.vx * m.vx + m.vy * m.vy).sqrt() > STOP_SPEED);
            if !moving {
                break;
            }
        }
        // 정지: 속도 0
        for m in self.marbles.iter_mut() {
            m.vx = 0.0;
            m.vy = 0.0;
        }
        timeline.push(self.frame());
        (ids, timeline)
    }

    fn frame(&self) -> Vec<[i16; 2]> {
        self.marbles
            .iter()
            .map(|m| [m.x.round() as i16, m.y.round() as i16])
            .collect()
    }

    fn collide(&mut self, i: usize, j: usize, shooter: Uuid, explosion_fired: &mut bool) {
        let (xi, yi, ri) = (self.marbles[i].x, self.marbles[i].y, self.marbles[i].r);
        let (xj, yj, rj) = (self.marbles[j].x, self.marbles[j].y, self.marbles[j].r);
        let dx = xj - xi;
        let dy = yj - yi;
        let dist = (dx * dx + dy * dy).sqrt();
        let min = ri + rj;
        if dist >= min || dist <= 0.0001 {
            return;
        }
        let nx = dx / dist;
        let ny = dy / dist;
        let mi = self.marbles[i].mass;
        let mj = self.marbles[j].mass;

        // 겹침 분리 (질량 반비례)
        let overlap = min - dist;
        let ti = mj / (mi + mj);
        let tj = mi / (mi + mj);
        self.marbles[i].x -= nx * overlap * ti;
        self.marbles[i].y -= ny * overlap * ti;
        self.marbles[j].x += nx * overlap * tj;
        self.marbles[j].y += ny * overlap * tj;

        // 법선 방향 상대속도
        let rvx = self.marbles[j].vx - self.marbles[i].vx;
        let rvy = self.marbles[j].vy - self.marbles[i].vy;
        let vn = rvx * nx + rvy * ny;
        if vn >= 0.0 {
            return; // 멀어지는 중
        }
        let pierce_i = self.marbles[i].power == "pierce";
        let pierce_j = self.marbles[j].power == "pierce";
        let imp = -(1.0 + RESTITUTION) * vn / (1.0 / mi + 1.0 / mj);
        // 관통: 자기 속도 변화를 줄여 뚫고 지나감
        let ki = if pierce_i { 0.35 } else { 1.0 };
        let kj = if pierce_j { 0.35 } else { 1.0 };
        self.marbles[i].vx -= imp * nx / mi * ki;
        self.marbles[i].vy -= imp * ny / mi * ki;
        self.marbles[j].vx += imp * nx / mj * kj;
        self.marbles[j].vy += imp * ny / mj * kj;

        // 데미지 (서로 상대 공격력으로)
        let impact = vn.abs();
        self.damage(i, j, impact);
        self.damage(j, i, impact);

        // 폭발: 발사자의 첫 충돌 시 광역 넉백+데미지
        let i_is_shooter = self.marbles[i].owner == shooter && self.marbles[i].power == "explosion";
        let j_is_shooter = self.marbles[j].owner == shooter && self.marbles[j].power == "explosion";
        if !*explosion_fired && (i_is_shooter || j_is_shooter) {
            let center = if i_is_shooter { i } else { j };
            *explosion_fired = true;
            self.explode(center);
        }
    }

    /// attacker(a)가 victim(v)에게 충돌속도 impact로 입히는 피해.
    fn damage(&mut self, v: usize, a: usize, impact: f64) {
        let atk = self.marbles[a].atk as f64;
        let def = self.marbles[v].def as f64;
        let mut dmg = (impact * DMG_K * atk - def).max(0.0).round() as i32;
        if dmg <= 0 {
            return;
        }
        // 보호막: 첫 피해 무효(소모)
        if self.marbles[v].shield {
            self.marbles[v].shield = false;
            return;
        }
        // 가시: 피해를 입힌 공격자에게 반동 피해
        if self.marbles[v].power == "spikes" {
            let recoil = (dmg / 3).max(1);
            self.apply_hp(a, -recoil);
        }
        self.apply_hp(v, -dmg);
        // 흡혈: 공격자가 입힌 피해의 일부 회복
        if self.marbles[a].power == "lifesteal" {
            self.apply_hp(a, dmg / 2);
        }
        let _ = &mut dmg;
    }

    fn explode(&mut self, center: usize) {
        let (cx, cy) = (self.marbles[center].x, self.marbles[center].y);
        for k in 0..self.marbles.len() {
            if k == center || !self.marbles[k].alive {
                continue;
            }
            let dx = self.marbles[k].x - cx;
            let dy = self.marbles[k].y - cy;
            let d = (dx * dx + dy * dy).sqrt().max(0.001);
            if d > EXPLOSION_R {
                continue;
            }
            let f = (1.0 - d / EXPLOSION_R) * 600.0;
            self.marbles[k].vx += dx / d * f;
            self.marbles[k].vy += dy / d * f;
            self.apply_hp(k, -8);
        }
    }

    fn apply_hp(&mut self, idx: usize, delta: i32) {
        let m = &mut self.marbles[idx];
        m.hp = (m.hp + delta).clamp(0, m.max_hp);
        if m.hp == 0 {
            m.alive = false;
            m.vx = 0.0;
            m.vy = 0.0;
        }
    }
}

fn apply_power_stats(m: &mut Marble) {
    match m.power.as_str() {
        "iron" => {
            m.def += 8;
            m.mass = 2.0;
            m.max_hp += 20;
            m.hp = m.max_hp;
        }
        "heavy" => {
            m.atk += 8;
            m.mass = 1.6;
            m.max_hp += 10;
            m.hp = m.max_hp;
        }
        "shield" => {
            m.shield = true;
        }
        "spikes" => {
            m.def += 2;
        }
        // explosion / pierce / slingshot / lifesteal: 기본 스탯 + 동작으로 표현
        _ => {}
    }
}
