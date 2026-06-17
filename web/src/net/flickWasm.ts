// 알까기 조준 궤적 예측 — WASM(Rust) 모듈 로더.
// 서버 물리와 동일 상수로 컴파일된 predict_path 를 사용한다.
import init, { predict_path } from "../wasm/flick_wasm.js";

let ready = false;
let initPromise: Promise<void> | null = null;

export function ensureFlickWasm(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!initPromise) {
    initPromise = init()
      .then(() => {
        ready = true;
      })
      .catch((e) => {
        console.warn("flick wasm 로드 실패", e);
      });
  }
  return initPromise;
}

export function isWasmReady() {
  return ready;
}

/** 궤적 점들 [x0,y0,x1,y1,...] 반환. 준비 안 됐으면 null. */
export function predictPath(
  sx: number,
  sy: number,
  angle: number,
  power: number,
  speedMult: number,
  arenaR: number,
  shooterR: number,
  others: Float32Array,
): Float32Array | null {
  if (!ready) return null;
  try {
    return predict_path(sx, sy, angle, power, speedMult, arenaR, shooterR, others);
  } catch {
    return null;
  }
}
