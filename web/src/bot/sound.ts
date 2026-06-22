// 봇 게임 효과음 — Web Audio API로 합성(오디오 파일 불필요).
// 기물 이동/잡기, 바둑알, 승리/패배/무승부, 체크, 금수 등.

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem("bot_sound_muted") === "1";
} catch {
  // ignore
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// 첫 사용자 입력에서 오디오 컨텍스트를 깨운다(브라우저 자동재생 정책).
if (typeof window !== "undefined") {
  const unlock = () => {
    ac();
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
}

export function isMuted() {
  return muted;
}
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem("bot_sound_muted", v ? "1" : "0");
  } catch {
    // ignore
  }
}

// 엔벨로프가 있는 단음(클릭 방지).
function tone(freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// 짧은 노이즈 버스트(나무 두드림/클릭감).
function noise(start: number, dur: number, peak: number, cutoff: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const len = Math.max(1, Math.ceil(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = cutoff;
  const g = c.createGain();
  src.connect(filt);
  filt.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

// ===== 효과음 =====

/** 체스 기물 이동(나무 탭). */
export function playMove() {
  if (muted) return;
  noise(0, 0.06, 0.22, 1400);
  tone(190, 0, 0.09, "sine", 0.18);
}

/** 체스 기물 잡기(더 묵직한 충돌). */
export function playCapture() {
  if (muted) return;
  noise(0, 0.09, 0.32, 900);
  tone(120, 0, 0.12, "sine", 0.26);
  tone(80, 0.02, 0.12, "triangle", 0.18);
}

/** 오목 돌 놓기(딱 소리). */
export function playStone() {
  if (muted) return;
  noise(0, 0.035, 0.3, 3200);
  tone(760, 0, 0.05, "triangle", 0.16);
}

/** 체크 경고(두 번 삐). */
export function playCheck() {
  if (muted) return;
  tone(990, 0.0, 0.1, "square", 0.12);
  tone(1320, 0.11, 0.12, "square", 0.12);
}

/** 금수(낮은 버저). */
export function playForbidden() {
  if (muted) return;
  tone(150, 0, 0.18, "square", 0.18);
  tone(120, 0.06, 0.18, "square", 0.14);
}

/** 승리(상승 아르페지오). */
export function playWin() {
  if (muted) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, i * 0.12, 0.45, "triangle", 0.22));
}

/** 패배(하강 단조). */
export function playLose() {
  if (muted) return;
  const notes = [440, 370, 311, 233];
  notes.forEach((f, i) => tone(f, i * 0.16, 0.5, "sine", 0.2));
}

/** 무승부(중립 두 음). */
export function playDraw() {
  if (muted) return;
  tone(440, 0, 0.3, "sine", 0.18);
  tone(440, 0.18, 0.3, "sine", 0.14);
}

/** 게임 종료 결과음(이김/짐). */
export function playResult(win: boolean) {
  if (win) playWin();
  else playLose();
}

/** 윷·모(추가 던지기) 팡파르 — 밝은 상승음. */
export function playFanfare() {
  if (muted) return;
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((f, i) => tone(f, i * 0.07, 0.32, "triangle", 0.2));
  noise(0, 0.05, 0.18, 5000);
}
