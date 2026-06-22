// 윷놀이 룰 엔진(순수 TS). 던지기·이동·업기·잡기·추가던지기·승패.
//
// 흐름(상태기계):
//   throw 단계: 던진다 → 윷/모면 계속 throw, 도/개/걸/백도면 move 단계로.
//   move 단계: 큐의 결과 하나 + 말(또는 대기말) 선택 → 적용. 잡으면 추가던지기 적립.
//             큐가 비고 추가던지기가 있으면 throw로 복귀, 없으면 턴 종료.

import { branchRoutes, GOAL, HOME, walk, walkPath, type Lane, type NodeId, type Route } from "./board";
import type { Owner, Piece, ThrowResult, ThrowName, YutState } from "./types";
import { THROW_LABEL } from "./types";

export const PIECES_PER_PLAYER = 4;

export function initState(humanFirst: boolean): YutState {
  const pieces: Piece[] = [];
  for (let owner = 0 as Owner; owner < 2; owner = (owner + 1) as Owner) {
    for (let i = 0; i < PIECES_PER_PLAYER; i++) {
      pieces.push({ id: owner * PIECES_PER_PLAYER + i, owner, node: HOME, lane: "outer", done: false });
    }
  }
  return {
    pieces,
    turn: humanFirst ? 0 : 1,
    phase: "throw",
    queue: [],
    pendingBonus: 0,
    status: "playing",
    winner: null,
    log: [],
    lastThrow: null,
  };
}

// ===== 던지기 =====

const YUT: ThrowResult = { name: "yut", steps: 4, bonus: true, sticks: [true, true, true, true], nak: false };
const MO: ThrowResult = { name: "mo", steps: 5, bonus: true, sticks: [false, false, false, false], nak: false };

// 윷 던지기. power(0~1)가 셀수록 낙 위험↑, 대신 윷/모(대박)도↑.
export function rollThrow(power = 0.6, rng: () => number = Math.random): ThrowResult {
  const p = Math.max(0, Math.min(1, power));
  // 낙: 세게 던질수록 판 밖으로 나갈 확률↑.
  if (rng() < p * p * 0.3) {
    return { name: "do", steps: 0, bonus: false, sticks: [false, false, false, false], nak: true };
  }
  // 대박 보너스: 세게 던질수록 윷/모가 더 잘 나온다.
  if (rng() < p * 0.25) {
    return rng() < 0.5 ? { ...YUT } : { ...MO };
  }
  // 일반: 윷가락 4개 각 앞면(배) 50%.
  const sticks = [0, 1, 2, 3].map(() => rng() < 0.5); // true = 앞면(배)
  const flats = sticks.filter(Boolean).length;
  let name: ThrowName;
  let steps: number;
  if (flats === 0) {
    name = "mo";
    steps = 5;
  } else if (flats === 4) {
    name = "yut";
    steps = 4;
  } else if (flats === 1 && sticks[0]) {
    name = "backdo"; // 표식 가락만 앞면 → 백도
    steps = -1;
  } else {
    name = (["do", "gae", "geol"] as ThrowName[])[flats - 1];
    steps = flats;
  }
  return { name, steps, bonus: name === "yut" || name === "mo", sticks };
}

// ===== 조회 =====

function ownPiecesAt(s: YutState, owner: Owner, node: NodeId): Piece[] {
  return s.pieces.filter((p) => p.owner === owner && !p.done && p.node === node);
}

// 적용 가능한 "이동 선택지". 분기 꼭짓점에서는 같은 말 그룹에 대해 지름길/바깥길 두 개가 나온다.
export interface MoveTarget {
  key: NodeId; // HOME 또는 노드 id(말 그룹)
  route: Route; // 분기 선택(지름길 diag / 바깥길 straight). 분기 아니면 "diag".
  from: NodeId;
  to: NodeId | typeof GOAL;
  count: number; // 이동할 말 수(업힌 수)
  captures: boolean; // 상대 말을 잡는가
  finishes: boolean; // 완주하는가
}

