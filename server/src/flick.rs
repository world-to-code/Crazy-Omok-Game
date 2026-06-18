//! 알까기(초능력) 게임: 턴제 2D 물리. 서버가 권위적으로 발사를 시뮬레이션하고
//! 위치 타임라인을 만들어 클라이언트가 재생한다.
use std::collections::HashMap;

use rand::seq::SliceRandom;
use rand::Rng;
use uuid::Uuid;

use crate::protocol::FlickMarble;

pub const ARENA_R: f64 = 1450.0; // 오픈월드급(기존 대비 약 20배 면적)
pub const MARBLE_R: f64 = 26.0;
const MAX_SPEED: f64 = 2600.0; // power=1 일 때 발사 속도(units/s)
const DT: f64 = 1.0 / 120.0;
const FRICTION: f64 = 1.0; // 속도 감쇠 계수(낮을수록 멀리 미끄러짐)
const RESTITUTION: f64 = 0.92;
const MAX_STEPS: usize = 900;
const KEYFRAME_EVERY: usize = 6; // 약 20fps로 기록
const STOP_SPEED: f64 = 8.0;
const DMG_K: f64 = 0.0019; // 충돌속도→데미지 계수 (게임이 늘어지지 않게 상향)
const DMG_CAP: i32 = 40; // 보통 능력의 한 번 충돌 최대 피해
const POWER_CAP: f64 = 1.0; // 보통 능력의 발사 세기 상한
const POWER_CAP_UNLIMITED: f64 = 2.6; // '무제한' 능력(슬링샷)의 상한
const WALL_RESTITUTION: f64 = 0.9;
const EXPLOSION_R: f64 = 120.0;
// 장애물 효과 세기 (필드는 매 스텝 누적되므로 과하지 않게)
const GRAV_ACCEL: f64 = 850.0;
const WIND_ACCEL: f64 = 650.0;
const BOOST_MULT: f64 = 1.018;
const SWAMP_MULT: f64 = 0.92;
// 필드 아이템(획득형 버프)
const ITEM_R: f64 = 30.0;
const ITEM_MAX_FIELD: usize = 8; // 필드에 동시에 유지되는 최대 개수
const ITEM_MAX_PER_TURN: usize = 4; // 한 턴에 최대 생성 개수
const ITEM_SPAWN_CHANCE: f64 = 0.65; // 턴마다 아이템이 (1개 이상) 생길 확률

/// 필드 아이템 10종. 알이 지나가며 획득하면 효과 발동(영구/1회).
#[derive(Clone, Copy, PartialEq)]
pub enum ItemKind {
    DmgUp,     // 다음 공격 데미지 +20% (1회)
    Crit,      // 다음 공격 데미지 2배 (1회)
    Shield,    // 공격 1회 무효
    AtkPerm,   // 공격력 +1 (영구)
    DefPerm,   // 방어력 +1 (영구)
    Heal,      // 잃은 체력 50% 회복
    MaxHp,     // 최대 체력 +20 (+그만큼 회복)
    Power,     // 다음 발사 세기 +30% (1회)
    Lifesteal, // 다음 공격 입힌 피해 50% 회복 (1회)
    Explode,   // 다음 충돌 시 폭발 (1회)
}

const ALL_ITEMS: [ItemKind; 10] = [
    ItemKind::DmgUp,
    ItemKind::Crit,
    ItemKind::Shield,
    ItemKind::AtkPerm,
    ItemKind::DefPerm,
    ItemKind::Heal,
    ItemKind::MaxHp,
    ItemKind::Power,
    ItemKind::Lifesteal,
    ItemKind::Explode,
];

impl ItemKind {
    fn as_str(&self) -> &'static str {
        match self {
            ItemKind::DmgUp => "dmg_up",
            ItemKind::Crit => "crit",
            ItemKind::Shield => "shield",
            ItemKind::AtkPerm => "atk",
            ItemKind::DefPerm => "def",
            ItemKind::Heal => "heal",
            ItemKind::MaxHp => "maxhp",
            ItemKind::Power => "power",
            ItemKind::Lifesteal => "lifesteal",
            ItemKind::Explode => "explode",
        }
    }
}

