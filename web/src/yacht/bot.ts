// 요트 봇 — 항상 합리적인 최선의 선택을 하도록 EV(기대값) 기반으로 동작.
//  · 킵/리롤: 가능한 모든 킵 조합을 몬테카를로로 평가해 기대 점수가 가장 높은 쪽을 고른다.
//    (전부 킵이 최선이면 리롤하지 않고 멈춘다 — 좋은 패를 함부로 버리지 않음)
//  · 점수 칸: 가치가 가장 높은 칸을 고르고, 0점을 버려야 하면 기대값이 가장 낮은 칸을 희생한다.
import {
  UPPER_BONUS_THRESHOLD,
  categoryScore,
  openCategories,
  upperSum,
  type Category,
  type YachtState,
} from "./engine";

// 각 족보를 "끝까지 노렸을 때"의 대략적 기대값 — 판단/희생용.
const TYPICAL_EV: Record<Category, number> = {
  ones: 2, twos: 4, threes: 6, fours: 8, fives: 10, sixes: 12,
  choice: 22, fourKind: 11, fullHouse: 16, smallStraight: 11, largeStraight: 6, yacht: 5,
};

const UPPER_FACE: Partial<Record<Category, number>> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
const isUpper = (c: Category) => c in UPPER_FACE;

const rollDie = () => 1 + Math.floor(Math.random() * 6);

// 이 주사위로 '지금 열린 칸 중' 얻을 수 있는 최고 가치(+상단 보너스가 필요하면 약간 우대).
function handValue(dice: number[], open: Category[], needBonus: boolean): number {
  let best = 0;
  for (const c of open) {
    let v = categoryScore(dice, c);
    if (needBonus && isUpper(c)) {
      const cnt = dice.filter((d) => d === UPPER_FACE[c]).length;
      if (cnt >= 3) v += 2; // 같은 눈 3개 이상으로 상단을 채우면 보너스에 도움
    }
    if (v > best) best = v;
  }
  return best;
}

// 킵/리롤 결정: 모든 킵 조합(32가지)을 몬테카를로로 평가.
// reroll=false 면 더 굴리지 않고 지금 점수를 기록하는 것이 최선이라는 뜻.
export function botDecide(s: YachtState): { keep: boolean[]; reroll: boolean } {
  const dice = s.dice;
  const open = openCategories(s);
  const needBonus = upperSum(s.scores[s.turn]) < UPPER_BONUS_THRESHOLD;
  const SIMS = 180;
  // 멈춤(전부 킵)에 작은 가산점 — 2번 남았으면 더 적극적으로 리롤, 1번 남았으면 보수적.
  const stayBonus = s.rollsLeft >= 2 ? 0.3 : 0.9;

  let bestMask = dice.map(() => true);
  let bestEV = handValue(dice, open, needBonus) + stayBonus;

  for (let mask = 0; mask < 32; mask++) {
    const keep = [0, 1, 2, 3, 4].map((i) => ((mask >> i) & 1) === 1);
    if (keep.every((k) => k)) continue; // 전부 킵은 위에서 처리
    let sum = 0;
    for (let n = 0; n < SIMS; n++) {
      const d = dice.map((v, i) => (keep[i] ? v : rollDie()));
      sum += handValue(d, open, needBonus);
    }
    const ev = sum / SIMS;
    if (ev > bestEV) {
      bestEV = ev;
      bestMask = keep;
    }
  }
  return { keep: bestMask, reroll: !bestMask.every((k) => k) };
}

// 리롤 사이 킵만 필요할 때(호환용).
export function botKeep(s: YachtState): boolean[] {
  return botDecide(s).keep;
}

// 점수 기록 칸 선택: 가치 최대. 전부 0이면 기대값이 가장 낮은(잃을 게 적은) 칸을 희생.
export function botBestCategory(s: YachtState): Category {
  const open = openCategories(s);
  const dice = s.dice;
  const needBonus = upperSum(s.scores[s.turn]) < UPPER_BONUS_THRESHOLD;

  const positives = open.filter((c) => categoryScore(dice, c) > 0);
  if (positives.length > 0) {
    let best = positives[0];
    let bestVal = -Infinity;
    for (const c of positives) {
      const score = categoryScore(dice, c);
      // 잠재 가치가 큰 칸을 헐값에 쓰면 손해 → 그만큼 감점.
      let val = score - 0.45 * Math.max(0, TYPICAL_EV[c] - score);
      if (needBonus && isUpper(c)) {
        const cnt = dice.filter((d) => d === UPPER_FACE[c]).length;
        if (cnt >= 3) val += 3; // 보너스(63점)에 도움이 되면 우대
      }
      if (val > bestVal) {
        bestVal = val;
        best = c;
      }
    }
    return best;
  }

  // 전부 0점 → 기대값이 가장 낮은 칸을 희생(요트·스트레이트 같은 큰 칸은 최대한 남김).
  let sacrifice = open[0];
  let lowest = Infinity;
  for (const c of open) {
    if (TYPICAL_EV[c] < lowest) {
      lowest = TYPICAL_EV[c];
      sacrifice = c;
    }
  }
  return sacrifice;
}