export function legalTargets(s: YutState, t: ThrowResult): MoveTarget[] {
  const owner = s.turn;
  const out: MoveTarget[] = [];
  const seen = new Set<NodeId>();

  // 대기말 진입(백도는 진입 불가).
  if (t.steps > 0) {
    const home = ownPiecesAt(s, owner, HOME);
    if (home.length > 0) {
      const dest = walk(HOME, "outer", t.steps, "diag");
      out.push(buildTarget(s, owner, HOME, "diag", 1, dest));
    }
  }

  // 보드 위 말 그룹. 분기 꼭짓점이면 지름길/바깥길 둘 다 제시.
  for (const p of s.pieces) {
    if (p.owner !== owner || p.done || p.node === HOME) continue;
    if (seen.has(p.node)) continue;
    seen.add(p.node);
    const group = ownPiecesAt(s, owner, p.node);
    const destSeen = new Set<string>();
    for (const route of branchRoutes(p.node)) {
      const dest = walk(p.node, p.lane, t.steps, route);
      // 백도가 home으로 가는 등 무의미 이동 제외.
      if (dest !== GOAL && dest.node === p.node) continue;
      const dk = dest === GOAL ? "goal" : dest.node;
      if (destSeen.has(dk)) continue; // 두 경로 결과가 같으면 하나만
      destSeen.add(dk);
      out.push(buildTarget(s, owner, p.node, route, group.length, dest));
    }
  }
  return out;
}

function buildTarget(
  s: YutState,
  owner: Owner,
  from: NodeId,
  route: Route,
  count: number,
  dest: { node: NodeId; lane: Lane } | typeof GOAL,
): MoveTarget {
  if (dest === GOAL) {
    return { key: from, route, from, to: GOAL, count, captures: false, finishes: true };
  }
  const captures =
    s.pieces.some((p) => p.owner !== owner && !p.done && p.node === dest.node) && !isSafeNode(dest.node);
  return { key: from, route, from, to: dest.node, count, captures, finishes: false };
}

// (확장 여지) 안전칸 규칙 — 현재는 없음.
function isSafeNode(_node: NodeId): boolean {
  return false;
}

// 이동을 적용하기 전에 애니메이션에 필요한 상세(움직일 말·경로·잡히는 말)를 계산.
export interface MoveDetail {
  moverIds: number[];
  startNode: NodeId;
  pathNodes: NodeId[]; // 거쳐가는 노드(완주 시 마지막에 GOAL)
  capturedIds: number[];
  finishes: boolean;
}

export function describeMove(
  s: YutState,
  throwIndex: number,
  targetKey: NodeId,
  route: Route = "diag",
): MoveDetail | null {
  const t = s.queue[throwIndex];
  if (!t) return null;
  const owner = s.turn;
  const movers =
    targetKey === HOME
      ? s.pieces.filter((p) => p.owner === owner && !p.done && p.node === HOME).slice(0, 1)
      : s.pieces.filter((p) => p.owner === owner && !p.done && p.node === targetKey);
  if (movers.length === 0) return null;

  const { nodes, finishes } = walkPath(movers[0].node, movers[0].lane, t.steps, route);
  const finalNode = finishes ? GOAL : nodes[nodes.length - 1];
  const capturedIds =
    !finishes && !isSafeNode(finalNode)
      ? s.pieces.filter((p) => p.owner !== owner && !p.done && p.node === finalNode).map((p) => p.id)
      : [];
  return { moverIds: movers.map((m) => m.id), startNode: movers[0].node, pathNodes: nodes, capturedIds, finishes };
}

// ===== 상태 전이 =====

// 던진다. 결과를 큐에 넣고 단계 갱신.
export function applyThrow(s: YutState, t: ThrowResult): YutState {
  if (s.phase !== "throw") return s;
  // 낙: 무효 — 쌓인 결과까지 잃고 차례가 넘어간다.
  if (t.nak) {
    const n = Math.max(1, new Set(s.pieces.map((p) => p.owner)).size);
    return {
      ...s,
      queue: [],
      pendingBonus: 0,
      phase: "throw",
      turn: (s.turn + 1) % n,
      lastThrow: t,
      log: [...s.log, `${s.turn === 0 ? "나" : "봇"}: 낙! ⚠ 차례 넘어감`],
    };
  }
  const queue = [...s.queue, t];
  const log = [...s.log, `${s.turn === 0 ? "나" : "봇"}: ${THROW_LABEL[t.name]}${t.bonus ? " (한 번 더!)" : ""}`];
  if (t.bonus) {
    // 윷/모 → 계속 던진다.
    return { ...s, queue, log, lastThrow: t };
  }
  // 도/개/걸/백도 → 적용 단계.
  // 적용할 게 하나도 legal하지 않으면(전부 무의미) 그 결과는 버려질 수 있다.
  return { ...s, queue, log, phase: "move", lastThrow: t };
}

