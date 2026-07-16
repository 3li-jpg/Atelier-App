// Shared plan catalog for the Atelier billing foundation.
// This module is intentionally self-contained so sandbox enforcement and VPS
// lifecycle agents can import it without pulling server-side deps.

export interface SandboxTier {
  id: string;
  title: string;
  price: number; // monthly USD
  included_hours: number;
  cpus: number;
  memory_mb: number;
  overage_rate: number; // USD per hour
  overage_mode: "hard_cap" | "meter";
  recommended?: boolean;
}

export interface VpsSize {
  id: string;
  title: string;
  price: number; // monthly USD
  cpus: number;
  memory_mb: number;
  disk_gb: number;
  recommended?: boolean;
}

export const SANDBOX_TIERS: Record<string, SandboxTier> = {
  free: {
    id: "free",
    title: "Free",
    price: 0,
    included_hours: 0,
    cpus: 0,
    memory_mb: 0,
    overage_rate: 0,
    overage_mode: "hard_cap",
  },
  plus: {
    id: "plus",
    title: "Plus",
    price: 6,
    included_hours: 20,
    cpus: 1,
    memory_mb: 2048,
    overage_rate: 0.2,
    overage_mode: "meter",
  },
  pro: {
    id: "pro",
    title: "Pro",
    price: 10,
    included_hours: 40,
    cpus: 2,
    memory_mb: 2048,
    overage_rate: 0.2,
    overage_mode: "meter",
    recommended: true,
  },
  max: {
    id: "max",
    title: "Max",
    price: 25,
    included_hours: 140,
    cpus: 2,
    memory_mb: 4096,
    overage_rate: 0.25,
    overage_mode: "meter",
  },
};

export const VPS_SIZES: Record<string, VpsSize> = {
  small: {
    id: "small",
    title: "Small",
    price: 10,
    cpus: 2,
    memory_mb: 4096,
    disk_gb: 40,
  },
  medium: {
    id: "medium",
    title: "Medium",
    price: 20,
    cpus: 4,
    memory_mb: 8192,
    disk_gb: 80,
    recommended: true,
  },
  large: {
    id: "large",
    title: "Large",
    price: 40,
    cpus: 8,
    memory_mb: 16384,
    disk_gb: 160,
  },
};

export function getTier(id: string): SandboxTier | undefined {
  return SANDBOX_TIERS[id];
}

export function getVpsSize(id: string): VpsSize | undefined {
  return VPS_SIZES[id];
}

// Fly-ish compute cost model used for the safety test.
// $0.0504 per vCPU-hour + $0.0162 per GB-hour.
export function computeCostPerHour(cpus: number, memory_mb: number): number {
  const memory_gb = memory_mb / 1024;
  return cpus * 0.0504 + memory_gb * 0.0162;
}

// Safety self-test: every metered tier's overage rate must exceed its compute cost.
if (import.meta.main) {
  let safe = true;
  for (const [id, tier] of Object.entries(SANDBOX_TIERS)) {
    if (tier.overage_mode !== "meter") continue;
    const cost = computeCostPerHour(tier.cpus, tier.memory_mb);
    const ok = tier.overage_rate > cost;
    console.log(`${id}: cost=${cost.toFixed(3)} overage=${tier.overage_rate} ${ok ? "SAFE" : "UNSAFE"}`);
    if (!ok) safe = false;
  }
  if (!safe) {
    console.error("SAFETY CHECK FAILED");
    process.exit(1);
  }
  console.log("SAFETY OK");
}
