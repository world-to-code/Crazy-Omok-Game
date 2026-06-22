// 윷판(말판) 그래프 — 29칸 표준 윷판: 외곽 20칸 + 대각선 지름길 2개(중앙 공유).
//
// 외곽 링(o0..o19): o0 = 출발/도착 모서리. 모서리 = o0,o5,o10,o15.
//   - o5  = 첫 모 → 지름길 A(중앙 경유 → o15 방향)
//   - o10 = 먼 모 → 지름길 B(중앙 경유 → 출구 방향)
//   - 중앙(c, 방)에 정확히 멈춘 뒤 출발하면 항상 출구 방향(b2)으로 질러간다 → 최단 경로.
//
// 좌표는 [-1,1] 정사각 평면. 3D에서 x,z 로 매핑(스케일은 씬에서).

export type NodeId = string;

export interface BoardNode {
  id: NodeId;
  x: number; // [-1,1]
  y: number; // [-1,1] (3D z축으로 매핑)
  corner: boolean; // 모서리(꼭짓점) — 강조 표시용
  center: boolean; // 중앙(방)
}

// 출발 전 대기(home)와 완주(goal)는 가상 노드.
export const HOME = "home";
export const GOAL = "goal";

function ring(): BoardNode[] {
  // 모서리 4개를 잇는 정사각. 각 변은 5등분(모서리 포함 → 변마다 중간 4칸).
  // o0(1,1) 우하 → 우변 위로 → o5(1,-1) 우상 → 상변 좌로 → o10(-1,-1) 좌상
  //   → 좌변 아래로 → o15(-1,1) 좌하 → 하변 우로 → o0 복귀.
  const corners: [number, number][] = [
    [1, 1], // o0  우하 (출발)
    [1, -1], // o5  우상 (첫 모)
    [-1, -1], // o10 좌상 (먼 모)
    [-1, 1], // o15 좌하
  ];
  const nodes: BoardNode[] = [];
  for (let side = 0; side < 4; side++) {
    const [sx, sy] = corners[side];
    const [ex, ey] = corners[(side + 1) % 4];
    for (let k = 0; k < 5; k++) {
      // k=0 은 모서리, k=1..4 는 변 중간칸. (다음 모서리는 다음 변의 k=0)
      const t = k / 5;
      const idx = side * 5 + k; // 0..19
      nodes.push({
        id: `o${idx}`,
        x: sx + (ex - sx) * t,
        y: sy + (ey - sy) * t,
        corner: k === 0,
        center: false,
      });
    }
  }
  return nodes;
}

// 대각선 노드(중앙 공유).
const DIAG: BoardNode[] = [
  { id: "a1", x: 0.5, y: -0.5, corner: false, center: false }, // o5 → 중앙
  { id: "a2", x: -0.5, y: 0.5, corner: false, center: false }, // 중앙 → o15
  { id: "b1", x: -0.5, y: -0.5, corner: false, center: false }, // o10 → 중앙
  { id: "b2", x: 0.5, y: 0.5, corner: false, center: false }, // 중앙 → 출구
  { id: "c", x: 0, y: 0, corner: false, center: true }, // 중앙(방)
];

export const BOARD_NODES: BoardNode[] = [...ring(), ...DIAG];

const NODE_MAP: Map<NodeId, BoardNode> = new Map(BOARD_NODES.map((n) => [n.id, n]));

export function nodePos(id: NodeId): { x: number; y: number } {
  if (id === HOME) return { x: 1.42, y: 1.42 }; // 출발 모서리 바깥(대기 위치)
  if (id === GOAL) return { x: 1.6, y: 1.0 }; // 도착(완주) 위치
  const n = NODE_MAP.get(id);
  return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
}

// 이동 경로(lane): 외곽/지름길 A/지름길 B/중앙질러가기.
// 한 칸 전진 시 (다음 노드, 다음 lane)을 돌려준다.
// isStart = 이번 수의 첫 한 칸인가(모서리/중앙 분기는 출발 칸에서만 적용).
export type Lane = "outer" | "A" | "B";

interface Step {
  node: NodeId;
  lane: Lane;
}

// 경로 선택: 분기 꼭짓점(모)에서 지름길(대각선) vs 바깥길(직선).
export type Route = "diag" | "straight";

// 이 노드에서 출발할 때 갈림길이 있으면 두 경로, 없으면 하나.
export function branchRoutes(node: NodeId): Route[] {
  if (node === "o5" || node === "o10") return ["diag", "straight"];
  return ["diag"]; // 분기 아님(중앙 포함) → 단일 경로
}

