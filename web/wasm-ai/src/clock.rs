//! 시간 측정 — JS Date.now() (ms). 탐색 마감시간 판정에 사용.
pub fn now_ms() -> f64 {
    js_sys::Date::now()
}
