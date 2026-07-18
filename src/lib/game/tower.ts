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

export type Rarity = "common" | "rare" | "legendary";

export type Relic = {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  maxStack: number; // 한 런에서 중복 획득 가능한 최대 횟수
  apply: (g: Game) => void;
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

// 방패병이 방어 자세에서 방패를 반대편으로 돌리는 데 걸리는 시간(초).
// 이 시간 동안은 등 뒤 공격이 방어를 무시하고 들어간다 → 대시로 파고드는
// 카운터플레이의 보상 창(window).
const SHIELDER_TURN_DELAY = 0.45;

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
      // 지연 생성되는 히트박스는 cast()가 끝난 뒤 실행되므로
      // 스킬 보너스를 미리 계산해 캡처해 둔다.
      let dmg = (18 + g.stats.atk * 0.5) * (1 + g.stats.skillDmgAdd);
      if (g.echoActive) dmg *= 0.5;
      for (let i = 0; i < 8; i++) {
        setTimeout(() => {
          if (g.destroyed || g.phase !== "playing") return;
          const x = p.x - 260 + i * 65 + (Math.random() - 0.5) * 40;
          spawnHitbox(g, {
            x: x - 22,
            y: g.groundY - 60,
            w: 44,
            h: 80,
            dmg,
            life: 0.14,
            knockback: 180,
            isSkill: true,
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
      // 2타는 지연 생성이므로 스킬 보너스를 미리 계산해 캡처
      let dmg2 = (16 + g.stats.atk * 0.6) * (1 + g.stats.skillDmgAdd);
      if (g.echoActive) dmg2 *= 0.5;
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
          dmg: dmg2,
          life: 0.15,
          knockback: 260,
          isSkill: true,
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
    desc: "2초간 무적. 주변을 밀쳐내고 HP 30 회복",
    cooldown: 14,
    cast: (g) => {
      // 무적을 길게(2초) 줘서 '버티는' 정체성을 강화하고,
      // 회복은 고정값으로 — 최대HP 비례였을 때 후반 무한 자힐이 됐다.
      g.player.iframes = Math.max(g.player.iframes, 2);
      g.player.hp = Math.min(g.stats.maxHp, g.player.hp + 30);
      // 주변 적을 밀어내는 충격파 (버티기 위한 공간 확보)
      spawnHitbox(g, {
        x: g.player.x - 90,
        y: g.player.y - 60,
        w: 180,
        h: 70,
        dmg: 10 + g.stats.atk * 0.3,
        life: 0.2,
        knockback: 380,
      });
      g.shake = Math.max(g.shake, 7);
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        g.particles.push({
          x: g.player.x,
          y: g.player.y - 26,
          vx: Math.cos(ang) * 180,
          vy: Math.sin(ang) * 120 - 40,
          life: 0.5,
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
      // 스킬 보너스를 투사체 피해에도 적용 (메아리면 절반)
      let dmg = (12 + g.stats.atk * 0.4) * (1 + g.stats.skillDmgAdd);
      if (g.echoActive) dmg *= 0.5;
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
          dmg,
          fromEnemy: false,
        });
      }
      g.shake = Math.max(g.shake, 6);
    },
  },
};
export const RELICS: Relic[] = [
  // ── 일반(common) — 반복 획득이 비교적 자유롭지만 효과는 선형 ──
  {
    id: "sharpEdge",
    name: "예리한 날",
    desc: "공격력 +6",
    rarity: "common",
    maxStack: 3,
    apply: (g) => (g.stats.atk += 6),
  },
  {
    id: "swiftBoots",
    name: "질풍의 장화",
    desc: "이동속도 +10%, 대시 쿨 -10%",
    rarity: "common",
    maxStack: 3,
    apply: (g) => {
      // 합연산: 스택해도 선형으로만 증가
      g.stats.moveAdd += 0.1;
      g.stats.dashCdAdd += 0.1;
    },
  },
  {
    id: "hardenedSkin",
    name: "굳은 살갗",
    desc: "받는 피해 -6%",
    rarity: "common",
    maxStack: 3,
    apply: (g) => (g.stats.dmgTakenMul *= 0.94),
  },
  {
    id: "runedGrip",
    name: "룬 각인 손잡이",
    desc: "스킬 피해 +20%",
    rarity: "common",
    maxStack: 3,
    apply: (g) => (g.stats.skillDmgAdd += 0.2),
  },
  // ── 희귀(rare) ──
  {
    id: "swiftCasting",
    name: "속성의 부적",
    desc: "스킬 쿨다운 -15%",
    rarity: "rare",
    maxStack: 3,
    apply: (g) => (g.stats.skillCdAdd += 0.15),
  },
  {
    id: "leechSigil",
    name: "갈증의 인장",
    desc: "스킬 적중 시 HP +6 회복",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => (g.stats.skillLifesteal += 6),
  },
  {
    id: "ironHeart",
    name: "강철 심장",
    desc: "최대 HP +25, HP 25 회복",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => {
      g.stats.maxHp += 25;
      g.player.hp = Math.min(g.stats.maxHp, g.player.hp + 25);
    },
  },
  {
    id: "berserker",
    name: "광전사의 문양",
    desc: "HP 50% 이하에서 공격력 +25%",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => g.stats.berserker++,
  },
  {
    id: "vampire",
    name: "흡혈의 인장",
    desc: "적 처치 시 HP +4 회복",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => (g.stats.lifesteal += 4),
  },
  {
    id: "airMaster",
    name: "공중술사",
    desc: "삼단 점프, 공중 공격 피해 +15%",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => {
      g.stats.maxJumps = 3;
      g.stats.airDmgAdd += 0.15;
    },
  },
  {
    id: "hawkEye",
    name: "매의 눈",
    desc: "치명타 확률 +15%",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => (g.stats.critChance = Math.min(1, g.stats.critChance + 0.15)),
  },
  {
    id: "phoenixFeather",
    name: "불사조 깃털",
    desc: "타격 시 화상 피해 +4 추가",
    rarity: "rare",
    maxStack: 2,
    apply: (g) => (g.stats.fireOnHit += 4),
  },
  {
    id: "spirit",
    name: "수호 정령",
    desc: "정령이 10초마다 적을 자동 공격 (중첩 시 주기 -2초)",
    rarity: "rare",
    maxStack: 5,
    apply: (g) => (g.stats.spirit += 1),
  },
  // ── 전설(legendary) — 강력한 만큼 1회만 ──
  {
    id: "combo",
    name: "연격의 도",
    desc: "3타 마무리 공격 피해 +60%",
    rarity: "legendary",
    maxStack: 1,
    apply: (g) => (g.stats.finisherAdd += 0.6),
  },
  {
    id: "titanLegacy",
    name: "거인의 유산",
    desc: "최대 HP +80, 공격력 +15",
    rarity: "legendary",
    maxStack: 1,
    apply: (g) => {
      g.stats.maxHp += 80;
      g.player.hp = Math.min(g.stats.maxHp, g.player.hp + 80);
      g.stats.atk += 15;
    },
  },
  {
    id: "echoStone",
    name: "메아리의 돌",
    desc: "스킬이 0.4초 뒤 절반 위력으로 한 번 더 발동",
    rarity: "legendary",
    maxStack: 1,
    apply: (g) => (g.stats.skillEcho = true),
  },
  {
    id: "arcaneShard",
    name: "비전의 파편",
    desc: "근접 타격 시 마법 투사체 추가 발사",
    rarity: "legendary",
    maxStack: 1,
    apply: (g) => (g.stats.projectileOnHit = true),
  },
];

// 희귀도별 등장 가중치 (참고: common 60 / rare 30 / legendary 10)
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  rare: 30,
  legendary: 10,
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "일반",
  rare: "희귀",
  legendary: "전설",
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#cfd6c0",
  rare: "#8fb4ff",
  legendary: "#ffd54a",
};

// 가중치 기반으로 유물 count개를 뽑는다.
// stacks에 이미 maxStack만큼 쌓인 유물은 후보에서 제외한다.
function rollRelics(count: number, stacks: Record<string, number>): Relic[] {
  const chosen: Relic[] = [];
  const pool = RELICS.filter((r) => (stacks[r.id] ?? 0) < r.maxStack);
  while (chosen.length < count && pool.length > 0) {
    const totals = pool.map((r) => RARITY_WEIGHT[r.rarity]);
    const sum = totals.reduce((a, b) => a + b, 0);
    let roll = Math.random() * sum;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= totals[i];
      if (roll <= 0) {
        idx = i;
        break;
      }
    }
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}

// ─── classes (전직) ────────────────────────────────────────────────
export type ClassId =
  | "wanderer"
  | "berserker"
  | "guardian"
  | "assassin"
  // 2차 전직 전용 상위 직업 (1차를 건너뛴 보상)
  | "warlord"
  | "templar"
  | "reaper";

// 상위 직업 여부
export function isAdvancedClass(id: ClassId): boolean {
  return id === "warlord" || id === "templar" || id === "reaper";
}

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

  // ── 상위 직업 (2차 전직 전용) ──
  // 1차 전직을 포기하고 방랑자로 20개 층을 버틴 대가로, 기본 직업보다
  // 확실히 강한 성능을 준다.
  warlord: {
    id: "warlord",
    name: "전쟁군주",
    desc: "광전사의 상위. 압도적 공격력과 처치 시 폭주. HP는 낮다.",
    color: "#ff5233",
    loadout: ["whirlwind", "dashSlash", "bloodFury"],
    apply: (g) => {
      g.stats.atk = Math.round(g.stats.atk * 1.6);
      g.stats.maxHp = Math.round(g.stats.maxHp * 0.85);
      g.stats.lifesteal += 5;
      g.stats.killHaste = 1;
      g.stats.critChance += 0.15;
      g.stats.finisherAdd += 0.4;
    },
  },
  templar: {
    id: "templar",
    name: "성전기사",
    desc: "수호기사의 상위. 극한의 방어력에 공격력까지 갖췄다.",
    color: "#5b8dff",
    loadout: ["shieldBash", "groundSlam", "fortify"],
    apply: (g) => {
      g.stats.maxHp = Math.round(g.stats.maxHp * 1.6);
      g.stats.dmgTakenMul *= 0.65;
      g.stats.atk = Math.round(g.stats.atk * 1.15);
      g.stats.lifesteal += 3;
    },
  },
  reaper: {
    id: "reaper",
    name: "사신",
    desc: "암살자의 상위. 치명적인 일격과 압도적 기동력.",
    color: "#a56bff",
    loadout: ["shadowStep", "dashSlash", "fanOfKnives"],
    apply: (g) => {
      g.stats.moveMul *= 1.3;
      g.stats.dashCdMul *= 0.55;
      g.stats.critChance += 0.45;
      g.stats.critMul = 2.6;
      g.stats.maxHp = Math.round(g.stats.maxHp * 0.95);
      g.stats.maxJumps = 3;
      g.stats.atk = Math.round(g.stats.atk * 1.2);
    },
  },
};

// 전직 제단이 등장하는 층 (해당 층 진입 시 선택 기회)
// 전직 제단이 등장하는 층. 테마 경계(5층 주기)에 맞춘다.
// 6층 = 1차 전직(기본 3직업, 건너뛰기 가능)
// 26층 = 2차 전직. 1차를 건너뛴 경우에만 열리며, 상위 직업을 준다.
export const CLASS_ALTAR_1 = 6;
export const CLASS_ALTAR_2 = 26;
export const CLASS_ALTAR_FLOORS = [CLASS_ALTAR_1, CLASS_ALTAR_2];

// ─── floor rules ───────────────────────────────────────────────────
export const FLOOR_RULES: Record<number, FloorRule> = {
  // 규칙은 테마 경계(5층 주기)에 맞춰 배치한다. 1층(지하 감옥)은 규칙 없음.
  6: {
    id: "brittle",
    name: "쇠약",
    desc: "받는 피해 +15%",
    apply: () => {},
    dmgTakenMul: 1.15,
  },
  11: {
    id: "heavywater",
    name: "무거운 물",
    desc: "물에 잠겨 점프가 무겁다",
    apply: () => {},
    jumpMul: 0.85,
  },
  16: {
    id: "poison",
    name: "독안개",
    desc: "HP가 지속적으로 감소한다",
    apply: (g, dt) => {
      g.player.hp -= 2 * dt;
    },
  },
  21: {
    id: "frenzy",
    name: "광기",
    desc: "적의 움직임이 빨라진다",
    apply: () => {},
    enemyHasteMul: 1.4,
  },
  26: {
    id: "gale",
    name: "돌풍",
    desc: "거센 바람에 점프가 눌린다",
    apply: () => {},
    jumpMul: 0.85,
  },
  31: {
    id: "silence",
    name: "정적",
    desc: "적의 움직임이 빨라진다",
    apply: () => {},
    enemyHasteMul: 1.3,
  },
  36: {
    id: "bloodpact",
    name: "피의 계약",
    desc: "주는 피해 +30%, HP가 서서히 감소",
    apply: (g, dt) => {
      g.player.hp -= 1.5 * dt;
    },
    playerDmgMul: 1.3,
  },
  41: {
    id: "ashfall",
    name: "잿더미",
    desc: "받는 피해 +15%",
    apply: () => {},
    dmgTakenMul: 1.15,
  },
  46: {
    id: "thinair",
    name: "희박한 공기",
    desc: "점프가 무거워지고 적이 빨라진다",
    apply: () => {},
    jumpMul: 0.85,
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
  type:
    | "grunt"
    | "archer"
    | "charger"
    | "mage"
    | "shielder"
    | "bomber"
    | "flyer"
    | "brute"
    | "boss";
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
  turnDelay: number; // 방패병이 방어 중 방패를 돌리는 데 걸리는 시간
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
  isSkill?: boolean; // 스킬로 생성된 히트박스 (스킬 흡혈 등에 사용)
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
  homing?: number; // 초당 방향 보정 강도 (마법사 탄, 정령 탄)
  spirit?: boolean; // 정령이 쏜 탄 (아군이며 적을 추적)
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
  fireOnHit: number; // 타격 시 추가 화상 피해 (즉시 적용, DoT 간이 구현)
  projectileOnHit: boolean; // 타격 시 마법 투사체 추가 발사
  spirit: number; // 정령 스택 수 (0=없음). 스택마다 발사 주기 2초 단축
  // ── 스킬 빌드용 ──
  skillDmgAdd: number; // 스킬 피해 가산 비율 (0.3 = +30%)
  skillCdAdd: number; // 스킬 쿨다운 감소 가산 비율
  skillLifesteal: number; // 스킬 적중 시 회복량
  skillEcho: boolean; // 스킬이 0.4초 뒤 한 번 더 발동(피해 50%)
  // ── 유물 합연산 누적치 (스택해도 선형 증가) ──
  moveAdd: number; // 이동속도 가산 비율
  dashCdAdd: number; // 대시 쿨 감소 가산 비율
  airDmgAdd: number; // 공중 피해 가산 비율
  finisherAdd: number; // 마무리 피해 가산 비율
};

export type Phase =
  | "playing"
  | "reward"
  | "class_select"
  | "dead"
  | "victory"
  | "cleared_floor";

export type RewardChoice =
  | { kind: "relic"; relic: Relic }
  | { kind: "heal" }
  | { kind: "souls"; amount: number };

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
  // 스킬 cast() 중 생성된 아군 히트박스는 스킬 판정을 받아 보너스가 붙는다.
  // o.isSkill이 이미 true면 호출부(지연 생성 등)가 보너스를 계산해 넘긴
  // 것이므로 여기서 중복 적용하지 않는다.
  const preMarked = o.isSkill === true;
  const isSkill = preMarked || (g.castingSkill && !o.fromEnemy);
  let dmg = o.dmg;
  if (isSkill && !preMarked) {
    dmg *= 1 + g.stats.skillDmgAdd;
    if (g.echoActive) dmg *= 0.5; // 메아리 재발동은 절반 피해
  }
  g.hitboxes.push({ ...o, dmg, isSkill, hits: new Set() });
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
    turnDelay: SHIELDER_TURN_DELAY,
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
  if (type === "shielder") {
    // 방패병: 방패를 들고 압박하다 강타. 방패를 든 동안 받는 피해가 크게 줄어든다.
    return { ...base, hp: 34, maxHp: 34, w: 34, h: 46, dmg: 11 };
  }
  if (type === "bomber") {
    // 폭탄병: 접근해 자폭. 터지기 전에 처치하면 보상, 터지면 큰 광역 피해.
    return { ...base, hp: 10, maxHp: 10, w: 26, h: 34, dmg: 26 };
  }
  if (type === "flyer") {
    // 비행형: 공중을 부유하며 급강하 돌진.
    return { ...base, hp: 16, maxHp: 16, w: 28, h: 26, dmg: 9 };
  }
  if (type === "brute") {
    // 거인병: 느리지만 맷집과 화력이 강함. 강타 시 좌우로 충격파.
    return { ...base, hp: 55, maxHp: 55, w: 44, h: 56, dmg: 18 };
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
    from: 6,
    theme: {
      id: "catacomb",
      name: "쇠사슬 통로",
      bg: "#181410",
      fog: "rgba(220,200,160,0.04)",
      platform: "#241c14",
      edge: "#e8d5a8",
      enemyPool: ["grunt", "archer", "shielder"],
    },
  },
  {
    from: 11,
    theme: {
      id: "cistern",
      name: "잠긴 수조",
      bg: "#0d1418",
      fog: "rgba(140,200,220,0.05)",
      platform: "#152228",
      edge: "#8fd4e3",
      enemyPool: ["grunt", "archer", "shielder", "charger"],
    },
  },
  {
    from: 16,
    theme: {
      id: "poison",
      name: "독의 소굴",
      bg: "#0f1710",
      fog: "rgba(120,220,140,0.05)",
      platform: "#16241a",
      edge: "#8fe3a2",
      enemyPool: ["grunt", "archer", "charger", "bomber"],
    },
  },
  {
    from: 21,
    theme: {
      id: "madness",
      name: "광기의 회랑",
      bg: "#170f1a",
      fog: "rgba(200,140,255,0.05)",
      platform: "#221630",
      edge: "#c9a2ff",
      enemyPool: ["charger", "bomber", "flyer"],
    },
  },
  {
    from: 26,
    theme: {
      id: "garden",
      name: "공중 정원",
      bg: "#0d1220",
      fog: "rgba(140,180,255,0.05)",
      platform: "#161f33",
      edge: "#8fb4ff",
      enemyPool: ["charger", "archer", "mage", "flyer"],
    },
  },
  {
    from: 31,
    theme: {
      id: "observatory",
      name: "별의 서고",
      bg: "#0a0d1c",
      fog: "rgba(180,190,255,0.06)",
      platform: "#131832",
      edge: "#aab6ff",
      enemyPool: ["mage", "flyer", "archer", "charger"],
    },
  },
  {
    from: 36,
    theme: {
      id: "bloodaltar",
      name: "피의 제단",
      bg: "#180b0e",
      fog: "rgba(255,90,110,0.05)",
      platform: "#2a1218",
      edge: "#ff6b85",
      enemyPool: ["mage", "brute", "shielder"],
    },
  },
  {
    from: 41,
    theme: {
      id: "ashmine",
      name: "재의 광산",
      bg: "#16110c",
      fog: "rgba(230,170,110,0.05)",
      platform: "#241a12",
      edge: "#e8a86b",
      enemyPool: ["brute", "shielder", "bomber", "charger"],
    },
  },
  {
    from: 46,
    theme: {
      id: "thinair",
      name: "희박한 정상",
      bg: "#0c1418",
      fog: "rgba(190,220,240,0.06)",
      platform: "#141f26",
      edge: "#bfe0ff",
      enemyPool: ["brute", "flyer", "bomber", "mage"],
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
      enemyPool: ["charger", "mage", "brute", "bomber"],
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

function generateRoom(
  floor: number,
  index: number,
  isBoss: boolean,
  groundY: number
): Room {
  const w = isBoss ? 1400 : 1100 + Math.floor(Math.random() * 400);
  const platforms: Rect[] = [];
  // ground
  platforms.push({ x: 0, y: groundY, w, h: 200 });
  // walls
  platforms.push({ x: -40, y: 0, w: 40, h: groundY + 40 });
  platforms.push({ x: w, y: 0, w: 40, h: groundY + 40 });
  if (!isBoss) {
    const nP = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nP; i++) {
      const pw = 90 + Math.random() * 120;
      const px = 180 + (i * (w - 300)) / nP + Math.random() * 60;
      // 플랫폼 높이 70~150px.
      // 기본 이단 점프 도달 높이는 176px이므로 모든 플랫폼에 닿는다.
      // 점프 감소 규칙(jumpMul 0.85) 층에서는 127px까지만 닿아서, 낮은 것만
      // 오를 수 있다 — 규칙이 '불편함'으로 작용하되 완전 봉쇄는 되지 않는다.
      const py = groundY - 70 - Math.random() * 80;
      platforms.push({ x: px, y: py, w: pw, h: 18 });
    }
  } else {
    // two side platforms — 점프 감소 층에서도 오를 수 있게 낮게
    platforms.push({ x: 180, y: groundY - 110, w: 180, h: 18 });
    platforms.push({ x: w - 360, y: groundY - 110, w: 180, h: 18 });
  }

  const enemies: Enemy[] = [];
  if (isBoss) {
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
    // DMG 스케일은 완만하게(+6%/층). 가파르면 후반 보스 강타가 즉사기가 된다.
    boss.dmg = Math.round(boss.dmg * (1 + (floor - 1) * 0.06));
    enemies.push(boss);
  } else {
    const count = 2 + Math.floor(Math.random() * 3) + Math.min(2, index);
    for (let i = 0; i < count; i++) {
      const t = pickEnemyType(floor);
      const ex = 260 + Math.random() * (w - 500);
      // 비행 적은 부양 고도(지면 130px 위) 근처에 스폰된다.
      const ey =
        t === "flyer" ? groundY - 60 - 55 - Math.random() * 30 : groundY - 60;
      const e = makeEnemy(t, ex, ey);
      e.hp = e.maxHp = Math.round(e.maxHp * (1 + (floor - 1) * 0.15));
      // DMG 스케일 완만하게(+5%/층) — 후반 잡몹 한 방에 죽는 것 방지
      e.dmg = Math.round(e.dmg * (1 + (floor - 1) * 0.05));
      enemies.push(e);
    }
  }
  return { w, platforms, enemies, doorOpen: false, cleared: false, isBoss, index };
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
  hitNumbers: { x: number; y: number; text: string; life: number; color: string }[] = [];
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
  relicStacks: Record<string, number> = {}; // 유물별 획득 횟수 (스택 상한 체크용)
  spiritCd = 0; // 수호 정령 발사 쿨다운
  animClock = 0; // 렌더 연출용 누적 시간 (정령 공전 등)
  // 스킬 cast() 실행 중임을 표시. 이 동안 생성되는 히트박스/투사체는
  // 스킬 판정을 받아 skillDmgAdd 등 스킬 전용 보너스가 적용된다.
  castingSkill = false;
  echoActive = false; // 메아리로 재발동 중 (피해 50%)

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
      fireOnHit: 0,
      projectileOnHit: false,
      spirit: 0,
      skillDmgAdd: 0,
      skillCdAdd: 0,
      skillLifesteal: 0,
      skillEcho: false,
      moveAdd: 0,
      dashCdAdd: 0,
      airDmgAdd: 0,
      finisherAdd: 0,
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
    this.relicStacks = {};
    this.spiritCd = 0;
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
    this.hitNumbers = [];
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
    this.animClock += dt; // 연출용 시계는 일시정지 중에도 흐른다
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

    // 수호 정령: 주기마다 가장 가까운 적을 자동 공격
    if (this.stats.spirit > 0) {
      this.spiritCd -= dt;
      if (this.spiritCd <= 0) {
        const target = this.nearestEnemy(560);
        if (target) {
          // 스택마다 주기 2초 단축 (1스택 10초 → 5스택 2초), 최소 2초
          const interval = Math.max(2, 10 - (this.stats.spirit - 1) * 2);
          this.spiritCd = interval;
          const sx = p.x;
          const sy = p.y - p.h - 16; // 플레이어 머리 위에서 발사
          const ang = Math.atan2(target.y - target.h / 2 - sy, target.x - sx);
          this.projectiles.push({
            x: sx,
            y: sy,
            vx: Math.cos(ang) * 420,
            vy: Math.sin(ang) * 420,
            w: 12,
            h: 12,
            life: 2,
            dmg: 20 + this.stats.atk * 1.2,
            fromEnemy: false,
            homing: 3.5, // 정령 탄은 적을 따라간다
            spirit: true,
          });
          for (let i = 0; i < 6; i++) {
            this.particles.push({
              x: sx,
              y: sy,
              vx: (Math.random() - 0.5) * 100,
              vy: -40 - Math.random() * 60,
              life: 0.4,
              color: "#8fe3ff",
            });
          }
        }
      }
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
      const maxV =
        MOVE_MAX *
        (this.stats.moveMul + this.stats.moveAdd) *
        (p.attackTimer > 0 && p.onGround ? 0.35 : 1);
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
      // 유물 가산분은 곱연산이 아니라 차감으로 적용하고, 하한을 둬서 0 쿨 방지
      p.dashCd =
        DASH_CD *
        Math.max(0.25, this.stats.dashCdMul - this.stats.dashCdAdd);
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
      const airMul = p.onGround ? 1 : this.stats.airDmgMul + this.stats.airDmgAdd;
      const effAtk = this.stats.atk + this.buffAtk;
      let dmg = (7 + effAtk * 0.9) * airMul;
      if (isFinisher) dmg *= this.stats.finisherMul + this.stats.finisherAdd;
      if (this.stats.berserker > 0 && p.hp < this.stats.maxHp * 0.5)
        dmg *= 1 + 0.25 * this.stats.berserker;
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
      this.castSkill(s);
      // 쿨다운 감소 (하한 30%)
      const cdMul = Math.max(0.3, 1 - this.stats.skillCdAdd);
      p.skillCd[i] = s.cooldown * cdMul;
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
          // 스킬 흡혈: 스킬 히트박스가 적중할 때마다 회복
          if (hb.isSkill && this.stats.skillLifesteal > 0) {
            this.player.hp = Math.min(
              this.stats.maxHp,
              this.player.hp + this.stats.skillLifesteal
            );
          }
          // 불사조 깃털: 타격 시 화상 추가 피해 (즉시 적용하는 간이 DoT)
          if (this.stats.fireOnHit > 0 && !e.dead) {
            this.damageEnemy(e, this.stats.fireOnHit, 0, p.facing);
            for (let i = 0; i < 4; i++) {
              this.particles.push({
                x: e.x,
                y: e.y - e.h / 2,
                vx: (Math.random() - 0.5) * 80,
                vy: -60 - Math.random() * 80,
                life: 0.35,
                color: "#ff8f4a",
              });
            }
          }
          // 비전의 파편: 근접 타격 시 마법 투사체 추가 발사
          if (this.stats.projectileOnHit) {
            this.projectiles.push({
              x: p.x,
              y: p.y - 30,
              vx: p.facing * 480,
              vy: 0,
              w: 14,
              h: 8,
              life: 1,
              dmg: 8 + this.stats.atk * 0.3,
              fromEnemy: false,
            });
          }
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
      if (pr.homing) {
        // 추적 대상: 적 탄은 플레이어를, 정령 탄은 가장 가까운 적을 쫓는다
        let tx: number | null = null;
        let ty: number | null = null;
        if (pr.fromEnemy) {
          tx = p.x;
          ty = p.y - 24;
        } else if (pr.spirit) {
          const t = this.nearestEnemyTo(pr.x, pr.y, 700);
          if (t) {
            tx = t.x;
            ty = t.y - t.h / 2;
          }
        }
        if (tx !== null && ty !== null) {
          const speed = Math.hypot(pr.vx, pr.vy) || 1;
          const desired = Math.atan2(ty - pr.y, tx - pr.x);
          let cur = Math.atan2(pr.vy, pr.vx);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = pr.homing * dt;
          cur += Math.max(-maxTurn, Math.min(maxTurn, diff));
          pr.vx = Math.cos(cur) * speed;
          pr.vy = Math.sin(cur) * speed;
        }
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

    // hit numbers (위로 떠오르며 사라짐)
    for (const hn of this.hitNumbers) {
      hn.y -= 40 * dt;
      hn.life -= dt;
    }
    this.hitNumbers = this.hitNumbers.filter((hn) => hn.life > 0);

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
    // 방패병은 방어/강타 중(state 1·2)에도 방패를 플레이어 쪽으로 돌리려 하지만,
    // 회전에 시간이 걸린다(turnDelay). 그래서 대시로 등 뒤를 잡으면 그 짧은
    // 순간에는 방어가 뚫리고, 방패병이 돌아서면 다시 막는다.
    if (e.type === "shielder" && (e.state === 1 || e.state === 2)) {
      const want: 1 | -1 = dx >= 0 ? 1 : -1;
      if (want !== e.facing) {
        // 방향이 어긋나면 회전 타이머를 돌린다
        e.turnDelay -= dt;
        if (e.turnDelay <= 0) {
          e.facing = want;
          e.turnDelay = SHIELDER_TURN_DELAY;
        }
      } else {
        e.turnDelay = SHIELDER_TURN_DELAY; // 이미 마주보면 타이머 리셋
      }
    } else {
      e.facing = dx >= 0 ? 1 : -1;
      e.turnDelay = SHIELDER_TURN_DELAY;
    }
    e.ai += dt;
    e.atkCd = Math.max(0, e.atkCd - dt);
    if (e.hurtFlash > 0) e.hurtFlash -= dt;

    // gravity (haste 영향 제외 — 낙하는 일정하게). 비행형은 자체 부양 로직을 쓴다.
    if (e.type !== "flyer") {
      e.vy += GRAVITY * dtRaw;
      e.vy = Math.min(e.vy, MAX_FALL);
    }

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
    } else if (e.type === "shielder") {
      // 방패병: 접근 → 방패를 들고 압박(정면 공격 거의 무효) → 방패 강타
      const dist = Math.abs(dx);
      if (e.state === 0) {
        if (dist > 60) e.vx = e.facing * 80;
        else e.vx *= 0.6;
        // 플레이어가 사거리에 들어오면 즉시 방패를 든다 (쿨다운 짧게)
        if (dist < 160 && e.atkCd <= 0) {
          e.state = 1;
          e.stateTimer = 1.6; // 방패 든 채 압박 (길게 유지)
        }
      } else if (e.state === 1) {
        // 방패를 든 채 플레이어에게 천천히 다가간다 (방패 방향은 고정, 이동만 추적)
        const toward = dx >= 0 ? 1 : -1;
        if (dist > 46) e.vx = toward * 55;
        else e.vx *= 0.6;
        e.stateTimer -= dt;
        // 가까우면 강타로 전환, 아니면 방어를 계속 유지
        if (e.stateTimer <= 0 && dist < 80) {
          e.state = 2;
          e.stateTimer = 0.25; // 강타 예비 동작
          e.vx = 0;
        } else if (e.stateTimer <= 0) {
          e.stateTimer = 0.6; // 아직 멀면 방어 자세 연장
        }
      } else if (e.state === 2) {
        e.vx *= 0.4;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          if (dist < 70 && Math.abs(p.y - e.y) < 60) {
            spawnHitbox(this, {
              x: e.x + (e.facing > 0 ? 0 : -56),
              y: e.y - 42,
              w: 56,
              h: 44,
              dmg: e.dmg,
              life: 0.18,
              fromEnemy: true,
              knockback: 320,
            });
          }
          e.state = 0;
          e.atkCd = 0.5; // 강타 후 짧은 쿨다운 → 방어 사이클 자주
        }
      }
    } else if (e.type === "bomber") {
      // 폭탄병: 빠르게 접근해 자폭. 터지기 전에 처치하지 않으면 큰 광역 피해.
      const dist = Math.abs(dx);
      if (e.state === 0) {
        if (dist > 30) e.vx = e.facing * 200;
        else e.vx *= 0.5;
        if (dist < 90) {
          e.state = 1;
          e.stateTimer = 0.8; // 점화 시간
          e.vx = 0;
        }
      } else if (e.state === 1) {
        e.vx *= 0.5;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          spawnHitbox(this, {
            x: e.x - 70,
            y: e.y - 60,
            w: 140,
            h: 70,
            dmg: e.dmg,
            life: 0.12,
            fromEnemy: true,
            knockback: 380,
          });
          this.shake = Math.max(this.shake, 10);
          e.dead = true;
          e.dying = 0.2;
          e.hp = 0;
        }
      }
    } else if (e.type === "flyer") {
      // 비행형: 공중을 부유하며 급강하 돌진
      const dist = Math.abs(dx);
      if (e.state !== 2) {
        // 부양 고도 = 지면 130px 위(±22). 점프 감소 층에서도 이단 점프
        // (127px) + 공격 히트박스(46px)로 닿는 높이라 근접 대응이 가능하다.
        const desiredY = this.groundY - 130 + Math.sin(e.ai * 1.6 + e.id) * 22;
        e.vy = (desiredY - e.y) * 4;
      }
      if (e.state === 0) {
        if (dist > 70) e.vx = e.facing * 150;
        else e.vx *= 0.8;
        if (e.atkCd <= 0 && dist < 260 && dist > 60) {
          e.state = 1;
          e.stateTimer = 0.35; // 급강하 예비(텔레그래프)
          e.vx *= 0.3;
        }
      } else if (e.state === 1) {
        e.vx *= 0.5;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 2;
          e.stateTimer = 0.6;
          e.vx = e.facing * 60;
        }
      } else if (e.state === 2) {
        e.vy = 520;
        e.stateTimer -= dt;
        if (dist < 36 && Math.abs(p.y - e.y) < 54) {
          spawnHitbox(this, {
            x: e.x - 20,
            y: e.y - 28,
            w: 40,
            h: 30,
            dmg: e.dmg,
            life: 0.12,
            fromEnemy: true,
            knockback: 240,
          });
          e.state = 3;
          e.stateTimer = 0.7;
          e.atkCd = 2.4;
        } else if (e.stateTimer <= 0 || e.onGround) {
          e.state = 3;
          e.stateTimer = 0.7;
          e.atkCd = 2.4;
        }
      } else {
        // 회복 비행: 다시 떠오른다
        e.vx *= 0.7;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) e.state = 0;
      }
    } else if (e.type === "brute") {
      // 거인병: 느린 접근 → 강타(전방 히트박스 + 좌우 충격파)
      const dist = Math.abs(dx);
      if (e.state === 0) {
        if (dist > 70) e.vx = e.facing * 60;
        else e.vx *= 0.5;
        if (dist < 90 && e.atkCd <= 0) {
          e.state = 1;
          e.stateTimer = 0.6; // 강타 예비 동작
          e.vx = 0;
        }
      } else if (e.state === 1) {
        e.vx *= 0.4;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 2;
          e.stateTimer = 0.2;
          spawnHitbox(this, {
            x: e.x - 60,
            y: e.y - 30,
            w: 120,
            h: 34,
            dmg: e.dmg,
            life: 0.16,
            fromEnemy: true,
            knockback: 340,
          });
          this.spawnHazard(e.x + 100, this.groundY, 50, e.dmg * 0.5, 0.25);
          this.spawnHazard(e.x - 100, this.groundY, 50, e.dmg * 0.5, 0.25);
          this.shake = Math.max(this.shake, 9);
        }
      } else {
        e.vx *= 0.6;
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 0;
          e.atkCd = 1.4;
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

  // 지정 좌표에서 가장 가까운 살아있는 적 (range 밖이면 null)
  // 스킬 발동. castingSkill 플래그를 세워 생성되는 히트박스/투사체가
  // 스킬 판정을 받게 하고, '메아리' 유물이 있으면 짧은 뒤 한 번 더 터뜨린다.
  private castSkill(s: SkillDef, isEcho = false) {
    this.castingSkill = true;
    this.echoActive = isEcho;
    try {
      s.cast(this);
    } finally {
      this.castingSkill = false;
      this.echoActive = false;
    }
    if (this.stats.skillEcho && !isEcho) {
      setTimeout(() => {
        if (this.destroyed || this.phase !== "playing") return;
        this.castSkill(s, true);
      }, 400);
    }
  }

  private nearestEnemyTo(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of this.room.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - e.h / 2 - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // 플레이어 기준 가장 가까운 적
  private nearestEnemy(range: number): Enemy | null {
    return this.nearestEnemyTo(this.player.x, this.player.y - this.player.h / 2, range);
  }

  private damageEnemy(e: Enemy, dmg: number, kb: number, facing: number) {
    // 치명타 판정
    let d = dmg;
    let crit = false;
    if (this.stats.critChance > 0 && Math.random() < this.stats.critChance) {
      d *= this.stats.critMul;
      crit = true;
    }
    // 방패병 방어: 방패를 든 상태(state 1·2)이고, 공격이 정면(방패 쪽)에서
    // 오면 거의 무효화한다. 등 뒤에서 맞으면 그대로 관통.
    // facing = 공격자가 미는 방향(오른쪽 공격이면 +1). 방패병이 그 반대쪽을
    // 바라보고 있을 때(공격을 마주볼 때) 방패로 막는다.
    let blocked = false;
    if (
      e.type === "shielder" &&
      (e.state === 1 || e.state === 2) &&
      e.facing === -facing
    ) {
      d *= 0.1; // 90% 감소 — 거의 막아냄
      blocked = true;
      crit = false; // 막힌 공격은 치명타 무효
    }

    if (blocked) {
      // 막힘 연출: 방패 위치에서 푸른 스파크 튀김 + 공격자 넉백 반사
      const sx = e.x + e.facing * (e.w / 2);
      const sy = e.y - e.h * 0.55;
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: sx,
          y: sy,
          vx: -facing * (80 + Math.random() * 160),
          vy: -60 - Math.random() * 140,
          life: 0.35,
          color: i % 2 === 0 ? "#bfe0ff" : "#ffffff",
        });
      }
      // 플레이어를 살짝 밀어내 "튕겨나간" 느낌
      this.player.vx += facing * 120;
      this.shake = Math.max(this.shake, 4);
      e.hp -= d;
      e.hurtFlash = 0.08;
      this.hitNumbers.push({
        x: e.x,
        y: e.y - e.h - 6,
        text: "막힘",
        life: 0.6,
        color: "#bfe0ff",
      });
      // 막았으므로 큰 넉백·띄우기는 생략
      this.emit();
      return;
    }

    e.hp -= d;
    e.hurtFlash = 0.12;
    e.vx += facing * kb;
    e.vy = Math.min(e.vy, -80);
    this.shake = Math.max(this.shake, crit ? 5 : 3);
    this.hitNumbers.push({
      x: e.x + (Math.random() - 0.5) * 16,
      y: e.y - e.h - 6,
      text: Math.round(d).toString(),
      life: 0.7,
      color: crit ? "#ffd54a" : "#ffffff",
    });
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
          : e.type === "brute"
            ? 6
            : e.type === "charger"
              ? 5
              : e.type === "mage"
                ? 5
                : e.type === "shielder"
                  ? 5
                  : e.type === "archer"
                    ? 4
                    : e.type === "flyer"
                      ? 4
                      : e.type === "bomber"
                        ? 4
                        : 3;
      this.earnedSouls += reward;
      this.runSouls += reward;
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
    this.player.iframes = 0.6;
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
    const pool = rollRelics(2, this.relicStacks);
    const choices: RewardChoice[] = pool.map((r) => ({ kind: "relic", relic: r }));
    // 유물을 모두 상한까지 모았으면 빈 슬롯을 영혼 보상으로 채운다.
    // (그래야 후반에도 보상 선택이 의미를 갖는다)
    while (choices.length < 2) {
      const amount = 15 + this.floor * 2 + choices.length * 10;
      choices.push({ kind: "souls", amount });
    }
    choices.push({ kind: "heal" });
    this.rewardChoices = choices;
  }

  chooseReward(idx: number) {
    const c = this.rewardChoices[idx];
    if (!c) return;
    if (c.kind === "relic") {
      c.relic.apply(this);
      this.appliedRelics.push(c.relic);
      this.relicStacks[c.relic.id] = (this.relicStacks[c.relic.id] ?? 0) + 1;
    } else if (c.kind === "souls") {
      this.earnedSouls += c.amount;
      this.runSouls += c.amount;
    } else {
      this.player.hp = Math.min(this.stats.maxHp, this.player.hp + 40);
    }
    this.rewardChoices = [];

    // spawn next room
    const isBoss = this.roomIndex >= this.roomsPerFloor - 1;
    this.room = generateRoom(this.floor, this.roomIndex, isBoss, this.groundY);
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
    this.room = generateRoom(this.floor, 0, false, this.groundY);
    this.player.x = 100;
    this.player.y = this.groundY - 60;
    this.player.vx = 0;
    this.player.vy = 0;
    this.hitboxes = [];
    this.projectiles = [];
    this.hazards = [];
    this.camera.x = 0;
    // 전직 제단 층이면 선택 화면을 먼저 띄운다 (아직 방랑자일 때만)
    // 전직 제단
    // - 6층: 아직 방랑자면 1차 전직 (건너뛰기 가능)
    // - 26층: 1차를 건너뛰어 여전히 방랑자인 경우에만 열림 → 상위 직업
    if (this.playerClass === "wanderer" && CLASS_ALTAR_FLOORS.includes(this.floor)) {
      this.phase = "class_select";
    } else {
      this.phase = "playing";
    }
    this.emit();
  }

  // 전직 선택. class_select 화면에서 호출.
  // 현재 제단에서 선택 가능한 직업 목록
  availableClasses(): ClassId[] {
    if (this.floor >= CLASS_ALTAR_2) return ["warlord", "templar", "reaper"];
    return ["berserker", "guardian", "assassin"];
  }

  // 전직 제단을 그냥 지나친다. 나중에 더 강한 제단이 기다린다.
  skipClassAltar() {
    if (this.phase !== "class_select") return;
    this.phase = "playing";
    this.emit();
  }

  chooseClass(id: ClassId) {
    if (this.phase !== "class_select") return;
    // 해당 제단에서 고를 수 없는 직업이면 무시 (UI 우회 방지)
    if (!this.availableClasses().includes(id)) return;
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
      fireOnHit: 0,
      projectileOnHit: false,
      spirit: 0,
      skillDmgAdd: 0,
      skillCdAdd: 0,
      skillLifesteal: 0,
      skillEcho: false,
      moveAdd: 0,
      dashCdAdd: 0,
      airDmgAdd: 0,
      finisherAdd: 0,
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

    // hit numbers — 피격 데미지 숫자, 위로 떠오르며 페이드아웃
    ctx.font = "bold 13px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    for (const hn of this.hitNumbers) {
      ctx.globalAlpha = Math.max(0, Math.min(1, hn.life * 2));
      ctx.fillStyle = hn.color;
      ctx.fillText(hn.text, hn.x, hn.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

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

    // projectiles — 정령 탄은 청록 발광, 아군은 흰색, 마법사 탄은 테마색
    for (const pr of this.projectiles) {
      if (pr.spirit) {
        // 정령 탄: 푸른 코어 + 옅은 후광
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#8fe3ff";
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.w, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#e8fbff";
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (!pr.fromEnemy) {
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

      const flashing = e.hurtFlash > 0;
      // 상태별 공격 예고 점멸 — 돌격병 돌진, 폭탄병 점화, 비행형 급강하
      const telegraph =
        (e.type === "charger" && e.state === 1 && Math.floor(e.ai * 20) % 2 === 0) ||
        (e.type === "bomber" && e.state === 1 && Math.floor(e.ai * 24) % 2 === 0) ||
        (e.type === "flyer" && e.state === 1 && Math.floor(e.ai * 20) % 2 === 0) ||
        (e.type === "brute" && e.state === 1 && Math.floor(e.ai * 16) % 2 === 0);

      // 스프라이트 결정 (보스 → 종류별, 일반 → 타입별)
      const setName =
        e.type === "boss"
          ? e.bossKind
            ? BOSS_SPRITE[e.bossKind]
            : undefined
          : ENEMY_SPRITE[e.type];
      const eset = setName ? loadSpriteSet(setName) : null;

      if (eset && eset.loaded) {
        // 상태에 맞는 프레임 선택 (걷기 순환 / 준비 / 발동)
        const fm =
          e.type === "boss"
            ? e.bossKind
              ? BOSS_FRAMES[e.bossKind]
              : undefined
            : ENEMY_FRAMES[e.type];
        let frame = 0;
        if (fm) {
          if (e.state === 1 && fm.ready !== undefined) {
            frame = fm.ready; // 공격 예비 동작
          } else if (e.state === 2 && fm.act !== undefined) {
            frame = fm.act; // 공격 발동
          } else {
            // 이동 중이면 걷기 프레임 순환, 정지면 첫 프레임
            const moving =
              e.type === "flyer" || (Math.abs(e.vx) > 15 && e.onGround);
            frame = moving
              ? fm.walk[Math.floor(e.ai * 6) % fm.walk.length]
              : fm.walk[0];
          }
        }
        const img = eset.frames[frame] ?? eset.frames[0];
        // 보스는 크게, 일반은 히트박스 높이에 맞춰
        const targetH = e.h * (e.type === "boss" ? 1.7 : 1.85);
        const scale = targetH / img.height;
        const dw = img.width * scale;
        const dh = img.height * scale;
        // flyer는 공중 부유체라 중심 정렬, 나머지는 발바닥(하단) 정렬
        const drawTop = e.type === "flyer" ? e.y - e.h / 2 - dh / 2 : e.y - dh;
        // 피격/예고 시 붉은 점멸
        const blink = (flashing || telegraph) && Math.floor(e.ai * 30) % 2 === 0;
        ctx.globalAlpha = alpha * (blink ? 0.4 : 1);
        // 원본이 왼쪽 향하는 세트면 향함 판정을 반대로.
        const facesLeft = setName ? SPRITE_FACES_LEFT.has(setName) : false;
        const drawFlipped = facesLeft ? e.facing > 0 : e.facing < 0;
        ctx.save();
        if (drawFlipped) {
          ctx.translate(e.x, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, -dw / 2, drawTop, dw, dh);
        } else {
          ctx.drawImage(img, e.x - dw / 2, drawTop, dw, dh);
        }
        ctx.restore();
        ctx.globalAlpha = alpha;
      } else {
        // 폴백: 기존 사각형 + 눈
        const baseCol =
          e.type === "charger" ? "#d9b38c"
          : e.type === "mage" ? "#bfa9e6"
          : e.type === "archer" ? "#cfd6c0"
          : e.type === "shielder" ? "#7a8fa6"
          : e.type === "bomber" ? "#e0a25c"
          : e.type === "flyer" ? "#5c6b8a"
          : e.type === "brute" ? "#8a5a4a"
          : e.type === "boss" ? (e.bossKind ? BOSS_INFO[e.bossKind].color : "#f0f0f0")
          : "#e9e9e9";
        ctx.fillStyle = flashing || telegraph ? "#e94b3c" : baseCol;
        ctx.fillRect(e.x - e.w / 2, e.y - e.h, e.w, e.h);
        ctx.fillStyle = "#141414";
        ctx.fillRect(e.facing > 0 ? e.x + 2 : e.x - 10, e.y - e.h + 12, 8, 3);
      }

      // 방패병: 방패를 든 동안 정면에 방패 표시 (스프라이트 위에 덧그림)
      if (e.type === "shielder" && (e.state === 1 || e.state === 2)) {
        const sx = e.facing > 0 ? e.x + e.w / 2 - 1 : e.x - e.w / 2 - 5;
        const sy = e.y - e.h + 2;
        const sh = e.h - 6;
        // 방패 본체 (푸른 금속판)
        ctx.fillStyle = "rgba(160,195,255,0.85)";
        ctx.fillRect(sx, sy, 7, sh);
        // 방어 광채 (은은한 외곽)
        ctx.strokeStyle = "rgba(200,225,255,0.7)";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx - 1, sy - 1, 9, sh + 2);
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
      const facesLeft = spriteName ? SPRITE_FACES_LEFT.has(spriteName) : false;
      const drawFlipped = facesLeft ? p.facing > 0 : p.facing < 0;
      ctx.save();
      if (drawFlipped) {
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

    // 수호 정령 — 스택 수만큼 플레이어 주위를 공전하는 빛 구슬
    if (this.stats.spirit > 0) {
      const n = this.stats.spirit;
      const interval = Math.max(2, 10 - (n - 1) * 2);
      // 발사 임박(마지막 0.6초)하면 밝아진다
      const charge = 1 - Math.min(1, this.spiritCd / Math.min(0.6, interval));
      for (let i = 0; i < n; i++) {
        const ang = this.animClock * 1.6 + (i / n) * Math.PI * 2;
        const ox = p.x + Math.cos(ang) * 34;
        const oy = p.y - p.h * 0.6 + Math.sin(ang) * 14;
        const r = 3.5 + charge * 2;
        ctx.globalAlpha = 0.25 + charge * 0.35;
        ctx.fillStyle = "#8fe3ff";
        ctx.beginPath();
        ctx.arc(ox, oy, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#e8fbff";
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

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
  wanderer: "wanderer",
  berserker: "berserker",
  assassin: "assassin",
  guardian: "guardian",
  // sorcerer 스프라이트는 향후 최종 전직 구현 시 연결 예정.
};

// 일반 몬스터 타입 → 스프라이트 세트. 매핑 없으면 기존 도형으로 폴백.
const ENEMY_SPRITE: Partial<Record<Enemy["type"], string>> = {
  grunt: "grunt",
  archer: "archer",
  charger: "charger",
  mage: "mage",
  shielder: "shielder",
  bomber: "bomber",
  flyer: "flyer",
  brute: "brute",
};

// 보스 종류 → 스프라이트 세트.
const BOSS_SPRITE: Record<BossKind, string> = {
  warden: "warden",
  plaguelord: "plaguelord",
  stormknight: "stormknight",
  infernal: "infernal",
};

// 원본 스프라이트가 "왼쪽"을 바라보는 세트 목록.
// 게임 기본 향함은 오른쪽이므로, 여기 포함된 세트는 렌더 시 뒤집기 방향을
// 반대로 적용한다. (프레임끼리는 이미 방향 통일됨 — 여기선 세트 전체의
// 절대 방향만 지정.) 게임에서 반대로 걷는 캐릭터가 있으면 이 목록에서
// 넣고/빼면 된다.
const SPRITE_FACES_LEFT = new Set<string>([
  "berserker",
  // 아래는 실제 받은 시트가 왼쪽을 보고 있어 뒤집기 기준을 반대로 잡는다.
  "stormknight",
]);

// 몹별 프레임 용도 매핑.
// 받은 스프라이트 시트는 대체로 [0]=대기, [1~2]=걷기/준비, [3]=공격/특수 구성이라
// 4프레임을 그냥 순환시키면 걷는 중에 공격 포즈가 섞인다. 그래서 상태별로
// 쓸 프레임을 따로 지정한다.
//   walk  : 이동 중 순환할 프레임 목록
//   ready : 공격 준비(텔레그래프) 상태에서 쓸 프레임
//   act   : 공격 발동 순간에 쓸 프레임
type FrameMap = { walk: number[]; ready?: number; act?: number };
const ENEMY_FRAMES: Partial<Record<Enemy["type"], FrameMap>> = {
  grunt: { walk: [0, 1, 2, 3] }, // 4프레임 모두 걷기 사이클
  shielder: { walk: [0, 1, 2, 3], ready: 2, act: 3 },
  charger: { walk: [0, 1], ready: 2, act: 3 }, // 3=돌진 자세
  archer: { walk: [0, 1], ready: 1, act: 2 }, // 2=활 당김, 3=발사 직후
  bomber: { walk: [0, 1, 2], ready: 3, act: 3 }, // 3=점화/자폭
  flyer: { walk: [0, 1, 2], ready: 2, act: 3 }, // 3=급강하
  mage: { walk: [0, 1], ready: 1, act: 2 }, // 2=시전
  brute: { walk: [0, 1], ready: 2, act: 3 }, // 2=치켜듦, 3=내려침
};

// 보스는 [0]=대기, [1~2]=이동/공격, [3]=필살기 구성
const BOSS_FRAMES: Record<BossKind, FrameMap> = {
  warden: { walk: [0, 1, 2], ready: 2, act: 3 },
  plaguelord: { walk: [0, 1], ready: 1, act: 2 },
  stormknight: { walk: [0, 1, 2], ready: 2, act: 3 },
  infernal: { walk: [0, 1, 2], ready: 2, act: 3 },
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
  const all = [
    ...Object.values(CLASS_SPRITE),
    ...Object.values(ENEMY_SPRITE),
    ...Object.values(BOSS_SPRITE),
  ];
  for (const name of all) {
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
