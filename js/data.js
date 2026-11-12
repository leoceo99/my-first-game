// 유닛 / 분대 / 지원 화력 정의
export const TYPES = {
  rifle: {
    name: '소총병', hp: 60, speed: 44, radius: 6, sight: 300, inf: true,
    weapons: [{ range: 240, dmg: 12, rof: 1.4, acc: 0.5, kind: 'bullet', supp: 4, snd: 'rifle' }],
  },
  mg: {
    name: '기관총 사수', hp: 70, speed: 36, radius: 6, sight: 300, inf: true, setupTime: 1.6,
    weapons: [{ range: 300, dmg: 7, rof: 0.11, burst: 14, reload: 2.4, acc: 0.3, kind: 'bullet', supp: 9, needSetup: true, snd: 'mg' }],
  },
  at: {
    name: '대전차병', hp: 60, speed: 40, radius: 6, sight: 300, inf: true,
    weapons: [
      { range: 260, dmg: 240, rof: 6, acc: 0.7, kind: 'rocket', projSpeed: 380, splash: 26, antiArmor: true, snd: 'rocket' },
      { range: 200, dmg: 9, rof: 1.6, acc: 0.4, kind: 'bullet', supp: 3, snd: 'rifle' },
    ],
  },
  mortar: {
    name: '박격포병', hp: 60, speed: 32, radius: 6, sight: 280, inf: true, setupTime: 2.2,
    weapons: [{ range: 680, minRange: 170, dmg: 70, rof: 5, acc: 0, kind: 'he', splash: 60, spread: 70, indirect: true, needSetup: true, snd: 'mortar' }],
  },
  tank: {
    name: '전차', hp: 1000, speed: 62, radius: 22, sight: 340, vehicle: true, turn: 1.4, turretTurn: 1.3,
    weapons: [
      { range: 360, dmg: 220, rof: 4.2, acc: 0.72, kind: 'shell', projSpeed: 1100, splash: 45, turret: true, antiArmor: true, snd: 'cannon' },
      { range: 280, dmg: 7, rof: 0.12, burst: 12, reload: 2.6, acc: 0.3, kind: 'bullet', supp: 7, snd: 'mg', coax: true },
    ],
  },
  bunker: {
    name: '벙커', hp: 99999, speed: 0, radius: 20, sight: 380, static: true, invuln: true,
    weapons: [{ range: 340, dmg: 9, rof: 0.1, burst: 16, reload: 2, acc: 0.35, kind: 'bullet', supp: 10, snd: 'mg' }],
  },
};

export const SQUADS = [
  { key: 'rifle', name: '소총 분대', cost: 120, time: 5, units: ['rifle', 'rifle', 'rifle', 'rifle', 'rifle'], desc: '다목적 보병 5명' },
  { key: 'mg', name: '기관총 팀', cost: 150, time: 6, units: ['mg', 'mg', 'rifle'], desc: '제압 사격 · 거치 필요' },
  { key: 'at', name: '대전차 팀', cost: 170, time: 6, units: ['at', 'at', 'rifle'], desc: '전차 파괴 특화' },
  { key: 'mortar', name: '박격포 팀', cost: 200, time: 8, units: ['mortar', 'mortar'], desc: '장거리 곡사 지원' },
  { key: 'tank', name: '중형 전차', cost: 400, time: 14, units: ['tank'], desc: '중장갑 · 후면이 약함' },
];

export const BARRAGE = { cost: 300, cd: 50, shells: 10, radius: 120, dmg: 120, splash: 75 };
export const POP_CAP = 40;
export const TICKETS = 500;
export const SUPPLY_BASE = 2.5;
export const SUPPLY_PER_POINT = 1.5;
