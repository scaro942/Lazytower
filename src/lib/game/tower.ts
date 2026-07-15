// Tower — 2D 횡스크롤 액션 로그라이크 엔진 (Canvas 2D)
// 모든 좌표는 월드 픽셀. 카메라가 플레이어를 팔로우.

export type Vec = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Keys = Record<string, boolean>;

export type FloorRule = {
  id: string;
  name: string;
  desc: string;
  apply: (g: Game, dt: number) => void;
  jumpMul?: number; // 점프 속도 배수 (예: 중력 층)
  dmgTakenMul?: number; // 받는 피해 배수 (예: 불꽃 층)
  enemyHasteMul?: number; // 적 이동/행동 속도 배수 (예: 광기 층)
  playerDmgMul?: number; // 플레이어가 주는 피해 배수 (예: 취약 층)
};

export type Relic = {
  id: string;
  name: string;
  desc: string;
  apply: (g: Game) => void;
  maxStacks?: number; // 이번 런에서 획득 가능한 최대 개수. 미지정 시 기본값 10.
};

export type SkillDef = {
  id: string;
  name: string;
  desc: string;
  cooldown: number; // seconds
  cast: (g: Game) => void;
};

export type PermStats = {
  souls: number;
  strength: number; // +2 atk per level
  agility: number; // -3% dash cd per level
  vitality: number; // +8 maxHp per level
};

const PERM_MAX = 10;
const PERM_COST = (lvl: number) => 5 + lvl * 5;

export const DEFAULT_PERM: PermStats = {
  souls: 0,
  strength: 0,
  agility: 0,
  vitality: 0,
};

const STORAGE_KEY = "tower.perm.v1";

export function loadPerm(): PermStats {
  if (typeof window === "undefined") return { ...DEFAULT_PERM };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERM };
    return { ...DEFAULT_PERM, ...(JSON.parse(raw) as Partial<PermStats>) };
  } catch {
    return { ...DEFAULT_PERM };
  }
}
export function savePerm(p: PermStats) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function upgradePerm(
  p: PermStats,
  key: "strength" | "agility" | "vitality"
): PermStats {
  const lvl = p[key];
  if (lvl >= PERM_MAX) return p;
  const cost = PERM_COST(lvl);
  if (p.souls < cost) return p;
  const next = { ...p, souls: p.souls - cost, [key]: lvl + 1 };
  savePerm(next);
  return next;
}
export function permCost(p: PermStats, key: "strength" | "agility" | "vitality") {
  return PERM_COST(p[key]);
}
export { PERM_MAX };

// ─── constants ────────────────────────────────────────────────────
const GRAVITY = 1600;
const MAX_FALL = 900;
const MOVE_ACCEL = 3200;
const MOVE_MAX = 260;
const FRICTION = 2600;
const JUMP_V = 560;
const DOUBLE_JUMP_V = 500;
const DASH_SPEED = 720;
const DASH_TIME = 0.16;
const DASH_CD = 0.7;
const COMBO_WINDOW = 0.35;

// 탑 최상층. 이 층의 보스를 처치하면 등반 완료(victory).
export const MAX_FLOOR = 51;

// ─── skills library ────────────────────────────────────────────────
export const SKILLS: Record<string, SkillDef> = {
  dashSlash: {
    id: "dashSlash",
    name: "질풍참",
    desc: "전방 대시하며 관통 베기",
    cooldown: 3.5,
    cast: (g) => {
      const p = g.player;
      p.vx = p.facing * 900;
      p.iframes = Math.max(p.iframes, 0.25);
      spawnHitbox(g, {
        x: p.x + p.facing * 6,
        y: p.y - 20,
        w: 90,
        h: 44,
        dmg: 14 + g.stats.atk * 0.6,
        life: 0.18,
        follow: true,
        knockback: 260,
      });
    },
  },
  groundSlam: {
    id: "groundSlam",
    name: "지면 강타",
    desc: "주위를 강타하는 광역 공격",
    cooldown: 5,
    cast: (g) => {
      const p = g.player;
      spawnHitbox(g, {
        x: p.x - 70,
        y: p.y - 10,
        w: 140,
        h: 60,
        dmg: 22 + g.stats.atk * 0.7,
        life: 0.22,
        knockback: 340,
      });
      g.shake = Math.max(g.shake, 10);
    },
  },
  swordRain: {
    id: "swordRain",
    name: "검우",
    desc: "화면 전체에 검이 쏟아진다 (궁극기)",
    cooldown: 22,
    cast: (g) => {
      const p = g.player;
      for (let i = 0; i < 8; i++) {
        setTimeout(() => {
          if (g.destroyed || g.phase !== "playing") return;
          const x = p.x - 260 + i * 65 + (Math.random() - 0.5) * 40;
          spawnHitbox(g, {
            x: x - 22,
            y: g.groundY - 60,
            w: 44,
            h: 80,
            dmg: 18 + g.stats.atk * 0.5,
            life: 0.14,
            knockback: 180,
          });
          g.shake = Math.max(g.shake, 6);
        }, i * 80);
      }
    },
  },

  // ── 광전사 스킬 ──
  whirlwind: {
    id: "whirlwind",
    name: "회전 베기",
    desc: "주위를 두 번 휩쓰는 광역 연타",
    cooldown: 4,
    cast: (g) => {
      const p = g.player;
      spawnHitbox(g, {
        x: p.x - 80,
        y: p.y - 50,
        w: 160,
        h: 60,
        dmg: 16 + g.stats.atk * 0.6,
        life: 0.15,
        knockback: 200,
      });
      setTimeout(() => {
        if (g.destroyed || g.phase !== "playing") return;
        spawnHitbox(g, {
          x: p.x - 80,
          y: p.y - 50,
          w: 160,
          h: 60,
          dmg: 16 + g.stats.atk * 0.6,
          life: 0.15,
          knockback: 260,
        });
        g.shake = Math.max(g.shake, 8);
      }, 180);
    },
  },
  bloodFury: {
    id: "bloodFury",
    name: "피의 격노",
    desc: "HP를 대가로 공격력이 잠시 폭증 (궁극기)",
    cooldown: 20,
    cast: (g) => {
      g.player.hp = Math.max(1, g.player.hp - g.stats.maxHp * 0.1);
      g.buffAtk = Math.max(g.buffAtk, 6);
      g.buffAtkTimer = Math.max(g.buffAtkTimer, 6);
      for (let i = 0; i < 14; i++) {
        g.particles.push({
          x: g.player.x,
          y: g.player.y - 26,
          vx: (Math.random() - 0.5) * 200,
          vy: -80 - Math.random() * 160,
          life: 0.5,
          color: "#e94b3c",
        });
      }
      g.shake = Math.max(g.shake, 8);
    },
  },

  // ── 수호기사 스킬 ──
  shieldBash: {
    id: "shieldBash",
    name: "방패 강타",
    desc: "전방을 강타하고 강하게 밀쳐낸다",
    cooldown: 4,
    cast: (g) => {
      const p = g.player;
      p.vx = p.facing * 300;
      spawnHitbox(g, {
        x: p.x + (p.facing > 0 ? 0 : -70),
        y: p.y - 46,
        w: 70,
        h: 52,
        dmg: 14 + g.stats.atk * 0.5,
        life: 0.16,
        knockback: 420,
      });
      g.shake = Math.max(g.shake, 6);
    },
  },
  fortify: {
    id: "fortify",
    name: "철벽",
    desc: "잠시 무적이 되고 HP를 회복한다",
    cooldown: 14,
    cast: (g) => {
      g.player.iframes = Math.max(g.player.iframes, 1.6);
      g.player.hp = Math.min(g.stats.maxHp, g.player.hp + g.stats.maxHp * 0.2);
      for (let i = 0; i < 12; i++) {
        g.particles.push({
          x: g.player.x,
          y: g.player.y - 26,
          vx: (Math.random() - 0.5) * 120,
          vy: -60 - Math.random() * 100,
          life: 0.6,
          color: "#8fb4ff",
        });
      }
    },
  },

  // ── 암살자 스킬 ──
  shadowStep: {
    id: "shadowStep",
    name: "그림자 도약",
    desc: "전방으로 순간이동하며 관통 피해",
    cooldown: 3,
    cast: (g) => {
      const p = g.player;
      const nx = Math.max(40, Math.min(g.room.w - 40, p.x + p.facing * 200));
      spawnHitbox(g, {
        x: Math.min(p.x, nx) - 10,
        y: p.y - 44,
        w: Math.abs(nx - p.x) + 20,
        h: 48,
        dmg: 16 + g.stats.atk * 0.5,
        life: 0.12,
        knockback: 120,
      });
      p.x = nx;
      p.iframes = Math.max(p.iframes, 0.2);
      for (let i = 0; i < 8; i++) {
        g.particles.push({
          x: p.x,
          y: p.y - 26,
          vx: (Math.random() - 0.5) * 160,
          vy: -60 - Math.random() * 120,
          life: 0.4,
          color: "#bfa9e6",
        });
      }
    },
  },
  fanOfKnives: {
    id: "fanOfKnives",
    name: "비수 난무",
    desc: "부채꼴로 단검을 흩뿌린다 (궁극기)",
    cooldown: 16,
    cast: (g) => {
      const p = g.player;
      for (let i = -3; i <= 3; i++) {
        const ang = (i / 3) * 0.6;
        g.projectiles.push({
          x: p.x,
          y: p.y - 26,
          vx: p.facing * Math.cos(ang) * 520,
          vy: Math.sin(ang) * 520,
          w: 14,
          h: 6,
          life: 1.2,
          dmg: 12 + g.stats.atk * 0.4,
          fromEnemy: false,
        });
      }
      g.shake = Math.max(g.shake, 6);
    },
  },
};
export const RELICS: Relic[] = [
  {
    id: "sharpEdge",
    name: "예리한 날",
    desc: "공격력 +6",
    apply: (g) => (g.stats.atk += 6),
    maxStacks: 20,
  },
  {
    id: "ironHeart",
    name: "강철 심장",
    desc: "최대 HP +30, 완전 회복",
    apply: (g) => {
      g.stats.maxHp += 30;
      g.player.hp = g.stats.maxHp;
    },
  },
  {
    id: "swiftBoots",
    name: "질풍의 장화",
    desc: "이동속도 +15%, 대시 쿨 -20%",
    apply: (g) => {
      g.stats.moveMul *= 1.15;
      g.stats.dashCdMul *= 0.8;
    },
  },
  {
    id: "berserker",
    name: "광전사의 문양",
    desc: "HP 50% 이하에서 공격력 +40%",
    apply: (g) => g.stats.berserker++,
  },
  {
    id: "vampire",
    name: "흡혈의 인장",
    desc: "적 처치 시 HP +4 회복",
    apply: (g) => g.stats.lifesteal += 4,
  },
  {
    id: "airMaster",
    name: "공중술사",
    desc: "삼단 점프, 공중 공격 피해 +25%",
    apply: (g) => {
      g.stats.maxJumps = 3;
      g.stats.airDmgMul *= 1.25;
    },
  },
  {
    id: "combo",
    name: "연격의 도",
    desc: "3타 마무리 공격이 2배 피해",
    apply: (g) => (g.stats.finisherMul *= 2),
    maxStacks: 3,
  },
  {
    id: "focusRing",
    name: "집중의 반지",
    desc: "치명타 확률 +7%",
    apply: (g) => (g.stats.critChance += 0.07),
    maxStacks: 8,
  },
  {
    id: "killerInstinct",
    name: "필살의 감각",
    desc: "치명타 피해 +0.2배",
    apply: (g) => (g.stats.critMul += 0.2),
    maxStacks: 5,
  },
  {
    id: "regenAmulet",
    name: "재생의 목걸이",
    desc: "초당 HP +0.6 자연 회복",
    apply: (g) => (g.stats.hpRegen += 0.6),
    maxStacks: 10,
  },
  {
    id: "ironSkin",
    name: "강철 피부",
    desc: "받는 피해 -3%",
    apply: (g) => (g.stats.dmgTakenMul *= 0.97),
    maxStacks: 10,
  },
  {
    id: "soulMagnet",
    name: "영혼 자석",
    desc: "영혼 획득량 +8%",
    apply: (g) => (g.stats.soulMul += 0.08),
    maxStacks: 10,
  },
  {
    id: "wardShard",
    name: "결계의 파편",
    desc: "피격 후 무적시간 +0.1초",
    apply: (g) => (g.stats.iframeBonus += 0.1),
    maxStacks: 5,
  },
];

