import { useCallback, useRef, useState } from "react";

// 윷 던지기 세기 게이지: 버튼을 누르고 있으면 게이지가 차오르고, 떼는 순간의 세기로 던진다.
export default function PowerThrowButton({
  onThrow,
  disabled,
}: {
  onThrow: (power: number) => void;
  disabled?: boolean;
}) {
  const [power, setPower] = useState(0);
  const [charging, setCharging] = useState(false);
  const raf = useRef(0);
  const start = useRef(0);
  const cur = useRef(0);

  const begin = useCallback(() => {
    if (disabled) return;
    setCharging(true);
    start.current = performance.now();
    const loop = () => {
      const p = Math.min(1, (performance.now() - start.current) / 900); // 0.9초에 만충
      cur.current = p;
      setPower(p);
      if (p < 1) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }, [disabled]);

  const release = useCallback(() => {
    if (!charging) return;
    cancelAnimationFrame(raf.current);
    setCharging(false);
    const p = Math.max(0.2, cur.current); // 최소 세기 보장
    cur.current = 0;
    setPower(0);
    onThrow(p);
  }, [charging, onThrow]);

  // 게이지 색: 약함(초록) → 강함(빨강).
  const hue = 120 - power * 120;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, userSelect: "none" }}>
      <div style={{ width: 220, height: 14, borderRadius: 999, background: "rgba(0,0,0,.45)", border: "1px solid #4a3a55", overflow: "hidden" }}>
        <div style={{ width: `${power * 100}%`, height: "100%", background: `hsl(${hue} 80% 50%)`, transition: charging ? "none" : "width .15s" }} />
      </div>
      <button
        className="big primary"
        disabled={disabled}
        onPointerDown={begin}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        style={{ fontSize: 17, padding: "11px 26px", touchAction: "none" }}
      >
        {charging ? "🎯 힘 조절… (떼면 던짐)" : "🎲 꾹 눌러 윷 던지기"}
      </button>
    </div>
  );
}