// 큐의 throwIndex 결과를, targetKey(말 그룹)에 route(지름길/바깥길) 경로로 적용.
export function applyMove(
  s: YutState,
  throwIndex: number,
  targetKey: NodeId,
  route: Route = "diag",
): YutState {
  if (s.phase !== "move") return s;
  const t = s.queue[throwIndex];
  if (!t) return s;
  const owner = s.turn;

  let pieces = s.pieces.map((p) => ({ ...p }));
  const log = [...s.log];
  let bonus = s.pendingBonus;

  // 이동할 말 결정.
  let movers: Piece[];
  if (targetKey === HOME) {
    const home = pieces.filter((p) => p.owner === owner && !p.done && p.node === HOME);
    movers = home.slice(0, 1); // 대기말 하나만 진입
  } else {
    movers = pieces.filter((p) => p.owner === owner && !p.done && p.node === targetKey);
  }
  if (movers.length === 0) return s;

  const dest = walk(movers[0].node, movers[0].lane, t.steps, route);

  if (dest === GOAL) {
    for (const m of movers) {
      m.done = true;
      m.node = GOAL;
    }
    log.push(`${owner === 0 ? "나" : "봇"}: 말 ${movers.length}개 완주! 🏁`);
  } else {
    // 잡기.
    const captured = pieces.filter((p) => p.owner !== owner && !p.done && p.node === dest.node);
    if (captured.length > 0 && !isSafeNode(dest.node)) {
      for (const c of captured) {
        c.node = HOME;
        c.lane = "outer";
      }
      bonus += 1; // 잡으면 한 번 더.
      log.push(`${owner === 0 ? "나" : "봇"}: 상대 말 ${captured.length}개 잡음! ⚔️ (한 번 더!)`);
    }
    for (const m of movers) {
      m.node = dest.node;
      m.lane = dest.lane;
    }
    if (movers.length > 1) log.push(`${owner === 0 ? "나" : "봇"}: 말 ${movers.length}개 업고 이동`);
  }

  // 큐에서 제거.
  const queue = s.queue.filter((_, i) => i !== throwIndex);

  let next: YutState = { ...s, pieces, queue, pendingBonus: bonus, log };

  // 승리 판정.
  const finished = pieces.filter((p) => p.owner === owner && p.done).length;
  if (finished >= PIECES_PER_PLAYER) {
    next = { ...next, phase: "over", status: "win", winner: owner };
    next.log.push(`${owner === 0 ? "나" : "봇"} 승리! 🏆`);
    return next;
  }

  return advance(next);
}

// 큐가 남았으면 move 유지. 비었으면 보너스 소진→throw, 아니면 턴 넘김.
function advance(s: YutState): YutState {
  if (s.queue.length > 0) {
    // 남은 결과 중 적용 가능한 게 없으면 버리고 진행.
    const applicable = s.queue.some((t) => legalTargets(s, t).length > 0);
    if (applicable) return { ...s, phase: "move" };
    return advance({ ...s, queue: [] });
  }
  if (s.pendingBonus > 0) {
    return { ...s, phase: "throw", pendingBonus: s.pendingBonus - 1 };
  }
  // 턴 종료 — 다음 플레이어(인원수로 순환).
  const n = Math.max(1, new Set(s.pieces.map((p) => p.owner)).size);
  return { ...s, phase: "throw", turn: (s.turn + 1) % n };
}

// 서버 스냅샷 → 클라이언트 미러 YutState(애니메이션 계산용). 멀티 전용.
export function stateFromSnapshot(p: {
  pieces: { id: number; owner: number; node: string; lane: string; done: boolean }[];
  turnOwner: number;
  phase: "throw" | "move" | "over";
  queue: ThrowResult[];
  winner: number | null;
}): YutState {
  return {
    pieces: p.pieces.map((x) => ({
      id: x.id,
      owner: x.owner,
      node: x.node,
      lane: x.lane as Lane,
      done: x.done,
    })),
    turn: p.turnOwner,
    phase: p.phase,
    queue: p.queue,
    pendingBonus: 0,
    status: p.phase === "over" ? "win" : "playing",
    winner: p.winner,
    log: [],
    lastThrow: null,
  };
}

// 던진 결과가 적용 불가(legal 없음)일 때 그 결과를 버리고 진행.
export function discardUnplayable(s: YutState): YutState {
  if (s.phase !== "move") return s;
  const queue = s.queue.filter((t) => legalTargets(s, t).length > 0);
  if (queue.length === s.queue.length) return s;
  return advance({ ...s, queue });
}
