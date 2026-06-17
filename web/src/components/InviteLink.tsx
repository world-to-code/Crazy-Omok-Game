import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store";
import { copyText } from "../util/clipboard";

// 서버가 알려준 LAN IP 기반 초대 링크. 링크로 접속하면 코드/비번 없이 바로 참가.
export default function InviteLink() {
  const { state } = useGame();
  const code = state.settings?.code;
  const [base, setBase] = useState<string>(location.origin);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ip")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ip) return;
        const scheme = location.protocol; // "http:" | "https:"
        const defaultPort = scheme === "https:" ? 443 : 80;
        const port = d.port ?? defaultPort;
        const portPart = port && port !== defaultPort ? `:${port}` : "";
        setBase(`${scheme}//${d.ip}${portPart}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!code) return null;
  const link = `${base}/?join=${code}`;

  async function copy() {
    const ok = await copyText(link);
    setCopied(ok ? "ok" : "fail");
    if (!ok) {
      // 복사 실패 시 사용자가 직접 복사하도록 텍스트를 선택해 준다.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <div className="invite-box">
      <div className="invite-head">🔗 초대 링크</div>
      <div className="invite-row">
        <input ref={inputRef} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <button className="primary" onClick={copy}>
          {copied === "ok" ? "복사됨!" : copied === "fail" ? "직접 복사" : "복사"}
        </button>
      </div>
      <small>
        {copied === "fail"
          ? "자동 복사가 막혀 있어요. 주소가 선택됐으니 Ctrl+C로 복사하세요."
          : "같은 WiFi에서 이 링크로 접속하면 코드·비밀번호 입력 없이 바로 참가합니다."}
      </small>
    </div>
  );
}
