import { CATEGORIES, UPPER_BONUS, UPPER_BONUS_THRESHOLD } from "./engine";

// 요트 처음인 사람을 위한 "게임 방법 + 족보 설명" 안내. 기본 펼침(open).
export default function YachtGuide({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const upper = CATEGORIES.filter((c) => c.section === "upper");
  const lower = CATEGORIES.filter((c) => c.section === "lower");
  return (
    <details open={defaultOpen} style={{ marginTop: 10, fontSize: 12.5 }}>
      <summary style={{ cursor: "pointer", color: "#f0d9a0", fontWeight: 700, padding: "4px 0", userSelect: "none" }}>
        ❔ 게임 방법 · 족보 설명 (처음이면 펼쳐 보세요)
      </summary>

      <div style={{ marginTop: 6, lineHeight: 1.6, color: "#cbbfae" }}>
        <p style={{ margin: "4px 0" }}>
          <b style={{ color: "#e8d6b6" }}>🎯 목표</b> — 12개 칸(족보)을 모두 채웠을 때 <b>총점이 가장 높은 사람</b>이 이겨요.
        </p>
        <p style={{ margin: "4px 0" }}>
          <b style={{ color: "#e8d6b6" }}>🎲 진행</b> — 내 차례에 컵을 흔들어 주사위 5개를 굴립니다. 마음에 드는 주사위는
          <b> 클릭해서 킵</b>(고정)하고, 나머지만 <b>다시 굴리기</b>를 <b>한 차례에 최대 3번</b>까지 할 수 있어요.
          그런 다음 점수표에서 기록할 <b>칸 하나</b>를 고릅니다. 각 칸은 게임당 <b>딱 한 번</b>만 쓸 수 있어요.
        </p>
        <p style={{ margin: "4px 0" }}>
          <b style={{ color: "#e8d6b6" }}>🟢 미리보기</b> — 내 차례에 점수표의 <b style={{ color: "#7fd18c" }}>+초록 숫자</b>는
          그 칸에 지금 기록하면 받게 될 점수예요. 0점짜리 칸에 일부러 기록해 "버리는" 전략도 있어요.
        </p>
        <p style={{ margin: "4px 0" }}>
          <b style={{ color: "#e8d6b6" }}>🎁 보너스</b> — 윗칸(에이스~식스) 점수의 합이 <b>{UPPER_BONUS_THRESHOLD}점 이상</b>이면
          <b> +{UPPER_BONUS}점</b> 보너스! (각 눈을 3개씩 채우면 정확히 63점)
        </p>

        <div style={{ marginTop: 8, color: "#e8d6b6", fontWeight: 700 }}>▸ 윗칸 — 같은 눈 모으기</div>
        <ul style={{ margin: "4px 0", paddingLeft: 16 }}>
          {upper.map((c) => (
            <li key={c.key} style={{ margin: "2px 0" }}>
              <b>{c.name}</b> — {c.desc} <span style={{ color: "#8f8674" }}>({c.example})</span>
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 6, color: "#e8d6b6", fontWeight: 700 }}>▸ 아랫칸 — 특별한 조합</div>
        <ul style={{ margin: "4px 0", paddingLeft: 16 }}>
          {lower.map((c) => (
            <li key={c.key} style={{ margin: "2px 0" }}>
              <b>{c.name}</b> — {c.desc} <span style={{ color: "#8f8674" }}>({c.example})</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
