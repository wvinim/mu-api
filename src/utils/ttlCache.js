/**
 * Cache em memória simples com TTL. Aceitável para instância única (mesma
 * decisão do rate limit em memória) — se confirmarmos múltiplas
 * instâncias, precisa virar um cache compartilhado (ex: Redis).
 */
class TtlCache {
  constructor(ttlSeconds) {
    this.ttlMs = ttlSeconds * 1000;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

module.exports = TtlCache;