#[derive(Clone, Copy)]
pub struct Item {
    pub kind: ItemKind,
    pub x: f64,
    pub y: f64,
}

impl Item {
    fn info(&self) -> crate::protocol::FlickItem {
        crate::protocol::FlickItem {
            kind: self.kind.as_str().to_string(),
            x: self.x as f32,
            y: self.y as f32,
            r: ITEM_R as f32,
        }
    }
}

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

// ===== 장애물/디버프 10종 =====
// 솔리드(부딪히면 튕김): rock·spike·bumper·bomb (원형)
// 필드(통과하며 효과): swamp·ice·lava·boost·gravity·wind (사각/원형)
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ObKind {
    Rock,     // 단단한 바위 — 튕김
    Spike,    // 가시 — 튕김 + 피해
    Bumper,   // 범퍼 — 강하게 튕겨냄
    Bomb,     // 폭탄 — 부딪히면 폭발(광역 넉백+피해)
    Swamp,    // 늪 — 크게 감속
    Ice,      // 빙판 — 마찰↓(미끄러짐)
    Lava,     // 용암 — 머무는 동안 피해
    Boost,    // 부스터 — 가속
    Gravity,  // 중력장 — 중심으로 끌어당김
    Wind,     // 돌풍 — 한 방향으로 밀어냄
}

impl ObKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ObKind::Rock => "rock",
            ObKind::Spike => "spike",
            ObKind::Bumper => "bumper",
            ObKind::Bomb => "bomb",
            ObKind::Swamp => "swamp",
            ObKind::Ice => "ice",
            ObKind::Lava => "lava",
            ObKind::Boost => "boost",
            ObKind::Gravity => "gravity",
            ObKind::Wind => "wind",
        }
    }
    fn is_solid(self) -> bool {
        matches!(self, ObKind::Rock | ObKind::Spike | ObKind::Bumper | ObKind::Bomb)
    }
    fn is_circle(self) -> bool {
        // 솔리드와 중력장은 원형, 나머지 필드는 사각형.
        self.is_solid() || self == ObKind::Gravity
    }
}

const ALL_OBKINDS: [ObKind; 10] = [
    ObKind::Rock,
    ObKind::Spike,
    ObKind::Bumper,
    ObKind::Bomb,
    ObKind::Swamp,
    ObKind::Ice,
    ObKind::Lava,
    ObKind::Boost,
    ObKind::Gravity,
    ObKind::Wind,
];

#[derive(Clone, Copy)]
pub struct Obstacle {
    pub kind: ObKind,
    pub x: f64,
    pub y: f64,
    pub r: f64,   // 원형 반지름
    pub w: f64,   // 사각 가로(절반 아님, 전체)
    pub h: f64,   // 사각 세로
    pub dir: f64, // 돌풍 방향(라디안)
}

impl Obstacle {
    fn contains(&self, x: f64, y: f64) -> bool {
        if self.kind.is_circle() {
            let dx = x - self.x;
            let dy = y - self.y;
            dx * dx + dy * dy <= self.r * self.r
        } else {
            (x - self.x).abs() <= self.w / 2.0 && (y - self.y).abs() <= self.h / 2.0
        }
    }
    pub fn info(&self) -> crate::protocol::FlickObstacle {
        crate::protocol::FlickObstacle {
            kind: self.kind.as_str().to_string(),
            shape: if self.kind.is_circle() { "circle" } else { "rect" }.to_string(),
            x: self.x as f32,
            y: self.y as f32,
            r: self.r as f32,
            w: self.w as f32,
            h: self.h as f32,
            dir: self.dir as f32,
        }
    }
}

