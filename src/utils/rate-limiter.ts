/**
 * Rate limiter implementation using token bucket algorithm
 * This provides smooth rate limiting with burst capability
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterConfig {
  maxTokens: number; // Maximum number of tokens (burst capacity)
  tokensPerInterval: number; // Number of tokens added per interval
  interval: number; // Interval in milliseconds
}

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // Time in ms until next token is available
  remaining: number; // Remaining tokens
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket>;
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.buckets = new Map();
    this.config = {
      maxTokens: config.maxTokens || 60,
      tokensPerInterval: config.tokensPerInterval || 10,
      interval: config.interval || 60000, // Default: 1 minute
    };
  }

  /**
   * Check if a request should be allowed
   * @param clientId Unique identifier for the client (e.g., IP address)
   * @returns Rate limit result with allowed status and retry information
   */
  checkLimit(clientId: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    // Create new bucket for new clients
    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(clientId, bucket);
    }

    // Refill tokens based on time elapsed
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(
      (timePassed * this.config.tokensPerInterval) / this.config.interval
    );

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.config.maxTokens);
      bucket.lastRefill = now;
    }

    // Check if request can be allowed
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: bucket.tokens,
      };
    }

    // Calculate retry after time
    const timeUntilNextToken = Math.ceil(
      this.config.interval / this.config.tokensPerInterval -
        (timePassed % (this.config.interval / this.config.tokensPerInterval))
    );

    return {
      allowed: false,
      retryAfter: timeUntilNextToken,
      remaining: 0,
    };
  }

  /**
   * Clean up old buckets to prevent memory leaks
   * @param maxAge Maximum age in milliseconds for buckets to keep
   */
  cleanup(maxAge: number): void {
    const now = Date.now();
    for (const [clientId, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(clientId);
      }
    }
  }

  /**
   * Get current rate limit status for a client
   * @param clientId Client identifier
   * @returns Current token count and last refill time
   */
  getStatus(clientId: string): TokenBucket | undefined {
    return this.buckets.get(clientId);
  }

  /**
   * Reset rate limit for a client
   * @param clientId Client identifier
   */
  reset(clientId: string): void {
    this.buckets.delete(clientId);
  }
}

// Export default configuration
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimiterConfig = {
  maxTokens: 60, // Maximum burst capacity
  tokensPerInterval: 10, // 10 tokens per minute
  interval: 60000, // 1 minute
};
