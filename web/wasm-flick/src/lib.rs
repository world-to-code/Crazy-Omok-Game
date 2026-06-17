//! 알까기 조준 궤적 예측 (클라이언트용 WASM).
//! 서버 물리와 동일한 상수로 발사 알의 경로(벽/다른 알 반사)를 미리 계산해
//! 점선으로 보여주기 위한 것. 다른 알은 정적 장애물로 근사한다.
use wasm_bindgen::prelude::*;

const MAX_SPEED: f64 = 2600.0;
const FRICTION: f64 = 1.0;
const DT: f64 = 1.0 / 120.0;
const RESTITUTION: f64 = 0.92;
const WALL_RESTITUTION: f64 = 0.9;
const MAX_STEPS: usize = 900;
const KEYFRAME_EVERY: usize = 6;
const STOP_SPEED: f64 = 8.0;

/// 발사 궤적 예측. others = [x,y,r, x,y,r, ...] (다른 알들, 정적 취급).
/// 반환: [x0,y0, x1,y1, ...] 경로 점들.
#[wasm_bindgen]
pub fn predict_path(
    sx: f64,
    sy: f64,
    angle: f64,
    power: f64,
    speed_mult: f64,
    arena_r: f64,
    shooter_r: f64,
    others: &[f32],
) -> Vec<f32> {
    let mut x = sx;
    let mut y = sy;
    let speed = power.clamp(0.0, 1.0) * MAX_SPEED * speed_mult;
    let mut vx = angle.cos() * speed;
    let mut vy = angle.sin() * speed;

    let mut out: Vec<f32> = Vec::with_capacity(160);
    out.push(x as f32);
    out.push(y as f32);

    for step in 0..MAX_STEPS {
        x += vx * DT;
        y += vy * DT;
        let decay = 1.0 - FRICTION * DT;
        vx *= decay;
        vy *= decay;

        // 다른 알(정적 장애물) 반사
        let mut i = 0;
        while i + 2 < others.len() {
            let ox = others[i] as f64;
            let oy = others[i + 1] as f64;
            let orr = others[i + 2] as f64;
            let dx = x - ox;
            let dy = y - oy;
            let d = (dx * dx + dy * dy).sqrt();
            let min = shooter_r + orr;
            if d < min && d > 0.0001 {
                let nx = dx / d;
                let ny = dy / d;
                x = ox + nx * min;
                y = oy + ny * min;
                let vn = vx * nx + vy * ny;
                if vn < 0.0 {
                    vx -= (1.0 + RESTITUTION) * vn * nx;
                    vy -= (1.0 + RESTITUTION) * vn * ny;
                }
            }
            i += 3;
        }

        // 벽 반사
        let d = (x * x + y * y).sqrt();
        let limit = arena_r - shooter_r;
        if d > limit && d > 0.0001 {
            let nx = x / d;
            let ny = y / d;
            x = nx * limit;
            y = ny * limit;
            let vn = vx * nx + vy * ny;
            if vn > 0.0 {
                vx -= (1.0 + WALL_RESTITUTION) * vn * nx;
                vy -= (1.0 + WALL_RESTITUTION) * vn * ny;
            }
        }

        if step % KEYFRAME_EVERY == 0 {
            out.push(x as f32);
            out.push(y as f32);
        }
        if (vx * vx + vy * vy).sqrt() < STOP_SPEED {
            break;
        }
    }
    out.push(x as f32);
    out.push(y as f32);
    out
}
