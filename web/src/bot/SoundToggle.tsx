import { useState } from "react";
import { isMuted, setMuted } from "./sound";

// 게임 바에 두는 음소거 토글(🔊/🔇).
export default function SoundToggle() {
  const [m, setM] = useState(isMuted());
  return (
    <button
      onClick={() => {
        const nv = !m;
        setMuted(nv);
        setM(nv);
      }}
      title={m ? "소리 켜기" : "소리 끄기"}
      aria-label={m ? "소리 켜기" : "소리 끄기"}
      style={{
        background: "transparent",
        border: "1px solid #4a3b32",
        borderRadius: 9,
        cursor: "pointer",
        fontSize: 16,
        lineHeight: 1,
        padding: "6px 9px",
        color: "#c9b89f",
      }}
    >
      {m ? "🔇" : "🔊"}
    </button>
  );
}
