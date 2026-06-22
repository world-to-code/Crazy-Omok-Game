// 요트 봇 — 단순 휴리스틱: 같은 눈을 모으고(킵), 최선 점수 칸을 고른다.
import { categoryScore, openCategories, type Category, type YachtState } from "./engine";

function freq(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

// 리롤 사이 킵 결정: 가장 많은 눈을 남기고 나머지를 다시 굴린다.
export function botKeep(dice: number[]): boolean[] {
  const c = freq(dice);
  let best = 1;
  for (let v = 2; v <= 6; v++) if (c[v] > c[best] || (c[v] === c[best] && v > best)) best = v;
  // 이미 같은 눈이 1개뿐이면(전부 제각각) 큰 눈 위주로 킵.
  if (c[best] <= 1) return dice.map((d) => d >= 4);
  return dice.map((d) => d === best);
}

// 점수 기록 칸 선택: 최선 점수. 전부 0이면 어려운 칸을 희생.
export function botBestCategory(s: YachtState): Category {
  const open = openCategories(s);
  let bestCat = open[0];
  let bestScore = -1;
  for (const cat of open) {
    const sc = categoryScore(s.dice, cat);
    if (sc > bestScore) {
      bestScore = sc;
      bestCat = cat;
    }
  }
  if (bestScore <= 0) {
    const sacrifice: Category[] = [
      "yacht", "largeStraight", "smallStraight", "fourKind", "fullHouse",
      "ones", "twos", "threes", "fours", "fives", "sixes", "choice",
    ];
    for (const k of sacrifice) if (open.includes(k)) return k;
  }
  return bestCat;
}