// ─── classes (전직) ────────────────────────────────────────────────
export type ClassId = "wanderer" | "berserker" | "guardian" | "assassin";

export type ClassDef = {
  id: ClassId;
  name: string;
  desc: string;
  color: string;
  loadout: [string, string, string]; // K/L/I 스킬
  apply: (g: Game) => void; // 스탯 보정 (reset 시 적용)
};

export const CLASSES: Record<ClassId, ClassDef> = {
  wanderer: {
    id: "wanderer",
    name: "방랑자",
    desc: "균형 잡힌 기본 전사",
    color: "#f5f5f5",
    loadout: ["dashSlash", "groundSlam", "swordRain"],
    apply: () => {},
  },
  berserker: {
    id: "berserker",
    name: "광전사",
    desc: "공격력 대폭 상승·최대 HP 감소. 처치 시 공격속도 급증.",
    color: "#e94b3c",
    loadout: ["whirlwind", "dashSlash", "bloodFury"],
    apply: (g) => {
      g.stats.atk = Math.round(g.stats.atk * 1.35);
      g.stats.maxHp = Math.round(g.stats.maxHp * 0.8);
      g.stats.lifesteal += 2;
      g.stats.killHaste = 1;
    },
  },
  guardian: {
    id: "guardian",
    name: "수호기사",
    desc: "최대 HP 상승·받는 피해 감소. 느리지만 단단하다.",
    color: "#8fb4ff",
    loadout: ["shieldBash", "groundSlam", "fortify"],
    apply: (g) => {
      g.stats.maxHp = Math.round(g.stats.maxHp * 1.35);
      g.stats.dmgTakenMul *= 0.8;
      g.stats.moveMul *= 0.92;
      g.stats.atk = Math.round(g.stats.atk * 0.95);
    },
  },
  assassin: {
    id: "assassin",
    name: "암살자",
    desc: "빠른 이동·대시, 높은 치명타. 유리 대포.",
    color: "#bfa9e6",
    loadout: ["shadowStep", "dashSlash", "fanOfKnives"],
    apply: (g) => {
      g.stats.moveMul *= 1.18;
      g.stats.dashCdMul *= 0.7;
      g.stats.critChance += 0.3;
      g.stats.critMul = 2.2;
      g.stats.maxHp = Math.round(g.stats.maxHp * 0.9);
      g.stats.maxJumps = 3;
    },
  },
};

// 전직 제단이 등장하는 층 (해당 층 진입 시 선택 기회)
export const CLASS_ALTAR_FLOORS = [5, 25];

// ─── floor rules ───────────────────────────────────────────────────
export const FLOOR_RULES: Record<number, FloorRule> = {
  8: {
    id: "brittle",
    name: "쇠약",
    desc: "받는 피해 +15%",
    apply: () => {},
    dmgTakenMul: 1.15,
  },
  15: {
    id: "poison",
    name: "독안개",
    desc: "HP가 지속적으로 감소한다",
    apply: (g, dt) => {
      g.player.hp -= 2 * dt;
    },
  },
  22: {
    id: "frenzy",
    name: "광기",
    desc: "적의 움직임이 빨라진다",
    apply: () => {},
    enemyHasteMul: 1.4,
  },
  28: {
    id: "gravity",
    name: "중력 증가",
    desc: "점프력이 감소한다",
    apply: () => {},
    jumpMul: 0.7,
  },
  35: {
    id: "bloodpact",
    name: "피의 계약",
    desc: "주는 피해 +30%, HP가 서서히 감소",
    apply: (g, dt) => {
      g.player.hp -= 1.5 * dt;
    },
    playerDmgMul: 1.3,
  },
  44: {
    id: "thinair",
    name: "희박한 공기",
    desc: "점프력 감소 + 적 가속",
    apply: () => {},
    jumpMul: 0.8,
    enemyHasteMul: 1.25,
  },
  51: {
    id: "flame",
    name: "불꽃 정상",
    desc: "받는 피해 +25%, 적 가속",
    apply: () => {},
    dmgTakenMul: 1.25,
    enemyHasteMul: 1.2,
  },
};

// ─── entities ──────────────────────────────────────────────────────
export type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: 1 | -1;
  onGround: boolean;
  jumpsLeft: number;
  hp: number;
  dashCd: number;
  dashTime: number;
  dashDir: number;
  iframes: number;
  comboIdx: number;
  comboTimer: number;
  attackTimer: number;
  skillCd: [number, number, number];
  hurtFlash: number;
  animTime: number; // 걷기 애니메이션 누적 시간
};

export type Enemy = {
  id: number;
  type: "grunt" | "archer" | "charger" | "mage" | "boss";
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  onGround: boolean;
  ai: number; // timer
  atkCd: number;
  hurtFlash: number;
  dmg: number;
  dead: boolean;
  dying: number;
  phase: number;
  state: number; // 적별 상태 머신 (0=idle/추적, 1=준비, 2=행동)
  stateTimer: number;
  bossKind?: BossKind; // 보스 종류 (type === "boss"일 때만)
};

export type BossKind = "warden" | "plaguelord" | "stormknight" | "infernal";

export type BossInfo = {
  kind: BossKind;
  name: string;
  color: string;
};

export const BOSS_INFO: Record<BossKind, BossInfo> = {
  warden: { kind: "warden", name: "감옥의 간수", color: "#f0f0f0" },
  plaguelord: { kind: "plaguelord", name: "역병군주", color: "#8fe3a2" },
  stormknight: { kind: "stormknight", name: "폭풍기사", color: "#8fb4ff" },
  infernal: { kind: "infernal", name: "화염군주", color: "#ff8f6b" },
};

// 층/구간에 맞는 보스 종류
export function bossKindForFloor(floor: number): BossKind {
  if (floor >= 51) return "infernal";
  if (floor >= 28) return "stormknight";
  if (floor >= 15) return "plaguelord";
  return "warden";
}

export type Hitbox = Rect & {
  dmg: number;
  life: number;
  follow?: boolean;
  fromEnemy?: boolean;
  knockback?: number;
  hits: Set<number>;
};

export type Projectile = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  life: number;
  dmg: number;
  fromEnemy: boolean;
  homing?: number; // 초당 방향 보정 강도 (마법사 탄)
};

// 바닥 장판(경고 후 발동하는 위험지대)
export type Hazard = {
  x: number;
  y: number;
  r: number; // 반경
  dmg: number;
  warn: number; // 경고 남은 시간 (이 동안은 무해)
  active: number; // 발동 지속 시간
  hit: boolean; // 이번 발동에서 이미 피해를 줬는지
};

export type Room = {
  w: number;
  platforms: Rect[];
  enemies: Enemy[];
  doorOpen: boolean;
  cleared: boolean;
  isBoss: boolean;
  index: number;
  patternId?: string;
};

export type Stats = {
  maxHp: number;
  atk: number;
  moveMul: number;
  dashCdMul: number;
  maxJumps: number;
  airDmgMul: number;
  finisherMul: number;
  berserker: number;
  lifesteal: number;
  dmgTakenMul: number; // 직업/유물에 의한 받는 피해 배수
  critChance: number; // 0~1
  critMul: number; // 크리티컬 배수
  killHaste: number; // 처치 시 얻는 공격속도 버프 강도 (0=없음)
  hpRegen: number; // 초당 HP 자연 회복량
  soulMul: number; // 영혼(재화) 획득 배수
  iframeBonus: number; // 피격 후 무적시간 추가 (초)
};

export type Phase =
  | "playing"
  | "reward"
  | "class_select"
  | "dead"
  | "victory"
  | "cleared_floor";

export type RewardChoice = { kind: "relic"; relic: Relic } | { kind: "heal" };

