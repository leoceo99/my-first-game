// 화질 단계 (E-1). 화면과 분리된 순수 로직: 단계별 설정값, 고르기 규칙, 자동 낮춤 판단.
// 사실적 그래픽(11-19 디렉터 결정)을 내장 그래픽 노트북 30fps 이상으로 지키기 위한 장치다 (docs/03).
// 아트팀이 후처리(색 보정·안개 효과 등)를 붙일 때는 아래 postFx 값을 읽어 단계별로 켜고 끈다.

export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  level: QualityLevel;
  /** 화면 해상도 배율 상한. 1 = 화면 픽셀 그대로. 낮을수록 흐리지만 빠르다. */
  pixelRatioCap: number;
  /** 계단 현상 줄이기(안티에일리어싱). 렌더러를 만들 때만 정할 수 있어 바꾸면 새로 고침해야 적용된다. */
  antialias: boolean;
  /** 그림자 켜기 */
  shadows: boolean;
  /** 그림자 지도 해상도(정사각형 한 변 픽셀). 클수록 그림자 가장자리가 깨끗하다. */
  shadowMapSize: number;
  /** 그림자 가장자리 부드럽게(PCF 소프트). 높음에서만. */
  softShadows: boolean;
  /** 후처리 단계: none=끔, basic=색 보정 정도, full=전부(아트팀이 정한다) */
  postFx: 'none' | 'basic' | 'full';
  /** 질감 비스듬히 볼 때 선명도(비등방 필터) */
  anisotropy: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { level: 'low', pixelRatioCap: 0.75, antialias: false, shadows: false, shadowMapSize: 512, softShadows: false, postFx: 'none', anisotropy: 1 },
  medium: { level: 'medium', pixelRatioCap: 1, antialias: true, shadows: true, shadowMapSize: 1024, softShadows: false, postFx: 'basic', anisotropy: 4 },
  high: { level: 'high', pixelRatioCap: 1.5, antialias: true, shadows: true, shadowMapSize: 2048, softShadows: true, postFx: 'full', anisotropy: 8 },
};

export const DEFAULT_QUALITY: QualityLevel = 'medium';

export function isQualityLevel(v: unknown): v is QualityLevel {
  return typeof v === 'string' && (QUALITY_LEVELS as readonly string[]).includes(v);
}

/** 실제로 쓸 화면 배율 = min(기기 배율, 단계 상한). 단, 기기 배율이 상한보다 작아도 저화질 상한(1 미만)은 지킨다. */
export function effectivePixelRatio(devicePixelRatio: number, s: QualitySettings): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, s.pixelRatioCap);
}

/**
 * 시작할 때 쓸 단계를 고른다. 우선순위: 주소의 ?q= → 저장해 둔 선택 → 기본(보통).
 * 주소 값이 틀리면 무시한다.
 */
export function pickQuality(urlParam: string | null, saved: string | null): { level: QualityLevel; source: 'url' | 'saved' | 'default' } {
  if (isQualityLevel(urlParam)) return { level: urlParam, source: 'url' };
  if (isQualityLevel(saved)) return { level: saved, source: 'saved' };
  return { level: DEFAULT_QUALITY, source: 'default' };
}

/** 다음 단계(낮음→보통→높음→낮음). 화질 버튼용 */
export function nextQuality(l: QualityLevel): QualityLevel {
  return QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(l) + 1) % QUALITY_LEVELS.length];
}

export function lowerQuality(l: QualityLevel): QualityLevel | null {
  const i = QUALITY_LEVELS.indexOf(l);
  return i > 0 ? QUALITY_LEVELS[i - 1] : null;
}

/**
 * 자동 낮춤: 플레이어가 직접 고르지 않았을 때만, 일정 시간 동안 fps가 계속 기준보다 낮으면 한 단계 내린다.
 * 한 번 내린 뒤에는 다시 판단을 시작한다(연속으로 확 떨어지지 않게 대기 시간을 둔다).
 */
export class AutoQuality {
  private lowFor = 0;
  private warmup: number;
  enabled: boolean;
  constructor(
    enabled: boolean,
    private readonly minFps = 27,
    private readonly holdSec = 6,
    warmupSec = 4,
  ) {
    this.enabled = enabled;
    this.warmup = warmupSec;
  }

  /** 매 프레임 호출. 낮춰야 하면 새 단계를, 아니면 null을 돌려준다. */
  update(dtSec: number, fps: number, current: QualityLevel): QualityLevel | null {
    if (!this.enabled) return null;
    if (this.warmup > 0) { this.warmup -= dtSec; return null; } // 처음 몇 초는 셰이더 준비로 느리다
    if (fps > 0 && fps < this.minFps) this.lowFor += dtSec;
    else this.lowFor = 0;
    if (this.lowFor < this.holdSec) return null;
    this.lowFor = 0;
    this.warmup = 4;
    const lower = lowerQuality(current);
    if (!lower) this.enabled = false; // 이미 최저
    return lower;
  }
}