fn rand_range(rng: &mut impl Rng, lo: f64, hi: f64) -> f64 {
    lo + rng.gen::<f64>() * (hi - lo)
}

/// 장애물의 충돌 반경(겹침 판정용 바운딩 원).
fn bound_radius(kind: ObKind, r: f64, w: f64, h: f64) -> f64 {
    if kind.is_circle() {
        r
    } else {
        0.5 * (w * w + h * h).sqrt()
    }
}

/// 아레나에 장애물 배치. 10종 최소 1개씩 + 추가 랜덤, 서로/알 시작점과 겹치지 않게.
fn generate_obstacles(arena_r: f64, starts: &[(f64, f64)]) -> Vec<Obstacle> {
    let mut rng = rand::thread_rng();
    let mut kinds: Vec<ObKind> = ALL_OBKINDS.to_vec();
    for _ in 0..6 {
        kinds.push(*ALL_OBKINDS.choose(&mut rng).unwrap());
    }
    kinds.shuffle(&mut rng);

    const GAP: f64 = 40.0; // 장애물 사이 최소 간격
    let mut obs: Vec<Obstacle> = Vec::new();
    for kind in kinds {
        let (r, w, h) = match kind {
            ObKind::Rock => (rand_range(&mut rng, 55.0, 95.0), 0.0, 0.0),
            ObKind::Spike => (rand_range(&mut rng, 40.0, 62.0), 0.0, 0.0),
            ObKind::Bumper => (rand_range(&mut rng, 45.0, 70.0), 0.0, 0.0),
            ObKind::Bomb => (rand_range(&mut rng, 34.0, 48.0), 0.0, 0.0),
            ObKind::Gravity => (rand_range(&mut rng, 160.0, 230.0), 0.0, 0.0),
            _ => (
                0.0,
                rand_range(&mut rng, 170.0, 320.0),
                rand_range(&mut rng, 150.0, 300.0),
            ),
        };
        let br = bound_radius(kind, r, w, h);
        // 거부 샘플링: 겹치지 않는 자리를 찾는다.
        let mut placed = None;
        for _ in 0..60 {
            let ang = rand_range(&mut rng, 0.0, std::f64::consts::TAU);
            // 벽 안쪽으로(반경 여유), 중앙은 살짝 비움.
            let dmax = (arena_r - br - 30.0).max(arena_r * 0.2);
            let dist = rand_range(&mut rng, arena_r * 0.14, dmax);
            let x = dist * ang.cos();
            let y = dist * ang.sin();
            // 다른 장애물과 겹침 검사
            let hit_ob = obs.iter().any(|o| {
                let ob_br = bound_radius(o.kind, o.r, o.w, o.h);
                ((x - o.x).powi(2) + (y - o.y).powi(2)).sqrt() < br + ob_br + GAP
            });
            // 알 시작점과 겹침 검사
            let hit_start = starts
                .iter()
                .any(|&(sx, sy)| ((x - sx).powi(2) + (y - sy).powi(2)).sqrt() < br + MARBLE_R + 50.0);
            if !hit_ob && !hit_start {
                placed = Some((x, y));
                break;
            }
        }
        if let Some((x, y)) = placed {
            obs.push(Obstacle {
                kind,
                x,
                y,
                r,
                w,
                h,
                dir: rand_range(&mut rng, 0.0, std::f64::consts::TAU),
            });
        }
    }
    obs
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
    // 아이템으로 얻는 1회성 버프(다음 발사에 적용 후 소모)
    pub buff_dmg_up: bool,
    pub buff_crit: bool,
    pub buff_power: f64, // 다음 발사 세기 배수(기본 1.0)
    pub buff_lifesteal: bool,
    pub buff_explode: bool,
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
    pub obstacles: Vec<Obstacle>,
    pub drafting: bool,
    pub draft: HashMap<Uuid, DraftOffer>,
    pub items: Vec<Item>,
    // 발사 시뮬 중 충돌 이벤트 수집(클라 이펙트용). resolve마다 초기화.
    ev: Vec<crate::protocol::FlickEvent>,
    ev_frame: u32,
    // 이번 발사의 1회성 버프(resolve 시작 시 발사자 버프를 흡수해 소모).
    shot_dmg_mult: f64,
    shot_lifesteal: bool,
    shot_explode: bool,
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
                buff_dmg_up: false,
                buff_crit: false,
                buff_power: 1.0,
                buff_lifesteal: false,
                buff_explode: false,
            });
            draft.insert(
                id,
                DraftOffer {
                    options: offer_powers(),
                    picked: None,
                },
            );
        }
        let starts: Vec<(f64, f64)> = marbles.iter().map(|m| (m.x, m.y)).collect();
        FlickGame {
            arena_r: ARENA_R,
            marbles,
            obstacles: generate_obstacles(ARENA_R, &starts),
            drafting: true,
            draft,
            items: Vec::new(),
            ev: Vec::new(),
            ev_frame: 0,
            shot_dmg_mult: 1.0,
            shot_lifesteal: false,
            shot_explode: false,
        }
    }

    pub fn item_infos(&self) -> Vec<crate::protocol::FlickItem> {
        self.items.iter().map(|it| it.info()).collect()
    }

    /// 턴마다 호출: 일정 확률로 아이템을 1~4개 생성(필드 최대 8개).
    pub fn tick_items(&mut self) {
        let mut rng = rand::thread_rng();
        if self.items.len() >= ITEM_MAX_FIELD || rng.gen::<f64>() > ITEM_SPAWN_CHANCE {
            return;
        }
        let want = rng.gen_range(1..=ITEM_MAX_PER_TURN).min(ITEM_MAX_FIELD - self.items.len());
        for _ in 0..want {
            let kind = *ALL_ITEMS.choose(&mut rng).unwrap();
            // 겹치지 않는 자리(장애물 솔리드/알/기존 아이템 회피).
            let mut placed = None;
            for _ in 0..40 {
                let ang = rand_range(&mut rng, 0.0, std::f64::consts::TAU);
                let dist = rand_range(&mut rng, self.arena_r * 0.1, self.arena_r * 0.85);
                let x = dist * ang.cos();
                let y = dist * ang.sin();
                let near_solid = self.obstacles.iter().any(|o| {
                    o.kind.is_solid()
                        && ((x - o.x).powi(2) + (y - o.y).powi(2)).sqrt()
                            < ITEM_R + bound_radius(o.kind, o.r, o.w, o.h) + 20.0
                });
                let near_marble = self.marbles.iter().any(|m| {
                    m.alive && ((x - m.x).powi(2) + (y - m.y).powi(2)).sqrt() < ITEM_R + m.r + 30.0
                });
                let near_item = self
                    .items
                    .iter()
                    .any(|it| ((x - it.x).powi(2) + (y - it.y).powi(2)).sqrt() < ITEM_R * 2.0 + 20.0);
                if !near_solid && !near_marble && !near_item {
                    placed = Some((x, y));
                    break;
                }
            }
            if let Some((x, y)) = placed {
                self.items.push(Item { kind, x, y });
            }
        }
    }

    /// 알이 아이템을 획득했을 때 효과 적용 + 이벤트.
    fn apply_item(&mut self, idx: usize, kind: ItemKind) {
        let m = &mut self.marbles[idx];
        match kind {
            ItemKind::DmgUp => m.buff_dmg_up = true,
            ItemKind::Crit => m.buff_crit = true,
            ItemKind::Shield => m.shield = true,
            ItemKind::AtkPerm => m.atk += 1,
            ItemKind::DefPerm => m.def += 1,
            ItemKind::Heal => {
                let restore = (m.max_hp - m.hp) / 2;
                m.hp = (m.hp + restore).min(m.max_hp);
            }
            ItemKind::MaxHp => {
                m.max_hp += 20;
                m.hp = (m.hp + 20).min(m.max_hp);
            }
            ItemKind::Power => m.buff_power = (m.buff_power * 1.3).min(2.0),
            ItemKind::Lifesteal => m.buff_lifesteal = true,
            ItemKind::Explode => m.buff_explode = true,
        }
        let (x, y, owner, hp) = (m.x, m.y, m.owner, m.hp);
        self.push_event(x, y, &format!("item:{}", kind.as_str()), 0, owner, hp);
    }

    fn push_event(&mut self, x: f64, y: f64, kind: &str, amount: i32, owner: Uuid, hp: i32) {
        self.ev.push(crate::protocol::FlickEvent {
            frame: self.ev_frame,
            x: x as f32,
            y: y as f32,
            kind: kind.to_string(),
            amount,
            owner,
            hp,
        });
    }

    pub fn obstacle_infos(&self) -> Vec<crate::protocol::FlickObstacle> {
        self.obstacles.iter().map(|o| o.info()).collect()
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
    ) -> (
        Vec<Uuid>,
        Vec<Vec<[i16; 2]>>,
        Vec<crate::protocol::FlickEvent>,
    ) {
        let ids: Vec<Uuid> = self.marbles.iter().map(|m| m.owner).collect();
        let mut timeline: Vec<Vec<[i16; 2]>> = Vec::new();
        self.ev.clear();

        // 발사 속도 설정. 슬링샷(무제한)은 세기 상한이 더 높다(드래그한 만큼).
        let slingshot = self
            .marble(shooter)
            .map(|m| m.power == "slingshot")
            .unwrap_or(false);
        let cap = if slingshot { POWER_CAP_UNLIMITED } else { POWER_CAP };
        // 발사자의 1회성 버프를 이번 발사에 흡수(소모).
        let (mut dm, mut ls, mut ex, mut power_mult) = (1.0, false, false, 1.0);
        if let Some(m) = self.marble_mut(shooter) {
            if m.buff_crit {
                dm = 2.0;
            } else if m.buff_dmg_up {
                dm = 1.2;
            }
            ls = m.buff_lifesteal;
            ex = m.buff_explode;
            power_mult = m.buff_power;
            m.buff_crit = false;
            m.buff_dmg_up = false;
            m.buff_lifesteal = false;
            m.buff_explode = false;
            m.buff_power = 1.0;
        }
        self.shot_dmg_mult = dm;
        self.shot_lifesteal = ls;
        self.shot_explode = ex;
        let speed = power.clamp(0.05, cap) * MAX_SPEED * power_mult;
        if let Some(m) = self.marble_mut(shooter) {
            m.vx = angle.cos() * speed;
            m.vy = angle.sin() * speed;
        }

        let mut explosion_fired = false;
        let obs = self.obstacles.clone();
        let decay = 1.0 - FRICTION * DT;
        timeline.push(self.frame());

        for step in 0..MAX_STEPS {
            let n = self.marbles.len();
            self.ev_frame = timeline.len() as u32; // 이 스텝 이벤트가 표시될 대략 프레임
            // 적분 + 마찰 + 필드 효과
            for i in 0..n {
                if !self.marbles[i].alive {
                    continue;
                }
                self.marbles[i].x += self.marbles[i].vx * DT;
                self.marbles[i].y += self.marbles[i].vy * DT;
                self.marbles[i].vx *= decay;
                self.marbles[i].vy *= decay;

                let (mx, my) = (self.marbles[i].x, self.marbles[i].y);
                let mut in_lava = false;
                for ob in &obs {
                    if ob.kind.is_solid() || !ob.contains(mx, my) {
                        continue;
                    }
                    match ob.kind {
                        ObKind::Swamp => {
                            self.marbles[i].vx *= SWAMP_MULT;
                            self.marbles[i].vy *= SWAMP_MULT;
                        }
                        ObKind::Ice => {
                            // 마찰 상쇄(미끄러짐)
                            self.marbles[i].vx /= decay;
                            self.marbles[i].vy /= decay;
                        }
                        ObKind::Boost => {
                            self.marbles[i].vx *= BOOST_MULT;
                            self.marbles[i].vy *= BOOST_MULT;
                        }
                        ObKind::Gravity => {
                            let dx = ob.x - mx;
                            let dy = ob.y - my;
                            let d = (dx * dx + dy * dy).sqrt().max(1.0);
                            self.marbles[i].vx += dx / d * GRAV_ACCEL * DT;
                            self.marbles[i].vy += dy / d * GRAV_ACCEL * DT;
                        }
                        ObKind::Wind => {
                            self.marbles[i].vx += ob.dir.cos() * WIND_ACCEL * DT;
                            self.marbles[i].vy += ob.dir.sin() * WIND_ACCEL * DT;
                        }
                        ObKind::Lava => in_lava = true,
                        _ => {}
                    }
                }
                if in_lava && step % 8 == 0 {
                    self.apply_hp(i, -2);
                }

                // 아이템 획득(지나가며 닿으면)
                if !self.items.is_empty() {
                    let (px, py, pr) = (self.marbles[i].x, self.marbles[i].y, self.marbles[i].r);
                    if let Some(k) = self
                        .items
                        .iter()
                        .position(|it| ((px - it.x).powi(2) + (py - it.y).powi(2)).sqrt() < pr + ITEM_R)
                    {
                        let item = self.items.remove(k);
                        self.apply_item(i, item.kind);
                    }
                }
            }

            // 마블-마블 충돌
            for i in 0..n {
                for j in (i + 1)..n {
                    if !self.marbles[i].alive || !self.marbles[j].alive {
                        continue;
                    }
                    self.collide(i, j, shooter, &mut explosion_fired);
                }
            }

            // 솔리드 장애물 충돌(튕김 + 가시/폭탄)
            for i in 0..n {
                if !self.marbles[i].alive {
                    continue;
                }
                for ob in &obs {
                    if !ob.kind.is_solid() {
                        continue;
                    }
                    let dx = self.marbles[i].x - ob.x;
                    let dy = self.marbles[i].y - ob.y;
                    let d = (dx * dx + dy * dy).sqrt();
                    let min = self.marbles[i].r + ob.r;
                    if d >= min || d <= 0.0001 {
                        continue;
                    }
                    let nx = dx / d;
                    let ny = dy / d;
                    self.marbles[i].x = ob.x + nx * min;
                    self.marbles[i].y = ob.y + ny * min;
                    let vn = self.marbles[i].vx * nx + self.marbles[i].vy * ny;
                    if vn < 0.0 {
                        let rest = if ob.kind == ObKind::Bumper { 1.5 } else { 0.9 };
                        self.marbles[i].vx -= (1.0 + rest) * vn * nx;
                        self.marbles[i].vy -= (1.0 + rest) * vn * ny;
                        let impact = vn.abs();
                        match ob.kind {
                            ObKind::Spike => {
                                let dmg = ((impact * 0.004) as i32 + 5).max(5);
                                self.apply_hp(i, -dmg);
                                let mb = &self.marbles[i];
                                let (mx, my, dead, owner, hp) =
                                    (mb.x, mb.y, !mb.alive, mb.owner, mb.hp);
                                self.push_event(mx, my, if dead { "ko" } else { "spike" }, dmg, owner, hp);
                            }
                            ObKind::Bomb => self.explode_at(ob.x, ob.y, 240.0, 1100.0, 14),
                            _ => {}
                        }
                    }
                }
            }

            // 벽 충돌(튕김) — 장외 즉사 없음, HP로만 승부.
            let arena = self.arena_r;
            for m in self.marbles.iter_mut() {
                if !m.alive {
                    continue;
                }
                let d = (m.x * m.x + m.y * m.y).sqrt();
                let limit = arena - m.r;
                if d > limit && d > 0.0001 {
                    let nx = m.x / d;
                    let ny = m.y / d;
                    m.x = nx * limit;
                    m.y = ny * limit;
                    let vn = m.vx * nx + m.vy * ny;
                    if vn > 0.0 {
                        m.vx -= (1.0 + WALL_RESTITUTION) * vn * nx;
                        m.vy -= (1.0 + WALL_RESTITUTION) * vn * ny;
                    }
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
        let events = std::mem::take(&mut self.ev);
        (ids, timeline, events)
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

        // 데미지: 발사한 알(공격자)은 피해를 받지 않고, 맞은 쪽만 HP가 닳는다.
        let impact = vn.abs();
        let i_shooter = self.marbles[i].owner == shooter;
        let j_shooter = self.marbles[j].owner == shooter;
        if !i_shooter {
            self.damage(i, j, impact, shooter);
        }
        if !j_shooter {
            self.damage(j, i, impact, shooter);
        }

        // 폭발: 발사자의 첫 충돌 시 광역 넉백+데미지 (폭발 능력 또는 폭발 아이템 버프)
        let sh_idx = if i_shooter {
            Some(i)
        } else if j_shooter {
            Some(j)
        } else {
            None
        };
        if !*explosion_fired {
            if let Some(c) = sh_idx {
                if self.marbles[c].power == "explosion" || self.shot_explode {
                    *explosion_fired = true;
                    self.explode(c);
                }
            }
        }
    }

    /// attacker(a)가 victim(v)에게 충돌속도 impact로 입히는 피해.
    /// 발사한 알(shooter)은 어떤 경우에도 피해를 받지 않는다(가시 반동 포함).
    fn damage(&mut self, v: usize, a: usize, impact: f64, shooter: Uuid) {
        let atk = self.marbles[a].atk as f64;
        let def = self.marbles[v].def as f64;
        let is_shooter = self.marbles[a].owner == shooter;
        // 방어력은 비율 감소(체감) — 절대 0이 되지 않게.
        let raw = impact * DMG_K * atk;
        // 발사자의 아이템 버프(데미지 +20% / 2배)를 곱한다.
        let mult = if is_shooter { self.shot_dmg_mult } else { 1.0 };
        let mut dmg = (raw * 100.0 / (100.0 + def * 6.0) * mult).round() as i32;
        if dmg < 1 && raw >= 2.0 {
            dmg = 1; // 의미있는 충돌은 최소 1 피해
        }
        // 슬링샷(무제한) 발사자의 타격은 피해 상한 없음 — 세게 칠수록 강함.
        let uncapped = is_shooter && self.marbles[a].power == "slingshot";
        if !uncapped {
            let cap = (DMG_CAP as f64 * mult.max(1.0)) as i32; // 버프 시 상한도 비례 상향
            dmg = dmg.min(cap);
        }
        if dmg <= 0 {
            return;
        }
        // 보호막: 첫 피해 무효(소모)
        if self.marbles[v].shield {
            self.marbles[v].shield = false;
            let mb = &self.marbles[v];
            let (vx, vy, owner, hp) = (mb.x, mb.y, mb.owner, mb.hp);
            self.push_event(vx, vy, "shield", 0, owner, hp);
            return;
        }
        // 가시: 부딪힌 공격자에게 반동 피해 (가시 능력의 핵심이므로 발사자도 반동을 받음).
        if self.marbles[v].power == "spikes" {
            let recoil = (dmg / 3).max(1);
            self.apply_hp(a, -recoil);
            let am = &self.marbles[a];
            let (ax, ay, ao, ah) = (am.x, am.y, am.owner, am.hp);
            self.push_event(ax, ay, "reflect", recoil, ao, ah);
        }
        self.apply_hp(v, -dmg);
        let mb = &self.marbles[v];
        let (vx, vy, dead, owner, hp) = (mb.x, mb.y, !mb.alive, mb.owner, mb.hp);
        self.push_event(vx, vy, if dead { "ko" } else { "hit" }, dmg, owner, hp);
        // 흡혈: 공격자가 입힌 피해의 일부 회복 (능력 또는 아이템 버프)
        if self.marbles[a].power == "lifesteal" || (is_shooter && self.shot_lifesteal) {
            let heal = dmg / 2;
            if heal > 0 {
                self.apply_hp(a, heal);
                let am = &self.marbles[a];
                let (ax, ay, ao, ah) = (am.x, am.y, am.owner, am.hp);
                self.push_event(ax, ay, "heal", heal, ao, ah);
            }
        }
        let _ = &mut dmg;
    }

    fn explode(&mut self, center: usize) {
        let (cx, cy) = (self.marbles[center].x, self.marbles[center].y);
        self.push_event(cx, cy, "explode", 0, Uuid::nil(), -1);
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
            let mb = &self.marbles[k];
            let (kx, ky, dead, owner, hp) = (mb.x, mb.y, !mb.alive, mb.owner, mb.hp);
            self.push_event(kx, ky, if dead { "ko" } else { "hit" }, 8, owner, hp);
        }
    }

    /// 임의 지점 폭발 (폭탄 장애물용). 환경 피해라 모든 알에 적용.
    fn explode_at(&mut self, cx: f64, cy: f64, radius: f64, force: f64, dmg: i32) {
        self.push_event(cx, cy, "explode", 0, Uuid::nil(), -1);
        for k in 0..self.marbles.len() {
            if !self.marbles[k].alive {
                continue;
            }
            let dx = self.marbles[k].x - cx;
            let dy = self.marbles[k].y - cy;
            let d = (dx * dx + dy * dy).sqrt().max(0.001);
            if d > radius {
                continue;
            }
            let f = (1.0 - d / radius) * force;
            self.marbles[k].vx += dx / d * f;
            self.marbles[k].vy += dy / d * f;
            self.apply_hp(k, -dmg);
            let mb = &self.marbles[k];
            let (kx, ky, dead, owner, hp) = (mb.x, mb.y, !mb.alive, mb.owner, mb.hp);
            self.push_event(kx, ky, if dead { "ko" } else { "hit" }, dmg, owner, hp);
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

/// 능력별 스탯 차등 (기본 hp100/atk10/def5/mass1 위에 덮어쓰기).
fn apply_power_stats(m: &mut Marble) {
    match m.power.as_str() {
        // 광역 폭발: 단일 공격력은 보통이지만 주변 동시 타격.
        "explosion" => {
            m.atk = 13;
            m.def = 4;
        }
        // 관통: 높은 공격력·다중 타격, 대신 약체.
        "pierce" => {
            m.atk = 17;
            m.def = 4;
            m.max_hp = 90;
            m.hp = 90;
        }
        // 강철: 탱커. 공격력 낮고 방어·체력·질량 높음.
        "iron" => {
            m.atk = 10;
            m.def = 14;
            m.mass = 2.2;
            m.max_hp = 130;
            m.hp = 130;
        }
        // 보호막: 평균 + 첫 피해 무효.
        "shield" => {
            m.atk = 13;
            m.def = 6;
            m.shield = true;
        }
        // 슬링샷: 발사 세기 무제한(드래그한 만큼).
        "slingshot" => {
            m.atk = 13;
            m.def = 5;
            m.max_hp = 95;
            m.hp = 95;
        }
        // 헤비샷: 최고 공격력 + 무거움.
        "heavy" => {
            m.atk = 24;
            m.def = 6;
            m.mass = 1.7;
            m.max_hp = 115;
            m.hp = 115;
        }
        // 흡혈: 준수한 공격력 + 입힌 피해 절반 회복.
        "lifesteal" => {
            m.atk = 16;
            m.def = 5;
        }
        // 가시: 공격력 보통 + 반사 + 맷집.
        "spikes" => {
            m.atk = 11;
            m.def = 8;
            m.max_hp = 110;
            m.hp = 110;
        }
        _ => {}
    }
}