// ─── helpers ───────────────────────────────────────────────────────
function overlap(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

let hbId = 0;
function spawnHitbox(g: Game, o: Omit<Hitbox, "hits">) {
  g.hitboxes.push({ ...o, hits: new Set() });
  hbId++;
}

let enId = 0;
function makeEnemy(type: Enemy["type"], x: number, y: number): Enemy {
  const base: Enemy = {
    id: ++enId,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    w: 32,
    h: 44,
    hp: 20,
    maxHp: 20,
    facing: -1,
    onGround: false,
    ai: 0,
    atkCd: 0,
    hurtFlash: 0,
    dmg: 8,
    dead: false,
    dying: 0,
    phase: 0,
    state: 0,
    stateTimer: 0,
  };
  if (type === "grunt") {
    return { ...base, hp: 22, maxHp: 22, w: 32, h: 44, dmg: 10 };
  }
  if (type === "archer") {
    return { ...base, hp: 14, maxHp: 14, w: 30, h: 42, dmg: 8 };
  }
  if (type === "charger") {
    return { ...base, hp: 30, maxHp: 30, w: 36, h: 40, dmg: 14 };
  }
  if (type === "mage") {
    return { ...base, hp: 16, maxHp: 16, w: 30, h: 46, dmg: 7 };
  }
  // boss
  return {
    ...base,
    hp: 240,
    maxHp: 240,
    w: 68,
    h: 92,
    dmg: 20,
  };
}

// ─── tower zones (층 구간별 테마) ──────────────────────────────────
export type TowerTheme = {
  id: string;
  name: string;
  bg: string; // 배경 기본색
  fog: string; // 대기 라인/분위기색
  platform: string; // 플랫폼 색
  edge: string; // 플랫폼 윗면 하이라이트
  enemyPool: Enemy["type"][]; // 이 구간의 일반 적 풀
};

export const TOWER_ZONES: { from: number; theme: TowerTheme }[] = [
  {
    from: 1,
    theme: {
      id: "dungeon",
      name: "지하 감옥",
      bg: "#141414",
      fog: "rgba(255,255,255,0.03)",
      platform: "#1c1c1c",
      edge: "#f5f5f5",
      enemyPool: ["grunt", "grunt", "archer"],
    },
  },
  {
    from: 15,
    theme: {
      id: "poison",
      name: "독의 소굴",
      bg: "#0f1710",
      fog: "rgba(120,220,140,0.05)",
      platform: "#16241a",
      edge: "#8fe3a2",
      enemyPool: ["grunt", "archer", "charger"],
    },
  },
  {
    from: 28,
    theme: {
      id: "garden",
      name: "공중 정원",
      bg: "#0d1220",
      fog: "rgba(140,180,255,0.05)",
      platform: "#161f33",
      edge: "#8fb4ff",
      enemyPool: ["charger", "archer", "mage"],
    },
  },
  {
    from: 51,
    theme: {
      id: "summit",
      name: "화염 정상",
      bg: "#1a0d0b",
      fog: "rgba(255,120,90,0.06)",
      platform: "#2a1512",
      edge: "#ff8f6b",
      enemyPool: ["charger", "mage", "grunt"],
    },
  },
];

export function themeForFloor(floor: number): TowerTheme {
  let chosen = TOWER_ZONES[0].theme;
  for (const z of TOWER_ZONES) {
    if (floor >= z.from) chosen = z.theme;
  }
  return chosen;
}

function pickEnemyType(floor: number): Enemy["type"] {
  const pool = themeForFloor(floor).enemyPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── room patterns (테마별 지형+적배치 패턴) ─────────────────────────
// 같은 테마라도 매번 다른 "판"이 나오도록 여러 패턴을 미리 만들어두고
// 방을 생성할 때마다 그 중 하나를 뽑는다. tier가 높을수록(어려운 패턴)
// 층이 올라갈수록 뽑힐 확률이 커진다 (patternTierWeights 참고).
export type RoomPattern = {
  id: string;
  name: string;
  tier: 1 | 2 | 3; // 1=쉬움 2=보통 3=어려움
  minFloor?: number; // 이 층부터만 등장 (너무 이른 층에 과한 난이도 방지)
  themes?: string[]; // 특정 테마(TowerTheme.id)에서만 등장. 미지정 시 모든 테마에서 등장.
  build: (
    w: number,
    groundY: number,
    count: number
  ) => { platforms: Rect[]; spawns: Vec[] };
};

const ROOM_PATTERNS: RoomPattern[] = [
  {
    id: "open_floor",
    name: "탁 트인 홀",
    tier: 1,
    build: (w, groundY, count) => {
      const platforms: Rect[] = [
        { x: w * 0.5 - 90, y: groundY - 70 - Math.random() * 30, w: 180, h: 18 },
      ];
      const spawns: Vec[] = [];
      for (let i = 0; i < count; i++) {
        spawns.push({
          x: 260 + (i * (w - 520)) / Math.max(1, count - 1 || 1),
          y: groundY - 60,
        });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "bridge",
    name: "다리 방",
    tier: 1,
    build: (w, groundY, count) => {
      const platforms: Rect[] = [
        { x: w * 0.28, y: groundY - 100, w: 150, h: 18 },
        { x: w * 0.6, y: groundY - 100, w: 150, h: 18 },
      ];
      const spawns: Vec[] = [];
      for (let i = 0; i < count; i++) {
        const onPlat = i % 3 === 2;
        spawns.push(
          onPlat
            ? { x: w * (0.28 + 0.32 * (i % 2)) + 60, y: groundY - 150 }
            : {
                x: 240 + (i * (w - 480)) / Math.max(1, count - 1 || 1),
                y: groundY - 60,
              }
        );
      }
      return { platforms, spawns };
    },
  },
  {
    id: "staircase",
    name: "계단방",
    tier: 2,
    build: (w, groundY, count) => {
      const steps = 4;
      const platforms: Rect[] = [];
      const spawns: Vec[] = [];
      for (let i = 0; i < steps; i++) {
        const px = 160 + (i * (w - 400)) / (steps - 1);
        const py = groundY - 70 - i * 55;
        platforms.push({ x: px, y: py, w: 150, h: 18 });
        spawns.push({ x: px + 60, y: py - 50 });
      }
      while (spawns.length < count) {
        spawns.push({ x: 220 + Math.random() * (w - 440), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "islands",
    name: "부유섬",
    tier: 2,
    build: (w, groundY, count) => {
      const nIslands = 4;
      const platforms: Rect[] = [];
      const spawns: Vec[] = [];
      for (let i = 0; i < nIslands; i++) {
        const px = 160 + (i * (w - 400)) / (nIslands - 1) + (Math.random() - 0.5) * 40;
        const py = groundY - 90 - Math.random() * 170;
        const pw = 110 + Math.random() * 90;
        platforms.push({ x: px, y: py, w: pw, h: 18 });
        spawns.push({ x: px + pw / 2, y: py - 50 });
      }
      while (spawns.length < count) {
        spawns.push({ x: 240 + Math.random() * (w - 480), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "twin_towers",
    name: "쌍둥이 탑",
    tier: 2,
    build: (w, groundY, count) => {
      const platforms: Rect[] = [
        { x: 200, y: groundY - 120, w: 130, h: 18 },
        { x: 200, y: groundY - 240, w: 130, h: 18 },
        { x: w - 330, y: groundY - 120, w: 130, h: 18 },
        { x: w - 330, y: groundY - 240, w: 130, h: 18 },
      ];
      const spawns: Vec[] = [
        { x: 265, y: groundY - 170 },
        { x: 265, y: groundY - 290 },
        { x: w - 265, y: groundY - 170 },
        { x: w - 265, y: groundY - 290 },
        { x: w * 0.5, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: w * 0.5 + (Math.random() - 0.5) * 200, y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "ring",
    name: "포위의 방",
    tier: 3,
    minFloor: 8,
    build: (w, groundY, count) => {
      const platforms: Rect[] = [
        { x: 150, y: groundY - 110, w: 170, h: 18 },
        { x: w - 320, y: groundY - 110, w: 170, h: 18 },
        { x: w * 0.5 - 90, y: groundY - 210, w: 180, h: 18 },
      ];
      const spawns: Vec[] = [
        { x: 235, y: groundY - 160 },
        { x: w - 235, y: groundY - 160 },
        { x: w * 0.5, y: groundY - 260 },
        { x: w * 0.35, y: groundY - 60 },
        { x: w * 0.65, y: groundY - 60 },
        { x: w * 0.5, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: 240 + Math.random() * (w - 480), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "gauntlet",
    name: "협곡 난투",
    tier: 3,
    minFloor: 10,
    build: (w, groundY, count) => {
      // 좁은 구간에 적을 몰아넣어 근접 압박을 준다
      const platforms: Rect[] = [{ x: w * 0.5 - 60, y: groundY - 130, w: 120, h: 18 }];
      const spawns: Vec[] = [];
      const clusterStart = w * 0.42;
      const clusterEnd = w * 0.58;
      for (let i = 0; i < count + 1; i++) {
        spawns.push({
          x: clusterStart + Math.random() * (clusterEnd - clusterStart),
          y: groundY - 60,
        });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "crossfire",
    name: "교차사격",
    tier: 3,
    minFloor: 14,
    build: (w, groundY, count) => {
      // 여러 높이의 좁은 저격대 — 원거리 적들이 사방에서 견제
      const platforms: Rect[] = [
        { x: 140, y: groundY - 90, w: 100, h: 18 },
        { x: 140, y: groundY - 220, w: 100, h: 18 },
        { x: w - 240, y: groundY - 90, w: 100, h: 18 },
        { x: w - 240, y: groundY - 220, w: 100, h: 18 },
        { x: w * 0.5 - 70, y: groundY - 150, w: 140, h: 18 },
      ];
      const spawns: Vec[] = [
        { x: 190, y: groundY - 140 },
        { x: 190, y: groundY - 270 },
        { x: w - 190, y: groundY - 140 },
        { x: w - 190, y: groundY - 270 },
        { x: w * 0.5, y: groundY - 200 },
        { x: w * 0.5, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: 200 + Math.random() * (w - 400), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },

  // ── 지하 감옥 전용 패턴 ──────────────────────────────────────────
  {
    id: "cellblock",
    name: "감옥 복도",
    tier: 1,
    themes: ["dungeon"],
    build: (w, groundY, count) => {
      // 낮은 칸막이 벽 사이사이에 적이 배치된 좁은 복도
      const platforms: Rect[] = [];
      const cells = 3;
      for (let i = 1; i < cells; i++) {
        const px = (w * i) / cells;
        platforms.push({ x: px - 12, y: groundY - 90, w: 24, h: 90 });
      }
      const spawns: Vec[] = [];
      for (let i = 0; i < count; i++) {
        spawns.push({
          x: 220 + (i * (w - 440)) / Math.max(1, count - 1 || 1),
          y: groundY - 60,
        });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "collapsed_vault",
    name: "무너진 금고방",
    tier: 3,
    minFloor: 6,
    themes: ["dungeon"],
    build: (w, groundY, count) => {
      const platforms: Rect[] = [
        { x: w * 0.15, y: groundY - 60, w: 140, h: 18 },
        { x: w * 0.42, y: groundY - 140, w: 160, h: 18 },
        { x: w * 0.7, y: groundY - 60, w: 140, h: 18 },
      ];
      const spawns: Vec[] = [
        { x: w * 0.15 + 70, y: groundY - 110 },
        { x: w * 0.42 + 80, y: groundY - 190 },
        { x: w * 0.7 + 70, y: groundY - 110 },
        { x: w * 0.5, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: 220 + Math.random() * (w - 440), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },

  // ── 독의 소굴 전용 패턴 ──────────────────────────────────────────
  {
    id: "swamp_isles",
    name: "늪지 웅덩이",
    tier: 2,
    minFloor: 15,
    themes: ["poison"],
    build: (w, groundY, count) => {
      // 낮고 넓게 퍼진 습지형 발판 — 적들이 흩어져서 사방을 견제
      const nIslands = 5;
      const platforms: Rect[] = [];
      const spawns: Vec[] = [];
      for (let i = 0; i < nIslands; i++) {
        const px = 140 + (i * (w - 380)) / (nIslands - 1);
        const py = groundY - 40 - Math.random() * 60;
        const pw = 90 + Math.random() * 60;
        platforms.push({ x: px, y: py, w: pw, h: 14 });
        spawns.push({ x: px + pw / 2, y: py - 50 });
      }
      while (spawns.length < count) {
        spawns.push({ x: 220 + Math.random() * (w - 440), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "toxic_narrows",
    name: "독무 협로",
    tier: 3,
    minFloor: 18,
    themes: ["poison"],
    build: (w, groundY, count) => {
      // 좁은 외길 다리 하나에 적을 몰아 근접+원거리가 뒤섞여 압박
      const platforms: Rect[] = [
        { x: w * 0.5 - 220, y: groundY - 110, w: 440, h: 16 },
      ];
      const spawns: Vec[] = [];
      const start = w * 0.5 - 190;
      const end = w * 0.5 + 190;
      for (let i = 0; i < count + 1; i++) {
        spawns.push({
          x: start + (i * (end - start)) / Math.max(1, count),
          y: groundY - 160,
        });
      }
      return { platforms, spawns };
    },
  },

  // ── 공중 정원 전용 패턴 ──────────────────────────────────────────
  {
    id: "floating_spiral",
    name: "떠오르는 나선계단",
    tier: 2,
    minFloor: 28,
    themes: ["garden"],
    build: (w, groundY, count) => {
      const steps = 6;
      const platforms: Rect[] = [];
      const spawns: Vec[] = [];
      for (let i = 0; i < steps; i++) {
        const side = i % 2 === 0 ? 0.22 : 0.78;
        const px = w * side - 65;
        const py = groundY - 60 - i * 42;
        platforms.push({ x: px, y: py, w: 130, h: 16 });
        if (i % 2 === 0) spawns.push({ x: px + 65, y: py - 50 });
      }
      while (spawns.length < count) {
        spawns.push({ x: 240 + Math.random() * (w - 480), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "wind_gap",
    name: "돌풍 협곡",
    tier: 3,
    minFloor: 32,
    themes: ["garden"],
    build: (w, groundY, count) => {
      // 넓은 간격의 섬 사이로 원거리 적들이 사격 — 대시 이동을 강제
      const platforms: Rect[] = [
        { x: 120, y: groundY - 150, w: 140, h: 16 },
        { x: w * 0.5 - 80, y: groundY - 90, w: 160, h: 16 },
        { x: w - 260, y: groundY - 190, w: 140, h: 16 },
      ];
      const spawns: Vec[] = [
        { x: 190, y: groundY - 200 },
        { x: w * 0.5, y: groundY - 140 },
        { x: w - 190, y: groundY - 240 },
        { x: w * 0.3, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: 220 + Math.random() * (w - 440), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },

  // ── 화염 정상 전용 패턴 ──────────────────────────────────────────
  {
    id: "ember_bridge",
    name: "잔불의 다리",
    tier: 2,
    minFloor: 51,
    themes: ["summit"],
    build: (w, groundY, count) => {
      const platforms: Rect[] = [
        { x: w * 0.5 - 260, y: groundY - 130, w: 180, h: 16 },
        { x: w * 0.5 + 80, y: groundY - 130, w: 180, h: 16 },
      ];
      const spawns: Vec[] = [
        { x: w * 0.5 - 170, y: groundY - 180 },
        { x: w * 0.5 + 170, y: groundY - 180 },
        { x: w * 0.5, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: 220 + Math.random() * (w - 440), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
  {
    id: "lava_ring",
    name: "용암 고리",
    tier: 3,
    minFloor: 55,
    themes: ["summit"],
    build: (w, groundY, count) => {
      // 중앙 고지대를 둘러싼 사면 배치 — 사방에서 협공
      const platforms: Rect[] = [
        { x: w * 0.5 - 100, y: groundY - 190, w: 200, h: 18 },
        { x: 160, y: groundY - 90, w: 140, h: 16 },
        { x: w - 300, y: groundY - 90, w: 140, h: 16 },
      ];
      const spawns: Vec[] = [
        { x: w * 0.5, y: groundY - 240 },
        { x: 230, y: groundY - 140 },
        { x: w - 230, y: groundY - 140 },
        { x: w * 0.35, y: groundY - 60 },
        { x: w * 0.65, y: groundY - 60 },
      ];
      while (spawns.length < count) {
        spawns.push({ x: 220 + Math.random() * (w - 440), y: groundY - 60 });
      }
      return { platforms, spawns };
    },
  },
];

// 층이 올라갈수록 어려운(3티어) 패턴의 등장 비중이 커지고,
// 쉬운(1티어) 패턴의 비중은 줄어든다.
function patternTierWeights(floor: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (floor - 1) / (MAX_FLOOR - 1)));
  const w1 = Math.max(0.12, 1 - t * 1.05);
  const w2 = 0.55 + t * 0.25;
  const w3 = 0.08 + t * 1.35;
  return [w1, w2, w3];
}

function pickRoomPattern(floor: number, excludeId?: string): RoomPattern {
  const weights = patternTierWeights(floor);
  const theme = themeForFloor(floor);
  // 이 테마 전용 패턴 + 테마 제한이 없는 범용 패턴만 후보로 사용
  let avail = ROOM_PATTERNS.filter(
    (p) => floor >= (p.minFloor ?? 1) && (!p.themes || p.themes.includes(theme.id))
  );
  // 직전 방과 같은 패턴은 (다른 후보가 있다면) 제외해서 연속 반복을 방지
  if (excludeId && avail.length > 1) {
    const withoutLast = avail.filter((p) => p.id !== excludeId);
    if (withoutLast.length > 0) avail = withoutLast;
  }
  const total = avail.reduce((s, p) => s + weights[p.tier - 1], 0);
  let r = Math.random() * total;
  for (const p of avail) {
    r -= weights[p.tier - 1];
    if (r <= 0) return p;
  }
  return avail[avail.length - 1];
}

function generateRoom(
  floor: number,
  index: number,
  isBoss: boolean,
  groundY: number,
  excludePatternId?: string
): Room {
  const w = isBoss ? 1400 : 1100 + Math.floor(Math.random() * 400);
  const platforms: Rect[] = [];
  // ground
  platforms.push({ x: 0, y: groundY, w, h: 200 });
  // walls
  platforms.push({ x: -40, y: 0, w: 40, h: groundY + 40 });
  platforms.push({ x: w, y: 0, w: 40, h: groundY + 40 });

  const enemies: Enemy[] = [];
  let chosenPatternId: string | undefined;
  if (isBoss) {
    // 보스방은 기존과 동일하게 고정 레이아웃 유지
    platforms.push({ x: 180, y: groundY - 130, w: 180, h: 18 });
    platforms.push({ x: w - 360, y: groundY - 130, w: 180, h: 18 });

    const boss = makeEnemy("boss", w / 2, groundY - 100);
    boss.bossKind = bossKindForFloor(floor);
    // 종류별 기본 스탯 편차
    if (boss.bossKind === "plaguelord") {
      boss.hp = boss.maxHp = 220;
      boss.w = 60;
      boss.h = 88;
    } else if (boss.bossKind === "stormknight") {
      boss.hp = boss.maxHp = 200;
      boss.w = 56;
      boss.h = 96;
      boss.dmg = 24;
    } else if (boss.bossKind === "infernal") {
      boss.hp = boss.maxHp = 300;
      boss.w = 76;
      boss.h = 100;
      boss.dmg = 24;
    }
    // scale by floor
    boss.hp = boss.maxHp = Math.round(boss.maxHp * (1 + (floor - 1) * 0.2));
    boss.dmg = Math.round(boss.dmg * (1 + (floor - 1) * 0.15));
    enemies.push(boss);
  } else {
    const count = 2 + Math.floor(Math.random() * 3) + Math.min(2, index);
    const pattern = pickRoomPattern(floor, excludePatternId);
    chosenPatternId = pattern.id;
    const built = pattern.build(w, groundY, count);
    platforms.push(...built.platforms);

    // 어려운(3티어) 패턴은 적이 한 명 더 붙는다
    const totalCount = count + (pattern.tier === 3 ? 1 : 0);
    for (let i = 0; i < totalCount; i++) {
      const spot = built.spawns[i % built.spawns.length];
      const jitterX = (Math.random() - 0.5) * 30;
      const ex = Math.max(220, Math.min(w - 220, spot.x + jitterX));
      const ey = spot.y;
      const t = pickEnemyType(floor);
      const e = makeEnemy(t, ex, ey);
      e.hp = e.maxHp = Math.round(e.maxHp * (1 + (floor - 1) * 0.15));
      e.dmg = Math.round(e.dmg * (1 + (floor - 1) * 0.1));
      enemies.push(e);
    }
  }
  return {
    w,
    platforms,
    enemies,
    doorOpen: false,
    cleared: false,
    isBoss,
    index,
    patternId: chosenPatternId,
  };
}

// ─── Game ──────────────────────────────────────────────────────────
export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  keys: Keys = {};
  destroyed = false;

  player!: Player;
  stats!: Stats;
  room!: Room;
  floor = 1;
  roomIndex = 0;
  roomsPerFloor = 4; // 3 combat + 1 boss
  hitboxes: Hitbox[] = [];
  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  camera = { x: 0, y: 0 };
  shake = 0;
  groundY = 520;

  phase: Phase = "playing";
  rewardChoices: RewardChoice[] = [];
  earnedSouls = 0; // 아직 로비에 저장되지 않은(위험) 영혼
  runSouls = 0; // 이번 런에서 획득한 총 영혼 (표시용)

  skillLoadout: [string, string, string] = ["dashSlash", "groundSlam", "swordRain"];

  playerClass: ClassId = "wanderer"; // 현재 런의 직업
  pendingClassChoice = false; // 전직 제단 도달 여부
  buffAtk = 0; // 임시 공격력 가산 (피의 격노 등)
  buffAtkTimer = 0;
  killHasteTimer = 0; // 처치 시 공격속도 버프 잔여 시간
  appliedRelics: Relic[] = []; // 이번 런에서 획득한 유물 (전직 시 재적용용)

  onStateChange?: () => void;
  onSoulsEarned?: (souls: number) => void;

  perm: PermStats;

  private lastT = 0;
  private raf = 0;
  private lastAttackPress = false;
  private lastSkillPress = [false, false, false];
  private lastDashPress = false;
  private lastJumpPress = false;
  private lastInteractPress = false;

  constructor(canvas: HTMLCanvasElement, perm: PermStats) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas ctx");
    this.ctx = ctx;
    this.perm = perm;
    this.reset();
    this.attachInput();
    this.raf = requestAnimationFrame(this.loop);
  }

  emit() {
    this.onStateChange?.();
  }

  reset() {
    const baseHp = 100 + this.perm.vitality * 8;
    const baseAtk = 10 + this.perm.strength * 2;
    this.stats = {
      maxHp: baseHp,
      atk: baseAtk,
      moveMul: 1 + this.perm.agility * 0.02,
      dashCdMul: 1 - this.perm.agility * 0.03,
      maxJumps: 2,
      airDmgMul: 1,
      finisherMul: 1.6,
      berserker: 0,
      lifesteal: 0,
      dmgTakenMul: 1,
      critChance: 0,
      critMul: 1.8,
      killHaste: 0,
      hpRegen: 0,
      soulMul: 1,
      iframeBonus: 0,
    };
    // 새 런은 방랑자로 시작
    this.playerClass = "wanderer";
    this.skillLoadout = [...CLASSES.wanderer.loadout] as [string, string, string];
    CLASSES.wanderer.apply(this);
    this.buffAtk = 0;
    this.buffAtkTimer = 0;
    this.killHasteTimer = 0;
    this.pendingClassChoice = false;
    this.appliedRelics = [];
    this.player = {
      x: 120,
      y: this.groundY - 60,
      vx: 0,
      vy: 0,
      w: 28,
      h: 52,
      facing: 1,
      onGround: false,
      jumpsLeft: this.stats.maxJumps,
      hp: this.stats.maxHp,
      dashCd: 0,
      dashTime: 0,
      dashDir: 1,
      iframes: 0,
      comboIdx: 0,
      comboTimer: 0,
      attackTimer: 0,
      skillCd: [0, 0, 0],
      hurtFlash: 0,
      animTime: 0,
    };
    this.floor = 1;
    this.roomIndex = 0;
    this.earnedSouls = 0;
    this.runSouls = 0;
    this.hitboxes = [];
    this.projectiles = [];
    this.hazards = [];
    this.particles = [];
    this.room = generateRoom(this.floor, 0, false, this.groundY);
    this.phase = "playing";
    this.emit();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.detachInput();
  }

  // ─── input ─────
  private onKeyDown = (e: KeyboardEvent) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code))
      e.preventDefault();
    this.keys[e.code] = true;
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };
  private attachInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }
  private detachInput() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  // ─── main loop ─────
  loop = (t: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.033, (t - (this.lastT || t)) / 1000);
    this.lastT = t;
    if (this.phase === "playing") this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    const p = this.player;
    const k = this.keys;

    // floor rule
    const rule = FLOOR_RULES[this.floor];
    if (rule) rule.apply(this, dt);

    // 직업 버프 타이머
    if (this.buffAtkTimer > 0) {
      this.buffAtkTimer -= dt;
      if (this.buffAtkTimer <= 0) this.buffAtk = 0;
    }
    if (this.killHasteTimer > 0) this.killHasteTimer -= dt;

    // 재생 (유물): 초당 소량의 HP를 회복
    if (this.stats.hpRegen > 0 && p.hp > 0 && p.hp < this.stats.maxHp) {
      p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.hpRegen * dt);
    }

    // input edges
    const jumpPress = !!(k["Space"] || k["KeyW"] || k["ArrowUp"]);
    const jumpEdge = jumpPress && !this.lastJumpPress;
    this.lastJumpPress = jumpPress;

    const attackPress = !!k["KeyJ"];
    const attackEdge = attackPress && !this.lastAttackPress;
    this.lastAttackPress = attackPress;

    const dashPress = !!(k["ShiftLeft"] || k["ShiftRight"]);
    const dashEdge = dashPress && !this.lastDashPress;
    this.lastDashPress = dashPress;

    const skillKeys: ("KeyK" | "KeyL" | "KeyI")[] = ["KeyK", "KeyL", "KeyI"];
    const skillEdges = skillKeys.map((sk, i) => {
      const cur = !!k[sk];
      const edge = cur && !this.lastSkillPress[i];
      this.lastSkillPress[i] = cur;
      return edge;
    });

    const interactPress = !!(k["KeyE"] || k["ArrowDown"]);
    const interactEdge = interactPress && !this.lastInteractPress;
    this.lastInteractPress = interactPress;

    // horizontal input
    const leftHeld = !!(k["KeyA"] || k["ArrowLeft"]);
    const rightHeld = !!(k["KeyD"] || k["ArrowRight"]);
    const dir = (rightHeld ? 1 : 0) + (leftHeld ? -1 : 0);

    // dashing
    if (p.dashTime > 0) {
      p.vx = p.dashDir * DASH_SPEED;
      p.vy = 0;
      p.iframes = Math.max(p.iframes, 0.05);
      p.dashTime -= dt;
    } else {
      if (dir !== 0) {
        p.vx += dir * MOVE_ACCEL * dt;
        p.facing = dir > 0 ? 1 : -1;
      } else {
        const decel = Math.min(Math.abs(p.vx), FRICTION * dt);
        p.vx -= Math.sign(p.vx) * decel;
      }
      const maxV = MOVE_MAX * this.stats.moveMul * (p.attackTimer > 0 && p.onGround ? 0.35 : 1);
      p.vx = Math.max(-maxV, Math.min(maxV, p.vx));
    }

    // 걷기 애니메이션: 지면에서 이동 중일 때 속도에 비례해 진행
    if (p.onGround && Math.abs(p.vx) > 20) {
      p.animTime += dt * (0.6 + Math.abs(p.vx) / MOVE_MAX);
    } else {
      p.animTime = 0; // 정지/공중이면 기본 포즈(프레임 0)
    }

    // jump
    if (jumpEdge && p.jumpsLeft > 0 && p.dashTime <= 0) {
      const jumpMul = FLOOR_RULES[this.floor]?.jumpMul ?? 1;
      const base = p.jumpsLeft === this.stats.maxJumps ? JUMP_V : DOUBLE_JUMP_V;
      p.vy = -base * jumpMul;
      p.jumpsLeft--;
      p.onGround = false;
    }

    // dash — cancels attack
    if (dashEdge && p.dashCd <= 0) {
      const d = dir !== 0 ? dir : p.facing;
      p.dashDir = d;
      p.dashTime = DASH_TIME;
      p.dashCd = DASH_CD * this.stats.dashCdMul;
      p.attackTimer = 0;
      p.comboIdx = 0;
    }
    p.dashCd = Math.max(0, p.dashCd - dt);

    // attack — 3-hit combo, air attack allowed
    if (attackEdge && p.attackTimer <= 0 && p.dashTime <= 0) {
      const idx = p.comboTimer > 0 ? Math.min(2, p.comboIdx) : 0;
      p.comboIdx = idx + 1;
      const hasteMul = this.killHasteTimer > 0 ? 0.6 : 1; // 처치 버프 시 연타 가속
      p.attackTimer = (idx === 2 ? 0.32 : 0.22) * hasteMul;
      p.comboTimer = COMBO_WINDOW;
      const isFinisher = idx === 2;
      const airMul = p.onGround ? 1 : this.stats.airDmgMul;
      const effAtk = this.stats.atk + this.buffAtk;
      let dmg = (7 + effAtk * 0.9) * airMul;
      if (isFinisher) dmg *= this.stats.finisherMul;
      if (this.stats.berserker > 0 && p.hp < this.stats.maxHp * 0.5)
        dmg *= 1 + 0.4 * this.stats.berserker;
      const range = isFinisher ? 72 : 56;
      spawnHitbox(this, {
        x: p.x + (p.facing > 0 ? 4 : -range - 4),
        y: p.y - 34,
        w: range,
        h: 46,
        dmg,
        life: 0.12,
        follow: false,
        knockback: isFinisher ? 340 : 140,
      });
    }

    // skills
    skillEdges.forEach((edge, i) => {
      if (!edge) return;
      if (p.skillCd[i] > 0) return;
      const s = SKILLS[this.skillLoadout[i]];
      if (!s) return;
      s.cast(this);
      p.skillCd[i] = s.cooldown;
    });
    p.skillCd = p.skillCd.map((c) => Math.max(0, c - dt)) as [number, number, number];

    // combo timer
    p.comboTimer = Math.max(0, p.comboTimer - dt);
    if (p.attackTimer > 0) p.attackTimer -= dt;
    if (p.comboTimer <= 0 && p.attackTimer <= 0) p.comboIdx = 0;

    // gravity
    p.vy += GRAVITY * dt;
    p.vy = Math.min(p.vy, MAX_FALL);

    // move + collide
    this.movePlayer(dt);

    if (p.iframes > 0) p.iframes -= dt;
    if (p.hurtFlash > 0) p.hurtFlash -= dt;

    // hitboxes lifetime + follow
    for (const hb of this.hitboxes) {
      hb.life -= dt;
      if (hb.follow) {
        hb.x = p.x + (p.facing > 0 ? 6 : -hb.w - 6);
        hb.y = p.y - 20;
      }
    }
    this.hitboxes = this.hitboxes.filter((h) => h.life > 0);

    // enemies
    for (const e of this.room.enemies) {
      if (e.dead) {
        e.dying -= dt;
        continue;
      }
      this.updateEnemy(e, dt);
    }
    // apply hitboxes vs enemies (player hitboxes)
    const pdMul = FLOOR_RULES[this.floor]?.playerDmgMul ?? 1;
    for (const hb of this.hitboxes) {
      if (hb.fromEnemy) continue;
      for (const e of this.room.enemies) {
        if (e.dead) continue;
        if (hb.hits.has(e.id)) continue;
        if (overlap(hb, { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h })) {
          this.damageEnemy(e, hb.dmg * pdMul, hb.knockback ?? 0, p.facing);
          hb.hits.add(e.id);
        }
      }
    }
    // enemy hitboxes vs player
    for (const hb of this.hitboxes) {
      if (!hb.fromEnemy) continue;
      if (p.iframes > 0) continue;
      if (
        overlap(hb, {
          x: p.x - p.w / 2,
          y: p.y - p.h,
          w: p.w,
          h: p.h,
        })
      ) {
        this.damagePlayer(hb.dmg);
        break;
      }
    }

    // projectiles
    for (const pr of this.projectiles) {
      if (pr.homing && pr.fromEnemy) {
        // 현재 속도 방향을 플레이어 쪽으로 서서히 회전
        const speed = Math.hypot(pr.vx, pr.vy) || 1;
        const desired = Math.atan2(p.y - 24 - pr.y, p.x - pr.x);
        let cur = Math.atan2(pr.vy, pr.vx);
        let diff = desired - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = pr.homing * dt;
        cur += Math.max(-maxTurn, Math.min(maxTurn, diff));
        pr.vx = Math.cos(cur) * speed;
        pr.vy = Math.sin(cur) * speed;
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.fromEnemy) {
        if (p.iframes <= 0 &&
          overlap(pr, { x: p.x - p.w / 2, y: p.y - p.h, w: p.w, h: p.h })) {
          this.damagePlayer(pr.dmg);
          pr.life = 0;
        }
      } else {
        // 플레이어 투사체 → 적
        for (const e of this.room.enemies) {
          if (e.dead) continue;
          if (overlap(pr, { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h })) {
            this.damageEnemy(e, pr.dmg, 60, Math.sign(pr.vx) || p.facing);
            pr.life = 0;
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);

    // hazards (바닥 장판)
    for (const hz of this.hazards) {
      if (hz.warn > 0) {
        hz.warn -= dt;
        continue;
      }
      hz.active -= dt;
      // 발동 중 플레이어가 범위에 있으면 1회 피해
      if (!hz.hit && p.iframes <= 0) {
        const px = p.x;
        const py = p.y - p.h / 2;
        if (Math.abs(px - hz.x) < hz.r && Math.abs(py - hz.y) < 80) {
          this.damagePlayer(hz.dmg);
          hz.hit = true;
        }
      }
    }
    this.hazards = this.hazards.filter((hz) => hz.warn > 0 || hz.active > 0);

    // particles
    for (const pa of this.particles) {
      pa.x += pa.vx * dt;
      pa.y += pa.vy * dt;
      pa.vy += GRAVITY * 0.4 * dt;
      pa.life -= dt;
    }
    this.particles = this.particles.filter((pa) => pa.life > 0);

    // clear dead
    this.room.enemies = this.room.enemies.filter((e) => !(e.dead && e.dying <= 0));
    if (!this.room.cleared && this.room.enemies.length === 0) {
      this.room.cleared = true;
      this.room.doorOpen = true;
      this.emit();
    }

    // camera
    const canvasW = this.canvas.width / devicePixelRatioSafe();
    const canvasH = this.canvas.height / devicePixelRatioSafe();
    const targetX = Math.max(
      0,
      Math.min(this.room.w - canvasW, p.x - canvasW / 2)
    );
    const targetY = Math.max(-100, Math.min(0, p.y - canvasH * 0.65));
    this.camera.x += (targetX - this.camera.x) * Math.min(1, dt * 8);
    this.camera.y += (targetY - this.camera.y) * Math.min(1, dt * 8);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);

    // death
    if (p.hp <= 0 && this.phase === "playing") {
      this.phase = "dead";
      this.bankSouls();
      this.emit();
    }

    // interact — enter door
    if (interactEdge && this.room.doorOpen) {
      const doorX = this.room.w - 60;
      if (Math.abs(p.x - doorX) < 60 && p.onGround) {
        if (this.room.isBoss) this.ackFloorClear();
        else this.nextRoom();
      }
    }
  }

  private movePlayer(dt: number) {
    const p = this.player;
    // X
    p.x += p.vx * dt;
    for (const pl of this.room.platforms) {
      const box = { x: p.x - p.w / 2, y: p.y - p.h, w: p.w, h: p.h };
      if (overlap(pl, box)) {
        if (p.vx > 0) p.x = pl.x - p.w / 2;
        else if (p.vx < 0) p.x = pl.x + pl.w + p.w / 2;
        p.vx = 0;
      }
    }
    // Y
    p.y += p.vy * dt;
    p.onGround = false;
    for (const pl of this.room.platforms) {
      const box = { x: p.x - p.w / 2, y: p.y - p.h, w: p.w, h: p.h };
      if (overlap(pl, box)) {
        if (p.vy > 0) {
          p.y = pl.y;
          p.vy = 0;
          p.onGround = true;
          p.jumpsLeft = this.stats.maxJumps;
        } else if (p.vy < 0) {
          p.y = pl.y + pl.h + p.h;
          p.vy = 0;
        }
      }
    }
  }

  private updateEnemy(e: Enemy, dtRaw: number) {
    const haste = FLOOR_RULES[this.floor]?.enemyHasteMul ?? 1;
    const dt = dtRaw * haste;
    const p = this.player;
    const dx = p.x - e.x;
    e.facing = dx >= 0 ? 1 : -1;
    e.ai += dt;
    e.atkCd = Math.max(0, e.atkCd - dt);
    if (e.hurtFlash > 0) e.hurtFlash -= dt;

    // gravity (haste 영향 제외 — 낙하는 일정하게)
    e.vy += GRAVITY * dtRaw;
    e.vy = Math.min(e.vy, MAX_FALL);

    if (e.type === "grunt") {
      const dist = Math.abs(dx);
      if (dist > 40) e.vx = e.facing * 90;
      else e.vx *= 0.7;
      if (dist < 44 && e.atkCd <= 0 && Math.abs(p.y - e.y) < 60) {
        e.atkCd = 1.1;
        spawnHitbox(this, {
          x: e.x + (e.facing > 0 ? 0 : -46),
          y: e.y - 40,
          w: 46,
          h: 40,
          dmg: e.dmg,
          life: 0.18,
          fromEnemy: true,
        });
      }
    } else if (e.type === "archer") {
      e.vx *= 0.85;
      if (e.atkCd <= 0 && Math.abs(dx) < 520) {
        e.atkCd = 1.6;
        this.projectiles.push({
          x: e.x,
          y: e.y - 24,
          vx: e.facing * 360,
          vy: 0,
          w: 14,
          h: 6,
          life: 2,
          dmg: e.dmg,
          fromEnemy: true,
        });
      }
    } else if (e.type === "charger") {
      // 돌격병: 감지 → 준비(멈칫) → 돌진 → 경직 사이클
      const dist = Math.abs(dx);
      if (e.state === 0) {
        // 추적: 사거리 밖이면 천천히 접근
        if (dist > 260) e.vx = e.facing * 70;
        else e.vx *= 0.7;
        if (dist < 260 && e.atkCd <= 0 && Math.abs(p.y - e.y) < 70) {
          e.state = 1;
          e.stateTimer = 0.45; // 돌진 예비 동작
          e.vx = 0;
        }
      } else if (e.state === 1) {
        e.vx *= 0.6;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 2;
          e.stateTimer = 0.55; // 돌진 지속
        }
      } else if (e.state === 2) {
        e.vx = e.facing * 460;
        e.stateTimer -= dt;
        // 돌진 중 접촉 판정
        if (dist < 40 && Math.abs(p.y - e.y) < 60) {
          spawnHitbox(this, {
            x: e.x - 24,
            y: e.y - 40,
            w: 48,
            h: 44,
            dmg: e.dmg,
            life: 0.1,
            fromEnemy: true,
            knockback: 300,
          });
          e.state = 3;
          e.stateTimer = 0.7;
        }
        if (e.stateTimer <= 0) {
          e.state = 3;
          e.stateTimer = 0.7; // 빗나간 뒤 경직
        }
      } else {
        // 경직: 무방비
        e.vx *= 0.8;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 0;
          e.atkCd = 0.6;
        }
      }
    } else if (e.type === "mage") {
      // 마법사: 거리 유지 + 유도 3연발, 접근당하면 순간이동
      const dist = Math.abs(dx);
      e.vx *= 0.85;
      if (dist < 150) {
        // 너무 가까움 → 블링크로 이탈
        if (e.atkCd <= 0) {
          const away = -e.facing;
          const nx = e.x + away * 260;
          e.x = Math.max(40, Math.min(this.room.w - 40, nx));
          e.atkCd = 1.2;
          for (let i = 0; i < 8; i++) {
            this.particles.push({
              x: e.x,
              y: e.y - e.h / 2,
              vx: (Math.random() - 0.5) * 160,
              vy: -60 - Math.random() * 120,
              life: 0.4,
              color: themeForFloor(this.floor).edge,
            });
          }
        }
      } else if (e.atkCd <= 0 && dist < 620) {
        // 유도 탄 3연발
        e.atkCd = 2.4;
        const baseAng = Math.atan2(p.y - 24 - (e.y - 30), p.x - e.x);
        for (let i = -1; i <= 1; i++) {
          const ang = baseAng + i * 0.22;
          this.projectiles.push({
            x: e.x,
            y: e.y - 30,
            vx: Math.cos(ang) * 240,
            vy: Math.sin(ang) * 240,
            w: 12,
            h: 12,
            life: 2.6,
            dmg: e.dmg,
            fromEnemy: true,
            homing: 2.2,
          });
        }
      }
    } else {
      // boss — 종류별 AI로 분기
      switch (e.bossKind) {
        case "plaguelord":
          this.aiPlaguelord(e, dx, dt);
          break;
        case "stormknight":
          this.aiStormknight(e, dx, dt);
          break;
        case "infernal":
          this.aiInfernal(e, dx, dt);
          break;
        default:
          this.aiWarden(e, dx, dt);
      }
    }

    // move + collide with ground/platforms
    e.x += e.vx * dt;
    e.y += e.vy * dtRaw;
    e.onGround = false;
    for (const pl of this.room.platforms) {
      const box = { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h };
      if (overlap(pl, box)) {
        if (e.vy > 0 && box.y + box.h - e.vy * dt <= pl.y + 4) {
          e.y = pl.y;
          e.vy = 0;
          e.onGround = true;
        } else if (e.vx > 0) {
          e.x = pl.x - e.w / 2;
          e.vx = 0;
        } else if (e.vx < 0) {
          e.x = pl.x + pl.w + e.w / 2;
          e.vx = 0;
        }
      }
    }
    // clamp inside room
    e.x = Math.max(20, Math.min(this.room.w - 20, e.x));
  }

  // ─── boss AIs ──────────────────────────────────────────────────────
  // 감옥의 간수: 근접 강타 + 3방향 탄 (기본형, 반피에서 가속)
  private aiWarden(e: Enemy, dx: number, dt: number) {
    const dist = Math.abs(dx);
    if (e.hp < e.maxHp * 0.5) e.phase = 1;
    const speed = e.phase === 1 ? 160 : 110;
    if (dist > 80) e.vx = e.facing * speed;
    else e.vx *= 0.6;
    if (e.atkCd <= 0) {
      if (dist < 130) {
        e.atkCd = e.phase === 1 ? 1.0 : 1.4;
        spawnHitbox(this, {
          x: e.x + (e.facing > 0 ? 0 : -110),
          y: e.y - 80,
          w: 110,
          h: 80,
          dmg: e.dmg,
          life: 0.22,
          fromEnemy: true,
          knockback: 260,
        });
        this.shake = Math.max(this.shake, 6);
      } else if (dist < 500) {
        e.atkCd = 2.2;
        for (let i = -1; i <= 1; i++) {
          this.projectiles.push({
            x: e.x,
            y: e.y - 60,
            vx: e.facing * 300,
            vy: i * 80,
            w: 18,
            h: 8,
            life: 2.5,
            dmg: e.dmg * 0.6,
            fromEnemy: true,
          });
        }
      }
    }
  }

  // 역병군주: 거리 유지, 독장판 소환 + 유도탄 난사
  private aiPlaguelord(e: Enemy, dx: number, dt: number) {
    const dist = Math.abs(dx);
    if (e.hp < e.maxHp * 0.5) e.phase = 1;
    // 플레이어와 중간 거리 유지
    if (dist < 220) e.vx = -e.facing * 90;
    else if (dist > 360) e.vx = e.facing * 90;
    else e.vx *= 0.7;
    if (e.atkCd <= 0) {
      const roll = Math.random();
      if (roll < 0.5) {
        // 독장판을 플레이어 발밑에 소환
        e.atkCd = e.phase === 1 ? 1.8 : 2.6;
        this.spawnHazard(this.player.x, this.groundY, 90, e.dmg * 0.5);
      } else {
        // 유도탄 부채꼴
        e.atkCd = e.phase === 1 ? 1.6 : 2.2;
        const n = e.phase === 1 ? 5 : 3;
        const base = Math.atan2(this.player.y - 24 - (e.y - 40), this.player.x - e.x);
        for (let i = 0; i < n; i++) {
          const ang = base + (i - (n - 1) / 2) * 0.25;
          this.projectiles.push({
            x: e.x,
            y: e.y - 40,
            vx: Math.cos(ang) * 200,
            vy: Math.sin(ang) * 200,
            w: 12,
            h: 12,
            life: 3,
            dmg: e.dmg * 0.6,
            fromEnemy: true,
            homing: 1.6,
          });
        }
      }
    }
  }

  // 폭풍기사: 순간이동 접근 → 돌진 베기, 원거리에선 낙뢰
  private aiStormknight(e: Enemy, dx: number, dt: number) {
    const dist = Math.abs(dx);
    if (e.hp < e.maxHp * 0.5) e.phase = 1;
    e.vx *= 0.85;
    if (e.state === 0) {
      if (e.atkCd <= 0) {
        e.state = 1;
        e.stateTimer = 0.5;
        // 플레이어 근처로 순간이동
        const side = this.player.x > e.x ? -1 : 1;
        e.x = Math.max(60, Math.min(this.room.w - 60,
          this.player.x + side * 90));
        for (let i = 0; i < 10; i++) {
          this.particles.push({
            x: e.x,
            y: e.y - e.h / 2,
            vx: (Math.random() - 0.5) * 200,
            vy: -80 - Math.random() * 140,
            life: 0.4,
            color: "#8fb4ff",
          });
        }
      }
    } else if (e.state === 1) {
      // 돌진 베기 예비
      e.stateTimer -= dt;
      if (e.stateTimer <= 0) {
        e.state = 0;
        e.atkCd = e.phase === 1 ? 1.4 : 2.0;
        spawnHitbox(this, {
          x: e.x - 70,
          y: e.y - 80,
          w: 140,
          h: 90,
          dmg: e.dmg,
          life: 0.2,
          fromEnemy: true,
          knockback: 300,
        });
        this.shake = Math.max(this.shake, 8);
        // 반피 이후엔 낙뢰 추가
        if (e.phase === 1) {
          for (let i = -2; i <= 2; i++) {
            const lx = this.player.x + i * 110;
            this.spawnHazard(lx, this.groundY, 40, e.dmg * 0.6, 0.7);
          }
        }
      }
    }
  }

  // 화염군주: 화염 파도(바닥 장판 확산) + 잡몹 소환
  private aiInfernal(e: Enemy, dx: number, dt: number) {
    const dist = Math.abs(dx);
    if (e.hp < e.maxHp * 0.5) e.phase = 1;
    if (dist > 120) e.vx = e.facing * (e.phase === 1 ? 130 : 90);
    else e.vx *= 0.6;
    if (e.atkCd <= 0) {
      const roll = Math.random();
      if (dist < 150 && roll < 0.4) {
        // 근접 화염 강타
        e.atkCd = 1.6;
        spawnHitbox(this, {
          x: e.x - 90,
          y: e.y - 80,
          w: 180,
          h: 90,
          dmg: e.dmg,
          life: 0.22,
          fromEnemy: true,
          knockback: 280,
        });
        this.shake = Math.max(this.shake, 8);
      } else if (roll < 0.75) {
        // 화염 파도: 양옆으로 퍼지는 장판
        e.atkCd = e.phase === 1 ? 2.2 : 3.0;
        const step = 90;
        const n = e.phase === 1 ? 6 : 4;
        for (let i = 1; i <= n; i++) {
          this.spawnHazard(e.x + i * step, this.groundY, 50, e.dmg * 0.5, 0.5 + i * 0.12);
          this.spawnHazard(e.x - i * step, this.groundY, 50, e.dmg * 0.5, 0.5 + i * 0.12);
        }
        this.shake = Math.max(this.shake, 6);
      } else {
        // 잡몹 소환 (최대 인원 제한)
        e.atkCd = 4;
        const alive = this.room.enemies.filter((x) => !x.dead && x.type !== "boss").length;
        if (alive < 3) {
          for (let i = -1; i <= 1; i += 2) {
            const add = makeEnemy("grunt", e.x + i * 80, this.groundY - 60);
            add.hp = add.maxHp = Math.round(add.maxHp * (1 + (this.floor - 1) * 0.15));
            add.dmg = Math.round(add.dmg * (1 + (this.floor - 1) * 0.1));
            this.room.enemies.push(add);
          }
        }
      }
    }
  }

  // 바닥 장판 위험지대 생성
  private spawnHazard(x: number, y: number, r: number, dmg: number, delay = 0.35) {
    this.hazards.push({
      x,
      y,
      r,
      dmg,
      warn: delay,
      active: 0.6,
      hit: false,
    });
  }

  private damageEnemy(e: Enemy, dmg: number, kb: number, facing: number) {
    // 치명타 판정
    let d = dmg;
    let crit = false;
    if (this.stats.critChance > 0 && Math.random() < this.stats.critChance) {
      d *= this.stats.critMul;
      crit = true;
    }
    e.hp -= d;
    e.hurtFlash = 0.12;
    e.vx += facing * kb;
    e.vy = Math.min(e.vy, -80);
    this.shake = Math.max(this.shake, crit ? 5 : 3);
    for (let i = 0; i < (crit ? 7 : 4); i++) {
      this.particles.push({
        x: e.x,
        y: e.y - e.h / 2,
        vx: facing * (60 + Math.random() * 120),
        vy: -80 - Math.random() * 120,
        life: 0.4,
        color: crit ? "#ffe08a" : "#ffffff",
      });
    }
    if (e.hp <= 0) {
      e.dead = true;
      e.dying = 0.3;
      const reward =
        e.type === "boss"
          ? 30
          : e.type === "charger"
            ? 5
            : e.type === "mage"
              ? 5
              : e.type === "archer"
                ? 4
                : 3;
      const gained = Math.round(reward * this.stats.soulMul);
      this.earnedSouls += gained;
      this.runSouls += gained;
      if (this.stats.lifesteal > 0) {
        this.player.hp = Math.min(
          this.stats.maxHp,
          this.player.hp + this.stats.lifesteal
        );
      }
      // 광전사: 처치 시 공격속도 버프 갱신
      if (this.stats.killHaste > 0) {
        this.killHasteTimer = 3;
      }
      for (let i = 0; i < 12; i++) {
        this.particles.push({
          x: e.x,
          y: e.y - e.h / 2,
          vx: (Math.random() - 0.5) * 260,
          vy: -140 - Math.random() * 180,
          life: 0.6 + Math.random() * 0.4,
          color: "#ffffff",
        });
      }
      this.emit();
    }
  }

  private damagePlayer(dmg: number) {
    let d = dmg;
    d *= FLOOR_RULES[this.floor]?.dmgTakenMul ?? 1;
    d *= this.stats.dmgTakenMul; // 직업/유물 방어
    this.player.hp -= d;
    this.player.iframes = 0.6 + this.stats.iframeBonus;
    this.player.hurtFlash = 0.2;
    this.player.vy = -220;
    this.player.vx += -this.player.facing * 180;
    this.shake = Math.max(this.shake, 8);
    this.emit();
  }

  // ─── room progression ─────
  private nextRoom() {
    this.roomIndex++;
    const boss = this.roomIndex >= this.roomsPerFloor - 1;
    // reward before every room (except first)
    if (!boss) {
      this.buildRewards();
      this.phase = "reward";
      this.emit();
      return;
    }
    // going into boss room — small reward first
    this.buildRewards();
    this.phase = "reward";
    this.emit();
  }

  private buildRewards() {
    const counts = new Map<string, number>();
    for (const r of this.appliedRelics) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    const avail = RELICS.filter((r) => (counts.get(r.id) ?? 0) < (r.maxStacks ?? 10));
    const pool = [...avail].sort(() => Math.random() - 0.5).slice(0, 2);
    const choices: RewardChoice[] = pool.map((r) => ({ kind: "relic", relic: r }));
    choices.push({ kind: "heal" });
    this.rewardChoices = choices;
  }

  chooseReward(idx: number) {
    const c = this.rewardChoices[idx];
    if (!c) return;
    if (c.kind === "relic") {
      c.relic.apply(this);
      this.appliedRelics.push(c.relic);
    } else this.player.hp = Math.min(this.stats.maxHp, this.player.hp + 40);
    this.rewardChoices = [];

    // spawn next room
    const isBoss = this.roomIndex >= this.roomsPerFloor - 1;
    this.room = generateRoom(
      this.floor,
      this.roomIndex,
      isBoss,
      this.groundY,
      this.room.patternId
    );
    this.player.x = 100;
    this.player.y = this.groundY - 60;
    this.player.vx = 0;
    this.player.vy = 0;
    this.hitboxes = [];
    this.projectiles = [];
    this.hazards = [];
    this.camera.x = 0;
    this.phase = "playing";
    this.emit();
  }

  advanceFloor() {
    this.floor++;
    this.roomIndex = 0;
    this.room = generateRoom(this.floor, 0, false, this.groundY, this.room.patternId);
    this.player.x = 100;
    this.player.y = this.groundY - 60;
    this.player.vx = 0;
    this.player.vy = 0;
    this.hitboxes = [];
    this.projectiles = [];
    this.hazards = [];
    this.camera.x = 0;
    // 전직 제단 층이면 선택 화면을 먼저 띄운다 (아직 방랑자일 때만)
    if (CLASS_ALTAR_FLOORS.includes(this.floor) && this.playerClass === "wanderer") {
      this.phase = "class_select";
    } else {
      this.phase = "playing";
    }
    this.emit();
  }

  // 전직 선택. class_select 화면에서 호출.
  chooseClass(id: ClassId) {
    if (this.phase !== "class_select") return;
    this.playerClass = id;
    // 스탯을 처음부터 다시 계산해 직업 보정을 적용 (HP 비율 보존)
    const hpRatio = this.player.hp / this.stats.maxHp;
    const baseHp = 100 + this.perm.vitality * 8;
    const baseAtk = 10 + this.perm.strength * 2;
    this.stats = {
      maxHp: baseHp,
      atk: baseAtk,
      moveMul: 1 + this.perm.agility * 0.02,
      dashCdMul: 1 - this.perm.agility * 0.03,
      maxJumps: 2,
      airDmgMul: 1,
      finisherMul: 1.6,
      berserker: 0,
      lifesteal: 0,
      dmgTakenMul: 1,
      critChance: 0,
      critMul: 1.8,
      killHaste: 0,
      hpRegen: 0,
      soulMul: 1,
      iframeBonus: 0,
    };
    // 직업 보정을 재적용하고, 이번 런에서 먹은 유물 효과도 다시 적용
    CLASSES[id].apply(this);
    for (const r of this.appliedRelics) r.apply(this);
    this.skillLoadout = [...CLASSES[id].loadout] as [string, string, string];
    this.player.hp = Math.min(this.stats.maxHp, Math.max(1, this.stats.maxHp * hpRatio));
    this.player.skillCd = [0, 0, 0];
    this.phase = "playing";
    this.emit();
  }

  // 그동안 모은 영혼을 로비(영구 저장)에 커밋. 중복 적립 방지.
  private bankSouls() {
    const gained = this.earnedSouls;
    if (gained <= 0) return;
    this.perm = { ...this.perm, souls: this.perm.souls + gained };
    savePerm(this.perm);
    this.onSoulsEarned?.(gained);
    this.earnedSouls = 0;
  }

  // 보스 처치 후 UI에서 호출. 최상층이면 완주, 아니면 다음 층 진입 대기.
  ackFloorClear() {
    if (this.floor >= MAX_FLOOR) {
      this.bankSouls();
      this.phase = "victory";
      this.emit();
      return;
    }
    // 중간 층 클리어: 영혼을 안전하게 저장하고 다음 층 진입 대기 화면으로.
    this.bankSouls();
    this.phase = "cleared_floor";
    this.emit();
  }

  // cleared_floor 화면에서 "다음 층으로" 선택 시 호출.
  ackNextFloor() {
    if (this.phase !== "cleared_floor") return;
    this.advanceFloor();
  }

  // ─── rendering ─────
  private render() {
    const dpr = devicePixelRatioSafe();
    const ctx = this.ctx;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const theme = themeForFloor(this.floor);

    // background — 위로 갈수록 어두워지는 세로 그라데이션
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, shade(theme.bg, -8));
    grad.addColorStop(1, theme.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // vertical tower atmosphere lines
    ctx.strokeStyle = theme.fog;
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const x = ((i * 80 - this.camera.x * 0.3) % (W + 160)) - 40;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // shake
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(-this.camera.x + sx, -this.camera.y + sy);

    // platforms
    for (const pl of this.room.platforms) {
      // ground extra shadow
      ctx.fillStyle = theme.platform;
      ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      ctx.fillStyle = theme.edge;
      ctx.fillRect(pl.x, pl.y, pl.w, 2);
    }

    // door
    if (this.room.doorOpen) {
      const dx = this.room.w - 80;
      const dy = this.groundY - 96;
      ctx.strokeStyle = "#f5f5f5";
      ctx.lineWidth = 2;
      ctx.strokeRect(dx, dy, 44, 96);
      ctx.fillStyle = "rgba(245,245,245,0.08)";
      ctx.fillRect(dx, dy, 44, 96);
      ctx.fillStyle = "#f5f5f5";
      ctx.font = "12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("[E]", dx + 22, dy - 8);
    }

    // particles
    for (const pa of this.particles) {
      ctx.globalAlpha = Math.max(0, pa.life);
      ctx.fillStyle = pa.color;
      ctx.fillRect(pa.x - 1.5, pa.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // hazards (바닥 장판) — 경고는 외곽선, 발동은 채워진 붉은 영역
    for (const hz of this.hazards) {
      const warning = hz.warn > 0;
      ctx.globalAlpha = warning
        ? 0.3 + 0.3 * Math.abs(Math.sin(hz.warn * 12))
        : 0.4;
      ctx.fillStyle = warning ? "rgba(233,75,60,0.5)" : "#e94b3c";
      ctx.fillRect(hz.x - hz.r, hz.y - 8, hz.r * 2, 10);
      if (warning) {
        ctx.strokeStyle = "#e94b3c";
        ctx.lineWidth = 2;
        ctx.strokeRect(hz.x - hz.r, hz.y - 70, hz.r * 2, 78);
      }
      ctx.globalAlpha = 1;
    }

    // projectiles — 아군은 흰색, 마법사 탄은 테마색, 그 외 붉은색
    for (const pr of this.projectiles) {
      if (!pr.fromEnemy) {
        ctx.fillStyle = "#f5f5f5";
        ctx.fillRect(pr.x - pr.w / 2, pr.y - pr.h / 2, pr.w, pr.h);
      } else if (pr.homing) {
        ctx.fillStyle = theme.edge;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#e94b3c";
        ctx.fillRect(pr.x - pr.w / 2, pr.y - pr.h / 2, pr.w, pr.h);
      }
    }

    // enemies
    for (const e of this.room.enemies) {
      const alpha = e.dead ? Math.max(0, e.dying / 0.3) : 1;
      ctx.globalAlpha = alpha;
      // 타입별 기본 실루엣 색
      const baseCol =
        e.type === "charger"
          ? "#d9b38c"
          : e.type === "mage"
            ? "#bfa9e6"
            : e.type === "archer"
              ? "#cfd6c0"
              : e.type === "boss"
                ? (e.bossKind ? BOSS_INFO[e.bossKind].color : "#f0f0f0")
                : "#e9e9e9";
      const flashing = e.hurtFlash > 0;
      // 돌격병 준비 상태(state 1)일 때 붉게 점멸 — 회피 텔레그래프
      const telegraph =
        e.type === "charger" && e.state === 1 && Math.floor(e.ai * 20) % 2 === 0;
      ctx.fillStyle = flashing || telegraph ? "#e94b3c" : baseCol;
      ctx.fillRect(e.x - e.w / 2, e.y - e.h, e.w, e.h);
      // eye slit
      ctx.fillStyle = "#141414";
      const eyeY = e.y - e.h + 12;
      ctx.fillRect(
        e.facing > 0 ? e.x + 2 : e.x - 10,
        eyeY,
        8,
        3
      );
      // 마법사: 머리 위 룬 표식
      if (e.type === "mage") {
        ctx.fillStyle = theme.edge;
        ctx.fillRect(e.x - 3, e.y - e.h - 8, 6, 6);
      }
      // hp bar for boss / injured
      if (e.type === "boss" || e.hp < e.maxHp) {
        const bw = e.w + 10;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(e.x - bw / 2, e.y - e.h - 10, bw, 4);
        ctx.fillStyle = "#e94b3c";
        ctx.fillRect(e.x - bw / 2, e.y - e.h - 10, bw * (e.hp / e.maxHp), 4);
      }
      ctx.globalAlpha = 1;
    }

    // player
    const p = this.player;
    const pFlash = p.hurtFlash > 0 || p.iframes > 0.3;
    ctx.globalAlpha = p.iframes > 0 ? 0.6 : 1;

    const spriteName = CLASS_SPRITE[this.playerClass];
    const set = spriteName ? loadSpriteSet(spriteName) : null;

    if (set && set.loaded) {
      // 걷기 4프레임 순환 (정지 시 0)
      const frame = p.animTime > 0 ? Math.floor(p.animTime * 8) % 4 : 0;
      const img = set.frames[frame];
      // 히트박스 높이에 맞춰 스케일 (발바닥 = p.y 에 정렬)
      const targetH = p.h * 1.9; // 스프라이트에 여백이 포함되어 살짝 크게
      const scale = targetH / img.height;
      const dw = img.width * scale;
      const dh = img.height * scale;
      const footY = p.y;
      // 피격 시 점멸 (iframes 잔량으로 위상 생성)
      const blink = pFlash && Math.floor(p.iframes * 30) % 2 === 0;
      ctx.globalAlpha *= blink ? 0.35 : 1;
      ctx.save();
      if (p.facing < 0) {
        ctx.translate(p.x, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -dw / 2, footY - dh, dw, dh);
      } else {
        ctx.drawImage(img, p.x - dw / 2, footY - dh, dw, dh);
      }
      ctx.restore();
    } else {
      // 폴백: 기존 사각형
      ctx.fillStyle = pFlash ? "#e94b3c" : "#f5f5f5";
      ctx.fillRect(p.x - p.w / 2, p.y - p.h, p.w, p.h);
      ctx.fillStyle = "#141414";
      ctx.fillRect(p.facing > 0 ? p.x + 2 : p.x - 10, p.y - p.h + 14, 8, 3);
    }
    ctx.globalAlpha = 1;
    // sword indicator for attack
    if (p.attackTimer > 0) {
      ctx.strokeStyle = "#f5f5f5";
      ctx.lineWidth = 3;
      const reach = p.comboIdx === 3 ? 72 : 56;
      ctx.beginPath();
      ctx.moveTo(p.x + (p.facing > 0 ? 4 : -4), p.y - 30);
      ctx.lineTo(p.x + p.facing * reach, p.y - 30);
      ctx.stroke();
    }
    // dash trail
    if (p.dashTime > 0) {
      ctx.fillStyle = "rgba(245,245,245,0.25)";
      ctx.fillRect(p.x - p.w / 2 - p.dashDir * 20, p.y - p.h, p.w, p.h);
    }

    // reset transform for HUD-like overlays not needed (React handles)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // floor rule banner
    const rule = FLOOR_RULES[this.floor];
    if (rule) {
      ctx.fillStyle = "rgba(233,75,60,0.15)";
      ctx.fillRect(0, 0, W, 4);
    }
  }
}

function devicePixelRatioSafe() {
  if (typeof window === "undefined") return 1;
  return Math.min(2, window.devicePixelRatio || 1);
}

// ─── 캐릭터 스프라이트 ──────────────────────────────────────────────
// 직업 → 스프라이트 세트 이름. 아직 전용 이미지가 없는 직업은 매핑에서 빼면
// 렌더러가 기존 사각형으로 폴백한다.
const CLASS_SPRITE: Partial<Record<ClassId, string>> = {
  assassin: "assassin",
  guardian: "guardian",
  // 마법사 계열 직업이 없으므로 sorcerer는 추후 매핑. (예: mage 직업 추가 시)
};

type SpriteSet = { frames: HTMLImageElement[]; loaded: boolean };
const spriteCache: Record<string, SpriteSet> = {};

// 지정한 세트를 로드(최초 1회). 4프레임 걷기.
function loadSpriteSet(name: string): SpriteSet {
  if (spriteCache[name]) return spriteCache[name];
  const set: SpriteSet = { frames: [], loaded: false };
  spriteCache[name] = set;
  if (typeof window === "undefined") return set;
  let done = 0;
  for (let i = 0; i < 4; i++) {
    const img = new Image();
    img.onload = () => {
      done++;
      if (done === 4) set.loaded = true;
    };
    img.src = `/sprites/${name}_${i}.png`;
    set.frames.push(img);
  }
  return set;
}

// 미리 로드해두면 첫 등장 시 깜빡임이 없다.
export function preloadSprites() {
  for (const name of Object.values(CLASS_SPRITE)) {
    if (name) loadSpriteSet(name);
  }
}

// #rrggbb 색을 amt(-100~100)만큼 밝게/어둡게 조정
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
