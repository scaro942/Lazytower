import { useEffect, useRef, useState } from "react";
import {
  Game,
  loadPerm,
  permCost,
  savePerm,
  upgradePerm,
  PERM_MAX,
  type PermStats,
  type RewardChoice,
  SKILLS,
  FLOOR_RULES,
  MAX_FLOOR,
  themeForFloor,
  CLASSES,
  type ClassId,
} from "@/lib/game/tower";

type Snapshot = {
  hp: number;
  maxHp: number;
  atk: number;
  floor: number;
  roomIndex: number;
  roomsPerFloor: number;
  souls: number;
  cleared: boolean;
  doorOpen: boolean;
  skillCd: [number, number, number];
  phase: string;
  rewards: RewardChoice[];
  ruleName?: string;
  ruleDesc?: string;
  zoneName?: string;
  className?: string;
  classColor?: string;
  loadout: [string, string, string];
  killHaste: boolean;
};

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

export function TowerGame() {
  const hydrated = useHydrated();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [scene, setScene] = useState<"lobby" | "run">("lobby");
  const [perm, setPerm] = useState<PermStats>(() => loadPerm());
  const [snap, setSnap] = useState<Snapshot | null>(null);

  // canvas sizing
  useEffect(() => {
    if (scene !== "run") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    const g = new Game(canvas, perm);
    gameRef.current = g;
    const snapshot = (): Snapshot => {
      const rule = FLOOR_RULES[g.floor];
      return {
        hp: Math.max(0, Math.round(g.player.hp)),
        maxHp: Math.round(g.stats.maxHp),
        atk: Math.round(g.stats.atk),
        floor: g.floor,
        roomIndex: g.roomIndex,
        roomsPerFloor: g.roomsPerFloor,
        souls: g.runSouls,
        cleared: g.room.cleared,
        doorOpen: g.room.doorOpen,
        skillCd: [...g.player.skillCd] as [number, number, number],
        phase: g.phase,
        rewards: g.rewardChoices,
        ruleName: rule?.name,
        ruleDesc: rule?.desc,
        zoneName: themeForFloor(g.floor).name,
        className: CLASSES[g.playerClass].name,
        classColor: CLASSES[g.playerClass].color,
        loadout: [...g.skillLoadout] as [string, string, string],
        killHaste: g.killHasteTimer > 0,
      };
    };
    setSnap(snapshot());
    let raf = 0;
    const tick = () => {
      setSnap(snapshot());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    g.onStateChange = () => setSnap(snapshot());
    g.onSoulsEarned = () => setPerm(loadPerm());

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      g.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  if (!hydrated) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="font-mono-tight text-sm text-muted-foreground">LOADING…</div>
      </div>
    );
  }

  if (scene === "lobby") {
    return (
      <Lobby
        perm={perm}
        onUpgrade={(k) => setPerm(upgradePerm(perm, k))}
        onReset={() => {
          const cleared = { ...perm, souls: 0, strength: 0, agility: 0, vitality: 0 };
          savePerm(cleared);
          setPerm(cleared);
        }}
        onStart={() => setScene("run")}
      />
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <HUD snap={snap} />
      <div className="relative flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="block h-full w-full bg-background" />
        {snap?.phase === "reward" && (
          <RewardOverlay
            snap={snap}
            onChoose={(i) => gameRef.current?.chooseReward(i)}
          />
        )}
        {snap?.phase === "class_select" && (
          <ClassSelectOverlay
            floor={snap.floor}
            onChoose={(id) => gameRef.current?.chooseClass(id)}
          />
        )}
        {snap?.phase === "dead" && (
          <EndOverlay
            title="사망"
            subtitle={`획득한 영혼 ${snap.souls}이(가) 로비에 저장되었다.`}
            primaryLabel="로비로"
            onPrimary={() => {
              setPerm(loadPerm());
              setScene("lobby");
            }}
          />
        )}
        {snap?.phase === "victory" && (
          <EndOverlay
            title={`탑 정복 · ${MAX_FLOOR}층`}
            subtitle={`최상층을 정복했다. 영혼 ${snap.souls} 획득. 당신은 탑의 주인이 되었다.`}
            primaryLabel="로비로"
            onPrimary={() => {
              setPerm(loadPerm());
              setScene("lobby");
            }}
          />
        )}
        {snap?.phase === "cleared_floor" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/85 backdrop-blur-sm">
            <div className="flex w-full max-w-md flex-col items-center px-6 text-center">
              <div className="font-mono-tight text-xs tracking-[0.3em] text-muted-foreground">
                FLOOR {snap.floor} CLEAR
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                {snap.floor}층 돌파
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                영혼 {snap.souls}이(가) 로비에 안전하게 저장되었다.
                <br />
                다음은 {snap.floor + 1}층 — 더 강한 적이 기다린다.
              </p>
              {themeForFloor(snap.floor + 1).name !==
                themeForFloor(snap.floor).name && (
                <div className="mt-3 rounded-sm border border-accent/40 px-3 py-1.5 font-mono-tight text-xs tracking-widest text-accent">
                  새 구간 진입 · {themeForFloor(snap.floor + 1).name}
                </div>
              )}
              <button
                onClick={() => gameRef.current?.ackNextFloor()}
                className="mt-6 rounded-sm border border-border bg-card px-8 py-3 font-mono-tight text-sm tracking-widest text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {snap.floor + 1}층으로 →
              </button>
            </div>
          </div>
        )}
        {snap && snap.cleared && snap.roomIndex >= snap.roomsPerFloor - 1 &&
          snap.phase === "playing" && snap.doorOpen &&
          gameRef.current?.room.isBoss && (
            <div className="absolute inset-x-0 bottom-8 flex justify-center">
              <button
                onClick={() => gameRef.current?.ackFloorClear()}
                className="rounded-sm border border-border bg-card px-6 py-3 font-mono-tight text-sm tracking-widest text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                층 클리어 →
              </button>
            </div>
          )}
        <ControlsHint />
      </div>
    </div>
  );
}

function HUD({ snap }: { snap: Snapshot | null }) {
  if (!snap) return null;
  const hpPct = Math.max(0, Math.min(1, snap.hp / snap.maxHp));
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2 font-mono-tight text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">HP</span>
          <div className="h-2 w-40 overflow-hidden rounded-sm bg-secondary">
            <div
              className="h-full bg-accent transition-[width] duration-100"
              style={{ width: `${hpPct * 100}%` }}
            />
          </div>
          <span>{snap.hp}/{snap.maxHp}</span>
        </div>
        <div className="text-muted-foreground">
          ATK <span className="text-foreground">{snap.atk}</span>
        </div>
      </div>
      <div className="flex items-center gap-6 text-muted-foreground">
        <div>
          <span className="text-foreground text-sm font-semibold">FLOOR {snap.floor}</span>
          {snap.zoneName && (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              {snap.zoneName}
            </span>
          )}
          <span className="ml-2">
            방 {Math.min(snap.roomIndex + 1, snap.roomsPerFloor)}/{snap.roomsPerFloor}
          </span>
        </div>
        {snap.ruleName && (
          <div className="rounded-sm border border-accent/40 px-2 py-0.5 text-accent">
            {snap.ruleName} · {snap.ruleDesc}
          </div>
        )}
        {snap.className && (
          <div
            className="rounded-sm border px-2 py-0.5"
            style={{ borderColor: (snap.classColor ?? "#888") + "66", color: snap.classColor }}
          >
            {snap.className}
            {snap.killHaste && <span className="ml-1 text-accent">▲가속</span>}
          </div>
        )}
        <div>
          영혼 <span className="text-foreground">{snap.souls}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {(["K", "L", "I"] as const).map((label, i) => {
          const skill = SKILLS[snap.loadout[i]];
          const cd = snap.skillCd[i];
          const ready = cd <= 0.02;
          return (
            <div
              key={label}
              className={
                "flex h-10 w-14 flex-col items-center justify-center rounded-sm border text-center " +
                (ready
                  ? "border-border bg-secondary text-foreground"
                  : "border-border/40 bg-secondary/40 text-muted-foreground")
              }
              title={skill?.name}
            >
              <div className="text-[10px] tracking-widest">{label}</div>
              <div className="text-[10px]">
                {ready ? skill?.name.slice(0, 4) : cd.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClassSelectOverlay({
  floor,
  onChoose,
}: {
  floor: number;
  onChoose: (id: ClassId) => void;
}) {
  const options: ClassId[] = ["berserker", "guardian", "assassin"];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="w-full max-w-3xl px-6">
        <div className="mb-6 text-center">
          <div className="font-mono-tight text-xs tracking-[0.3em] text-muted-foreground">
            전직 제단 · FLOOR {floor}
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">직업을 선택하라</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            이번 등반의 정체성을 결정한다. 스킬과 능력치가 바뀐다.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {options.map((id) => {
            const c = CLASSES[id];
            return (
              <button
                key={id}
                onClick={() => onChoose(id)}
                className="group relative flex h-56 flex-col items-start justify-between rounded-sm border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-secondary"
                style={{ borderColor: c.color + "44" }}
              >
                <div>
                  <div
                    className="font-mono-tight text-[10px] tracking-widest"
                    style={{ color: c.color }}
                  >
                    CLASS
                  </div>
                  <div className="mt-1 text-lg font-semibold tracking-tight">
                    {c.name}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{c.desc}</p>
                </div>
                <div className="font-mono-tight text-[10px] tracking-widest text-muted-foreground">
                  스킬 {c.loadout.map((s) => SKILLS[s]?.name).join(" · ")}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RewardOverlay({
  snap,
  onChoose,
}: {
  snap: Snapshot;
  onChoose: (i: number) => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <div className="w-full max-w-3xl px-6">
        <div className="mb-6 text-center">
          <div className="font-mono-tight text-xs tracking-[0.3em] text-muted-foreground">
            REWARD · FLOOR {snap.floor}
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">보상을 선택하라</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {snap.rewards.map((r, i) => {
            const title = r.kind === "relic" ? r.relic.name : "완전 회복";
            const desc =
              r.kind === "relic" ? r.relic.desc : "HP 40 회복. 위험한 층 전에 안전 선택.";
            const tag = r.kind === "relic" ? "유물" : "회복";
            return (
              <button
                key={i}
                onClick={() => onChoose(i)}
                className="group relative flex h-48 flex-col items-start justify-between rounded-sm border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-secondary"
              >
                <div>
                  <div className="font-mono-tight text-[10px] tracking-widest text-muted-foreground group-hover:text-accent">
                    {tag}
                  </div>
                  <div className="mt-1 text-lg font-semibold tracking-tight">{title}</div>
                </div>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EndOverlay({
  title,
  subtitle,
  primaryLabel,
  onPrimary,
}: {
  title: string;
  subtitle: string;
  primaryLabel: string;
  onPrimary: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur">
      <div className="max-w-md text-center">
        <div className="font-mono-tight text-xs tracking-[0.4em] text-muted-foreground">
          THE TOWER
        </div>
        <h1 className="mt-2 text-5xl font-black tracking-tighter">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>
        <button
          onClick={onPrimary}
          className="mt-8 rounded-sm border border-border bg-primary px-6 py-3 font-mono-tight text-sm tracking-widest text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

function ControlsHint() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 font-mono-tight text-[10px] tracking-widest text-muted-foreground opacity-70">
      A/D 이동 · SPACE 점프(2단) · SHIFT 대시 · J 공격 · K/L 스킬 · I 궁극기 · E 문
    </div>
  );
}

function Lobby({
  perm,
  onUpgrade,
  onReset,
  onStart,
}: {
  perm: PermStats;
  onUpgrade: (k: "strength" | "agility" | "vitality") => void;
  onReset: () => void;
  onStart: () => void;
}) {
  const rows: {
    key: "strength" | "agility" | "vitality";
    name: string;
    desc: string;
  }[] = [
    { key: "strength", name: "근력", desc: "레벨당 공격력 +2" },
    { key: "agility", name: "민첩", desc: "레벨당 이동속도 +2%, 대시 쿨 -3%" },
    { key: "vitality", name: "체력", desc: "레벨당 최대 HP +8" },
  ];
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <header className="flex items-baseline justify-between border-b border-border pb-6">
          <div>
            <div className="font-mono-tight text-xs tracking-[0.4em] text-muted-foreground">
              THE TOWER · 로비
            </div>
            <h1 className="mt-1 text-6xl font-black leading-none tracking-tighter">탑</h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              탑은 살아있다. 매 등반은 새로운 형태로 너를 시험한다.
              유물과 스킬로 이번 판의 강함을 조립하라 — 영구 성장은 길을 열 뿐이다.
            </p>
          </div>
          <div className="text-right font-mono-tight">
            <div className="text-xs tracking-widest text-muted-foreground">영혼</div>
            <div className="text-3xl font-bold text-accent">{perm.souls}</div>
          </div>
        </header>

        <section className="mt-8">
          <div className="mb-3 font-mono-tight text-xs tracking-[0.3em] text-muted-foreground">
            영구 성장 · 상한 {PERM_MAX}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {rows.map((r) => {
              const lvl = perm[r.key];
              const cost = permCost(perm, r.key);
              const maxed = lvl >= PERM_MAX;
              const canAfford = perm.souls >= cost && !maxed;
              return (
                <div
                  key={r.key}
                  className="flex flex-col justify-between rounded-sm border border-border bg-card p-5"
                >
                  <div>
                    <div className="flex items-baseline justify-between">
                      <div className="text-lg font-semibold tracking-tight">{r.name}</div>
                      <div className="font-mono-tight text-sm text-muted-foreground">
                        {lvl} / {PERM_MAX}
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{r.desc}</p>
                    <div className="mt-4 flex gap-0.5">
                      {Array.from({ length: PERM_MAX }).map((_, i) => (
                        <div
                          key={i}
                          className={
                            "h-1.5 flex-1 " +
                            (i < lvl ? "bg-accent" : "bg-secondary")
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <button
                    disabled={!canAfford}
                    onClick={() => onUpgrade(r.key)}
                    className="mt-5 rounded-sm border border-border bg-secondary px-3 py-2 font-mono-tight text-xs tracking-widest transition-colors enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-40"
                  >
                    {maxed ? "MAXED" : `강화 · ${cost} 영혼`}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-auto pt-10">
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <div className="max-w-md text-xs text-muted-foreground">
              조작: <span className="font-mono-tight">A/D · SPACE · SHIFT · J · K · L · I · E</span>
              <div className="mt-1">1층에는 3개의 방과 보스가 존재한다.</div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onReset}
                className="rounded-sm border border-border bg-card px-4 py-3 font-mono-tight text-xs tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                진행 초기화
              </button>
              <button
                onClick={onStart}
                className="rounded-sm border border-accent bg-accent px-8 py-3 font-mono-tight text-sm font-semibold tracking-widest text-accent-foreground transition-colors hover:brightness-110"
              >
                등반 시작 →
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
