import { useEffect, useRef, useState } from "react";
import {
  Game,
  loadPerm,
  permCost,
  savePerm,
  upgradePerm,
  PERM_MAX,
  type PermStats,
  type UpgradeChoice,
  WEAPONS,
  themeForFloor,
} from "@/lib/game/tower";

type WeaponView = { id: string; name: string; level: number };

type Snapshot = {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  time: number;
  kills: number;
  souls: number;
  tier: number;
  zoneName: string;
  phase: string;
  weapons: WeaponView[];
  upgrades: UpgradeChoice[];
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

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
    const snapshot = (): Snapshot => ({
      hp: Math.max(0, Math.round(g.player.hp)),
      maxHp: Math.round(g.stats.maxHp),
      level: g.level,
      xp: g.xp,
      xpNext: g.xpNext,
      time: g.time,
      kills: g.kills,
      souls: g.runSouls,
      tier: g.floor,
      zoneName: themeForFloor(g.floor).name,
      phase: g.phase,
      weapons: g.weapons.map((w) => ({
        id: w.id,
        name: WEAPONS[w.id].name,
        level: w.level,
      })),
      upgrades: g.upgradeChoices,
    });
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
        {snap?.phase === "levelup" && (
          <LevelUpOverlay
            snap={snap}
            onChoose={(i) => gameRef.current?.chooseUpgrade(i)}
          />
        )}
        {snap?.phase === "dead" && (
          <EndOverlay
            title="사망"
            subtitle={`${fmtTime(snap.time)} 생존 · 처치 ${snap.kills} · 영혼 ${snap.souls} 획득 (로비 저장됨)`}
            primaryLabel="로비로"
            onPrimary={() => {
              setPerm(loadPerm());
              setScene("lobby");
            }}
          />
        )}
        <ControlsHint />
      </div>
    </div>
  );
}

function HUD({ snap }: { snap: Snapshot | null }) {
  if (!snap) return null;
  const hpPct = Math.max(0, Math.min(1, snap.hp / snap.maxHp));
  const xpPct = Math.max(0, Math.min(1, snap.xp / snap.xpNext));
  return (
    <div className="border-b border-border bg-card font-mono-tight text-xs">
      {/* XP 바 (상단 전체 폭) */}
      <div className="h-1.5 w-full bg-secondary">
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${xpPct * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">HP</span>
            <div className="h-2 w-36 overflow-hidden rounded-sm bg-secondary">
              <div
                className="h-full bg-[#e94b3c] transition-[width] duration-100"
                style={{ width: `${hpPct * 100}%` }}
              />
            </div>
            <span>{snap.hp}/{snap.maxHp}</span>
          </div>
          <div className="text-muted-foreground">
            Lv <span className="text-foreground font-semibold">{snap.level}</span>
          </div>
        </div>

        <div className="flex items-center gap-5 text-muted-foreground">
          <div className="text-foreground text-sm font-semibold tabular-nums">
            {fmtTime(snap.time)}
          </div>
          <div>
            T{snap.tier}
            <span className="ml-1 text-[10px] uppercase tracking-widest">
              {snap.zoneName}
            </span>
          </div>
          <div>
            처치 <span className="text-foreground">{snap.kills}</span>
          </div>
          <div>
            영혼 <span className="text-foreground">{snap.souls}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {snap.weapons.map((w) => (
            <div
              key={w.id}
              className="flex h-9 min-w-[54px] flex-col items-center justify-center rounded-sm border border-border bg-secondary px-1 text-center"
              title={w.name}
            >
              <div className="text-[10px] leading-tight">{w.name.slice(0, 5)}</div>
              <div className="text-[10px] text-accent">Lv{w.level}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function upgradeView(u: UpgradeChoice): {
  tag: string;
  title: string;
  desc: string;
  color: string;
} {
  if (u.kind === "weapon_new") {
    const d = WEAPONS[u.id];
    return { tag: "새 무기", title: d.name, desc: d.desc, color: "#ffd54a" };
  }
  if (u.kind === "weapon_up") {
    const d = WEAPONS[u.id];
    return {
      tag: "무기 강화",
      title: `${d.name} Lv ${u.level + 1}`,
      desc: d.levelText(u.level + 1),
      color: "#8fb4ff",
    };
  }
  if (u.kind === "passive") {
    return { tag: "패시브", title: u.passive.name, desc: u.passive.desc, color: "#8fe3a2" };
  }
  return { tag: "회복", title: "긴급 회복", desc: "HP 40 회복", color: "#f5f5f5" };
}

function LevelUpOverlay({
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
          <div className="font-mono-tight text-xs tracking-[0.3em] text-accent">
            LEVEL {snap.level}
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">강화를 선택하라</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {snap.upgrades.map((u, i) => {
            const v = upgradeView(u);
            return (
              <button
                key={i}
                onClick={() => onChoose(i)}
                className="group relative flex h-28 flex-col items-start justify-between rounded-sm border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-secondary"
                style={{ borderColor: v.color + "44" }}
              >
                <div className="flex w-full items-baseline justify-between">
                  <div className="text-lg font-semibold tracking-tight">{v.title}</div>
                  <div
                    className="font-mono-tight text-[10px] tracking-widest"
                    style={{ color: v.color }}
                  >
                    {v.tag}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{v.desc}</p>
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
          SURVIVORS
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
      WASD/방향키 이동 · SHIFT 대시 · 공격은 자동
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
    { key: "strength", name: "근력", desc: "레벨당 무기 피해 계수 +2" },
    { key: "agility", name: "민첩", desc: "레벨당 이동속도 +2%, 대시 쿨 -3%" },
    { key: "vitality", name: "체력", desc: "레벨당 최대 HP +8" },
  ];
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <header className="flex items-baseline justify-between border-b border-border pb-6">
          <div>
            <div className="font-mono-tight text-xs tracking-[0.4em] text-muted-foreground">
              THE TOWER · 생존
            </div>
            <h1 className="mt-1 text-6xl font-black leading-none tracking-tighter">탑</h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              끝없이 몰려오는 적들 속에서 살아남아라. 무기는 자동으로 발동된다 —
              너는 오직 움직이며 젬을 모으고, 레벨업으로 강함을 조립할 뿐이다.
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
                            "h-1.5 flex-1 " + (i < lvl ? "bg-accent" : "bg-secondary")
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
              조작: <span className="font-mono-tight">WASD/방향키 이동 · SHIFT 대시</span>
              <div className="mt-1">
                공격은 전부 자동. 적 처치 → 젬 획득 → 레벨업으로 무기·패시브를 강화하라.
              </div>
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
                생존 시작 →
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
