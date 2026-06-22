// 윷놀이 봇 — 던지기는 운, 핵심은 "어느 말에 어떤 결과를 적용할지" 휴리스틱 선택.
// level 0 쉬움(무작위 가까움) → 3 헬(항상 최선).

import { GOAL, stepForward, type Lane, type NodeId, type Route } from "./board";
import { legalTargets, rollThrow, type MoveTarget } from "./engine";
import type { ThrowResult, YutState } from "./types";

export function botThrow(rng: () => number = Math.random): ThrowResult {
  return rollThrow(0.5, rng);
}

// 노드(+lane)에서 완주까지 남은 칸 수 추정(작을수록 전진).
function remainingToGoal(node: NodeId, lane: Lane): number {
  if (node === GOAL) return 0;
  let cur = node;
  let curLane = lane;
  for (let i = 0; i < 40; i++) {
    const nx = stepForward(cur, curLane, i === 0);
    if (nx === GOAL) return i + 1;
    cur = nx.node;
    curLane = nx.lane;
  }
  return 40;
}

function scoreTarget(t: MoveTarget): number {
  let s = 0;
  if (t.captures) s += 1000 * t.count + 600; // 잡기 최우선(특히 업힌 말 잡으면 큼)
  if (t.finishes) s += 700 * t.count;
  // 지름길 진입(모서리/중앙에 안착) 보너스.
  if (t.to === "c") s += 220;
  else if (t.to === "o5" || t.to === "o10") s += 130;
  // 전진도: 목표에 가까울수록 +.
  if (t.to !== GOAL) {
    s += (40 - remainingToGoal(t.to, "outer")) * 6;
  }
  // 업기(여러 말 함께 전진)는 가속이지만 한 방에 잡힐 위험 → 소폭만.
  if (t.count > 1) s += 25;
  return s;
}

// 봇이 적용할 (throwIndex, targetKey, route) 선택. 없으면 null(버릴 것).
export function botChooseMove(
  s: YutState,
  level: number,
  rng: () => number = Math.random,
): { throwIndex: number; targetKey: NodeId; route: Route } | null {
  type Cand = { throwIndex: number; target: MoveTarget; score: number };
  const cands: Cand[] = [];
  s.queue.forEach((t, throwIndex) => {
    for (const target of legalTargets(s, t)) {
      cands.push({ throwIndex, target, score: scoreTarget(target) });
    }
  });
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);

  // 난이도별 무작위성: 쉬움일수록 상위권에서 멋대로 고른다.
  const topN = level >= 3 ? 1 : level === 2 ? 2 : level === 1 ? 3 : cands.length;
  const pick = cands[Math.floor(rng() * Math.min(topN, cands.length))];
  return { throwIndex: pick.throwIndex, targetKey: pick.target.key, route: pick.target.route };
}