export function stepForward(
  from: NodeId,
  lane: Lane,
  isStart: boolean,
  route: Route = "diag",
): Step | typeof GOAL {
  // 대기 → 진입. home에서 k칸 = o1..o5 (모서리 o5는 5칸에 정확히 안착 → 지름길과 정렬).
  // o0 은 출발/도착 모서리로, 진입 말은 밟지 않고 완주 시 통과한다.
  if (from === HOME) return { node: "o1", lane: "outer" };

  // 분기(모서리/중앙)에 "정확히 멈춰 출발"할 때만 경로 선택 적용.
  if (isStart) {
    if (from === "o5") return route === "straight" ? { node: "o6", lane: "outer" } : { node: "a1", lane: "A" };
    if (from === "o10") return route === "straight" ? { node: "o11", lane: "outer" } : { node: "b1", lane: "B" };
    if (from === "c") return { node: "b2", lane: "B" }; // 방에서 질러가기 → 출구
  }

  // 대각선 진행(지나가는 중 — 선택 없음).
  if (from === "a1") return { node: "c", lane: "A" };
  if (from === "b1") return { node: "c", lane: "B" };
  if (from === "c") return lane === "A" ? { node: "a2", lane: "A" } : { node: "b2", lane: "B" };
  if (from === "a2") return { node: "o15", lane: "outer" }; // 지름길 A는 좌하 꼭짓점 o15로 합류
  if (from === "b2") return GOAL; // 출구

  // 외곽 진행.
  const m = /^o(\d+)$/.exec(from);
  if (m) {
    const i = parseInt(m[1], 10);
    if (i >= 19) return GOAL; // o19 다음 = 출발선 통과 → 완주
    return { node: `o${i + 1}`, lane: "outer" };
  }
  return GOAL;
}

// from 에서 steps 칸 이동의 "거쳐가는 노드 목록"(애니메이션용). 완주하면 마지막에 GOAL 포함.
// route 는 첫 분기(모서리)에서만 적용된다.
export function walkPath(
  from: NodeId,
  lane: Lane,
  steps: number,
  route: Route = "diag",
): { nodes: NodeId[]; finishes: boolean } {
  if (steps <= 0) {
    const r = walk(from, lane, steps, route);
    if (r === GOAL) return { nodes: [GOAL], finishes: true };
    return { nodes: [r.node], finishes: false };
  }
  const nodes: NodeId[] = [];
  let cur = from;
  let cl = lane;
  for (let s = 0; s < steps; s++) {
    const nx = stepForward(cur, cl, s === 0, route);
    if (nx === GOAL) {
      nodes.push(GOAL);
      return { nodes, finishes: true };
    }
    nodes.push(nx.node);
    cur = nx.node;
    cl = nx.lane;
  }
  return { nodes, finishes: false };
}

// from 에서 steps 칸 이동. 결과 노드(또는 GOAL)와 lane 반환. route 는 첫 분기에서만 적용.
export function walk(
  from: NodeId,
  lane: Lane,
  steps: number,
  route: Route = "diag",
): { node: NodeId; lane: Lane } | typeof GOAL {
  // 백도(뒤로 1).
  if (steps < 0) {
    return stepBack(from, lane);
  }
  let curNode = from;
  let curLane = lane;
  for (let s = 0; s < steps; s++) {
    const nx = stepForward(curNode, curLane, s === 0, route);
    if (nx === GOAL) return GOAL;
    curNode = nx.node;
    curLane = nx.lane;
  }
  return { node: curNode, lane: curLane };
}

// 백도: 한 칸 뒤로. 외곽은 인덱스-1, 대기/진입 직후엔 이동 불가(그대로).
function stepBack(from: NodeId, lane: Lane): { node: NodeId; lane: Lane } | typeof GOAL {
  if (from === HOME) return { node: HOME, lane: "outer" }; // 대기 중엔 백도 무의미
  if (from === "o0") return { node: HOME, lane: "outer" };
  if (from === "a1") return { node: "o5", lane: "outer" };
  if (from === "b1") return { node: "o10", lane: "outer" };
  if (from === "a2") return { node: "c", lane: "A" };
  if (from === "b2") return { node: "c", lane: "B" };
  if (from === "c") return { node: "a1", lane: "A" }; // 단순화: 진입 대각선으로 복귀
  if (from === "o16") return { node: "o15", lane: "outer" };
  const m = /^o(\d+)$/.exec(from);
  if (m) {
    const i = parseInt(m[1], 10);
    return { node: `o${Math.max(0, i - 1)}`, lane: "outer" };
  }
  return { node: from, lane };
}
