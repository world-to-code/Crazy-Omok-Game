// 요트(주사위) 순수 로직: 5주사위 · 한 턴 최대 3롤(킵/리롤) · 12족보 점수 · 승패 · 봇.
// 결과(주사위 눈)는 서버 무작위(멀티)/엔진 rng(봇)로 결정 — 흔들기는 연출.

export type Category =
  | "ones" | "twos" | "threes" | "fours" | "fives" | "sixes"
  | "choice" | "fourKind" | "fullHouse" | "smallStraight" | "largeStraight" | "yacht";

export const CATEGORIES: {
  key: Category;
  label: string; // 점수표에 표시되는 짧은 이름
  name: string; // 전체 이름
  section: "upper" | "lower";
  hint: string; // 한 줄 요약(셀 툴팁)
  desc: string; // 초보자용 자세한 설명
  example: string; // 예시
}[] = [
  { key: "ones", label: "1 (에이스)", name: "에이스 (1)", section: "upper", hint: "1의 눈 개수 × 1", desc: "주사위 중 1이 몇 개인지 세어 ×1점. (다른 눈은 무시)", example: "1·1·1·4·6 → 1이 3개 = 3점" },
  { key: "twos", label: "2 (듀스)", name: "듀스 (2)", section: "upper", hint: "2의 눈 개수 × 2", desc: "주사위 중 2가 몇 개인지 세어 ×2점.", example: "2·2·5·5·6 → 2가 2개 = 4점" },
  { key: "threes", label: "3 (트리플)", name: "트리플 (3)", section: "upper", hint: "3의 눈 개수 × 3", desc: "주사위 중 3이 몇 개인지 세어 ×3점.", example: "3·3·3·1·2 → 3이 3개 = 9점" },
  { key: "fours", label: "4 (쿼드)", name: "쿼드 (4)", section: "upper", hint: "4의 눈 개수 × 4", desc: "주사위 중 4가 몇 개인지 세어 ×4점.", example: "4·4·4·4·1 → 4가 4개 = 16점" },
  { key: "fives", label: "5 (퀸트)", name: "퀸트 (5)", section: "upper", hint: "5의 눈 개수 × 5", desc: "주사위 중 5가 몇 개인지 세어 ×5점.", example: "5·5·5·2·3 → 5가 3개 = 15점" },
  { key: "sixes", label: "6 (식스)", name: "식스 (6)", section: "upper", hint: "6의 눈 개수 × 6", desc: "주사위 중 6이 몇 개인지 세어 ×6점.", example: "6·6·6·6·6 → 6이 5개 = 30점" },
  { key: "choice", label: "찬스", name: "찬스 (Choice)", section: "lower", hint: "주사위 5개의 합", desc: "어떤 조합이든 상관없이 주사위 5개의 눈을 모두 더한 점수. 마땅한 족보가 없을 때 점수를 챙기기 좋아요.", example: "3·5·6·6·2 → 22점" },
  { key: "fourKind", label: "포 카드", name: "포 카드 (4 of a kind)", section: "lower", hint: "같은 눈 4개 이상 → 5개 전체 합 / 아니면 0", desc: "같은 눈이 4개(또는 5개) 있으면 주사위 5개 전체 합으로 인정. 조건을 못 채우면 0점.", example: "5·5·5·5·2 → 22점 / 5·5·5·2·1 → 0점" },
  { key: "fullHouse", label: "풀 하우스", name: "풀 하우스 (Full House)", section: "lower", hint: "3개+2개(같은 눈) → 5개 전체 합 / 아니면 0", desc: "같은 눈 3개와 또 다른 같은 눈 2개로 이뤄지면(3+2) 전체 합으로 인정. 아니면 0점.", example: "4·4·4·2·2 → 16점 / 4·4·4·4·2 → 풀하우스 아님 0점" },
  { key: "smallStraight", label: "스몰 스트레이트", name: "스몰 스트레이트 (작은 줄)", section: "lower", hint: "연속된 눈 4개 → 15점 고정", desc: "연속된 숫자가 4개 이어지면(예: 2·3·4·5) 무조건 15점. 아니면 0점.", example: "1·2·3·4·6 → 15점 / 2·3·4·6·6 → 0점" },
  { key: "largeStraight", label: "라지 스트레이트", name: "라지 스트레이트 (큰 줄)", section: "lower", hint: "연속된 눈 5개 → 30점 고정", desc: "5개가 모두 연속이면(1·2·3·4·5 또는 2·3·4·5·6) 무조건 30점. 아니면 0점.", example: "2·3·4·5·6 → 30점" },
  { key: "yacht", label: "⭐ 요트", name: "요트 (Yacht)", section: "lower", hint: "5개 모두 같은 눈 → 50점!", desc: "주사위 5개가 모두 같은 눈이면 최고점 50점! 게임에서 가장 큰 한 방이에요. 아니면 0점.", example: "6·6·6·6·6 → 50점" },
];

export const CAT_INDEX: Record<Category, number> = CATEGORIES.reduce(
  (m, c, i) => ((m[c.key] = i), m),
  {} as Record<Category, number>,
);
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;

