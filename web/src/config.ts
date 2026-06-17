// 기능 플래그.
// 알까기는 아직 테스트 단계라 배포(프로덕션 빌드)에서는 비활성화하고,
// 로컬 개발(`npm run dev`)이나 VITE_FLICK=1 로 빌드할 때만 활성화한다.
export const FLICK_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_FLICK === "1";
