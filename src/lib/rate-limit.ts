/**
 * Rate limiting en memoria (ventana fija por clave).
 * No necesita Redis: alcanza para un VPS con un proceso web. Si se corren varias
 * instancias con PM2 en modo cluster, cada una lleva su propio conteo (el límite
 * efectivo se multiplica por la cantidad de instancias); el proxy inverso suma una
 * segunda capa con limit_req (ver deploy/nginx.conf).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

const MAX_KEYS = 50_000;

export class MemoryRateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, limit: number, windowMs: number): RateLimitResult {
    const t = this.now();
    this.sweep(t);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    const ok = bucket.count <= limit;
    return { ok, remaining: Math.max(0, limit - bucket.count), retryAfterMs: ok ? 0 : bucket.resetAt - t };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(t: number): void {
    if (t - this.lastSweep < 60_000 && this.buckets.size < MAX_KEYS) return;
    this.lastSweep = t;
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
    if (this.buckets.size >= MAX_KEYS) {
      // Protección de memoria: descarta las claves más viejas.
      let toDrop = this.buckets.size - Math.floor(MAX_KEYS * 0.9);
      for (const k of this.buckets.keys()) {
        if (toDrop-- <= 0) break;
        this.buckets.delete(k);
      }
    }
  }
}

const globalForLimiter = globalThis as unknown as { __pedilaLimiter?: MemoryRateLimiter };
export const rateLimiter = (globalForLimiter.__pedilaLimiter ??= new MemoryRateLimiter());

/** Límites usados en la app (por minuto salvo indicación). */
export const LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  join: { limit: 30, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 10 * 60_000 },
  webhook: { limit: 300, windowMs: 60_000 },
  progress: { limit: 120, windowMs: 60_000 },
  mutation: { limit: 60, windowMs: 60_000 },
  export: { limit: 20, windowMs: 60_000 },
} as const;
