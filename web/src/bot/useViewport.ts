import { useEffect, useState } from "react";

// 스크롤바를 제외한 '보이는' 뷰포트 너비(px). 보드 크기/풀블리드 정렬에 사용.
export function useViewportWidth(): number {
  const [w, setW] = useState(() =>
    typeof document === "undefined" ? 1024 : document.documentElement.clientWidth,
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setW(el.clientWidth);
    update();
    // 세로 스크롤바 등장/소멸로 clientWidth가 바뀌는 것도 잡도록 ResizeObserver 사용.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return w;
}
