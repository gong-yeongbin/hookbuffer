import { createContext, useContext } from 'react';

// 지금 공개하는 범위. true면 랜딩 한 장만 열고(다른 경로는 /로, 상단 메뉴·시작 버튼 숨김) 나머지 기능은 준비될 때 false로 바꾼다.
// 환경 변수가 아니라 코드 상수다. 테스트는 App에 값을 넘겨 전체 화면으로 돈다
export const LANDING_ONLY = true;

export const LandingOnlyContext = createContext(false);
export const useLandingOnly = () => useContext(LandingOnlyContext);
