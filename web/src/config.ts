// 기능 플래그.
// 알까기 정식 활성화 — 배포 빌드에서도 노출한다.
export const FLICK_ENABLED = true;

// 정적 빌드(`npm run build:static`, GitHub Pages 등): 서버 없이 봇 대전만 노출한다.
// WebSocket 연결·방 만들기/참여·알까기(멀티 전용)를 끈다.
export const STATIC_MODE = import.meta.env.MODE === "static";
