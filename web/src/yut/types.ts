import type { Lane, NodeId } from "./board";

// 던지기 결과.
export type ThrowName = "backdo" | "do" | "gae" | "geol" | "yut" | "mo";

export interface ThrowResult {
  name: ThrowName;
  steps: number; // 백도=-1, 도1, 개2, 걸3, 윷4, 모5
  bonus: boolean; // 윷/모 → 추가 던지기
  sticks: boolean[]; // 윷가락 4개 앞면(배)=true 시각화용
}

export const THROW_LABEL: Record<ThrowName, string> = {
  backdo: "백도",
  do: "도",
  gae: "개",
  geol: "걸",
  yut: "윷",
  mo: "모",
};

export type Owner = number; // 봇전: 0=사람,1=봇. 멀티: 0..N-1 (자리 순서)

export interface Piece {
  id: number;
  owner: Owner;
  node: NodeId; // "home" | 보드노드 | "goal"
  lane: Lane;
  done: boolean; // 완주
}

export type Phase = "throw" | "move" | "over";

export interface YutState {
  pieces: Piece[];
  turn: Owner;
  phase: Phase;
  queue: ThrowResult[]; // 적용 대기 중인 던지기 결과
  pendingBonus: number; // 잡기/윷/모로 누적된 추가 던지기 권리
  status: "playing" | "win";
  winner: Owner | null;
  log: string[];
  lastThrow: ThrowResult | null;
}
