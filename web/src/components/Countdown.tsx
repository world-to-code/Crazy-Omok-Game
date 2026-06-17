import { useEffect, useState } from "react";

export default function Countdown({ deadlineMs }: { deadlineMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs == null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadlineMs]);

  if (deadlineMs == null) {
    return <div className="countdown idle">대기 중</div>;
  }

  const remainMs = Math.max(0, deadlineMs - now);
  const secs = Math.ceil(remainMs / 1000);
  const urgent = secs <= 10;

  return (
    <div className={`countdown${urgent ? " urgent" : ""}`}>
      <span className="countdown-label">남은 시간</span>
      <span className="countdown-num">{secs}</span>
      <span className="countdown-unit">초</span>
    </div>
  );
}
