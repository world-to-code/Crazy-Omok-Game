// 12지신 데이터. Phase 1 은 이름/이모지/색만 사용(말 마커·UI).
// Phase 4 에서 body/accent/ears 등으로 절차적 로우폴리 캐릭터를 생성한다.

export type EarType = "round" | "pointy" | "long" | "horn" | "none" | "floppy";

export interface Zodiac {
  id: string;
  name: string; // 한국어
  emoji: string;
  model: string; // Kenney cube-pets 동물 이름(/models/animal-<model>.glb)
  body: number; // 16진 색(받침 링 틴트·UI)
  accent: number;
  ears: EarType;
  substitute?: boolean; // 정확히 대응하는 모델이 없어 유사 동물로 대체
}

// 12지신 → Kenney cube-pets 매핑. 용/뱀/말/양은 대응 모델이 없어 유사 동물로 대체(substitute).
// 다른 모델로 바꾸려면 model 값만 교체하면 된다(가능 목록: beaver bee bunny cat caterpillar
// chick cow crab deer dog elephant fish fox giraffe hog koala lion monkey panda parrot penguin pig polar tiger).
export const ZODIAC: Zodiac[] = [
  { id: "rat", name: "쥐", emoji: "🐭", model: "beaver", body: 0x9aa3ad, accent: 0xf5d6e0, ears: "round" },
  { id: "ox", name: "소", emoji: "🐮", model: "cow", body: 0xb98a5e, accent: 0xfff3e0, ears: "horn" },
  { id: "tiger", name: "호랑이", emoji: "🐯", model: "tiger", body: 0xf0a13a, accent: 0x2b2118, ears: "pointy" },
  { id: "rabbit", name: "토끼", emoji: "🐰", model: "bunny", body: 0xf3e8e2, accent: 0xf7b9c6, ears: "long" },
  { id: "dragon", name: "용", emoji: "🐲", model: "lion", body: 0x4fae6e, accent: 0xe7d35a, ears: "horn", substitute: true },
  { id: "snake", name: "뱀", emoji: "🐍", model: "caterpillar", body: 0x6fbf73, accent: 0xd7e84f, ears: "none", substitute: true },
  { id: "horse", name: "말", emoji: "🐴", model: "deer", body: 0xa9713f, accent: 0x3a2a1d, ears: "pointy", substitute: true },
  { id: "sheep", name: "양", emoji: "🐑", model: "polar", body: 0xf2efe9, accent: 0xd9cdbf, ears: "floppy", substitute: true },
  { id: "monkey", name: "원숭이", emoji: "🐵", model: "monkey", body: 0xb07a4e, accent: 0xf0c89c, ears: "round" },
  { id: "rooster", name: "닭", emoji: "🐔", model: "chick", body: 0xf4e6c9, accent: 0xe24b3a, ears: "none" },
  { id: "dog", name: "개", emoji: "🐶", model: "dog", body: 0xc99a63, accent: 0x6b4a2e, ears: "floppy" },
  { id: "pig", name: "돼지", emoji: "🐷", model: "pig", body: 0xf3c0cb, accent: 0xe79bb0, ears: "round" },
];

export const ZODIAC_BY_ID: Record<string, Zodiac> = Object.fromEntries(ZODIAC.map((z) => [z.id, z]));

export function zodiacOf(id: string | undefined): Zodiac {
  return (id && ZODIAC_BY_ID[id]) || ZODIAC[0];
}

// 봇의 12지신 — 사람이 고른 것과 겹치지 않게 하나 고른다.
export function botZodiac(humanId: string): Zodiac {
  const others = ZODIAC.filter((z) => z.id !== humanId);
  return others[Math.floor(Math.random() * others.length)];
}