function counts(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0]; // index 1..6
  for (const d of dice) c[d]++;
  return c;
}
const sum = (dice: number[]) => dice.reduce((a, b) => a + b, 0);

function hasRun(c: number[], len: number): boolean {
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = c[v] > 0 ? run + 1 : 0;
    if (run >= len) return true;
  }
  return false;
}

// 족보 점수(미리보기/확정 공용).
export function categoryScore(dice: number[], cat: Category): number {
  const c = counts(dice);
  const total = sum(dice);
  switch (cat) {
    case "ones": return c[1] * 1;
    case "twos": return c[2] * 2;
    case "threes": return c[3] * 3;
    case "fours": return c[4] * 4;
    case "fives": return c[5] * 5;
    case "sixes": return c[6] * 6;
    case "choice": return total;
    case "fourKind": return c.some((n) => n >= 4) ? total : 0;
    case "fullHouse": {
      const nz = c.filter((n) => n > 0).sort((a, b) => a - b);
      const ok = (nz.length === 2 && nz[0] === 2 && nz[1] === 3) || c.some((n) => n === 5);
      return ok ? total : 0;
    }
    case "smallStraight": return hasRun(c, 4) ? 15 : 0;
    case "largeStraight": return hasRun(c, 5) ? 30 : 0;
    case "yacht": return c.some((n) => n === 5) ? 50 : 0;
  }
}

export interface YachtState {
  n: number; // 플레이어 수
  turn: number; // 현재 플레이어 인덱스
  dice: number[]; // 현재 주사위 5개(1~6)
  keep: boolean[]; // 5개 킵 여부
  rollsLeft: number; // 이번 턴 남은 굴림(시작 3)
  rolled: boolean; // 이번 턴 한 번이라도 굴렸나(주사위 유효)
  scores: (number | null)[][]; // [player][12], null=미기록
  phase: "roll" | "over";
  winner: number | null;
  log: string[];
}

export function initYacht(n: number): YachtState {
  return {
    n,
    turn: 0,
    dice: [1, 1, 1, 1, 1],
    keep: [false, false, false, false, false],
    rollsLeft: 3,
    rolled: false,
    scores: Array.from({ length: n }, () => Array(CATEGORIES.length).fill(null)),
    phase: "roll",
    winner: null,
    log: [],
  };
}

// 5개 무작위 눈.
export function roll5(rng: () => number = Math.random): number[] {
  return Array.from({ length: 5 }, () => 1 + Math.floor(rng() * 6));
}

// 굴림 적용: 킵 안 된 주사위만 values로 교체(첫 굴림은 전부). rollsLeft 감소.
export function applyRoll(s: YachtState, values: number[]): YachtState {
  if (s.phase !== "roll" || s.rollsLeft <= 0) return s;
  const dice = s.dice.map((d, i) => (!s.rolled || !s.keep[i] ? values[i] : d));
  return { ...s, dice, rolled: true, rollsLeft: s.rollsLeft - 1 };
}

export function toggleKeep(s: YachtState, i: number): YachtState {
  if (!s.rolled || s.phase !== "roll") return s;
  const keep = s.keep.slice();
  keep[i] = !keep[i];
  return { ...s, keep };
}

export function totalScore(card: (number | null)[]): number {
  let upper = 0;
  for (let i = 0; i < 6; i++) upper += card[i] ?? 0;
  let lower = 0;
  for (let i = 6; i < CATEGORIES.length; i++) lower += card[i] ?? 0;
  const bonus = upper >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
  return upper + bonus + lower;
}

export function upperSum(card: (number | null)[]): number {
  let u = 0;
  for (let i = 0; i < 6; i++) u += card[i] ?? 0;
  return u;
}

// 현재 주사위로 cat 칸에 점수 기록 → 다음 플레이어. 모두가 12칸 다 채우면 종료.
export function scoreCategory(s: YachtState, cat: Category): YachtState {
  if (s.phase !== "roll" || !s.rolled) return s;
  const idx = CAT_INDEX[cat];
  if (s.scores[s.turn][idx] !== null) return s; // 이미 기록됨
  const pts = categoryScore(s.dice, cat);
  const scores = s.scores.map((c) => c.slice());
  scores[s.turn][idx] = pts;
  const label = CATEGORIES[idx].label;
  const log = [...s.log, `P${s.turn + 1}: ${label} ${pts}점`];

  const allDone = scores.every((c) => c.every((v) => v !== null));
  if (allDone) {
    let best = 0;
    let win = 0;
    scores.forEach((c, p) => {
      const t = totalScore(c);
      if (t > best) {
        best = t;
        win = p;
      }
    });
    return { ...s, scores, phase: "over", winner: win, log };
  }
  return {
    ...s,
    scores,
    turn: (s.turn + 1) % s.n,
    dice: [1, 1, 1, 1, 1],
    keep: [false, false, false, false, false],
    rollsLeft: 3,
    rolled: false,
    log,
  };
}

// 현재 플레이어의 미기록 칸 목록.
export function openCategories(s: YachtState, player = s.turn): Category[] {
  return CATEGORIES.filter((c) => s.scores[player][CAT_INDEX[c.key]] === null).map((c) => c.key);
}
