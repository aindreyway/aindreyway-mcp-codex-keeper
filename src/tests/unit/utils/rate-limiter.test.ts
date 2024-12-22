import { RateLimiter, DEFAULT_RATE_LIMIT_CONFIG } from '../../../utils/rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxTokens: 3,
      tokensPerInterval: 1,
      interval: 1000, // 1 second
    });
  });

  describe('Basic Rate Limiting', () => {
    it('should allow requests within limit', () => {
      const clientId = 'test-client';

      // Should allow first 3 requests (maxTokens)
      for (let i = 0; i < 3; i++) {
        const result = rateLimiter.checkLimit(clientId);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2 - i);
      }

      // Should deny 4th request
      const result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('should refill tokens over time', async () => {
      const clientId = 'test-client';

      // Use all tokens
      for (let i = 0; i < 3; i++) {
        rateLimiter.checkLimit(clientId);
      }

      // Wait for 1 token to be refilled
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });
  });

  describe('Burst Handling', () => {
    it('should handle burst requests', () => {
      const clientId = 'test-client';

      // Should allow burst of maxTokens requests
      const results = Array(3)
        .fill(null)
        .map(() => rateLimiter.checkLimit(clientId));

      expect(results.every(r => r.allowed)).toBe(true);
      expect(results[results.length - 1].remaining).toBe(0);
    });

    it('should recover from burst gradually', async () => {
      const clientId = 'test-client';

      // Use all tokens in burst
      Array(3)
        .fill(null)
        .forEach(() => rateLimiter.checkLimit(clientId));

      // Wait for partial recovery
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should have recovered 1 token
      const result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(true);

      // Next request should be denied
      const nextResult = rateLimiter.checkLimit(clientId);
      expect(nextResult.allowed).toBe(false);
    });
  });

  describe('Multiple Clients', () => {
    it('should track limits separately for different clients', () => {
      const client1 = 'client-1';
      const client2 = 'client-2';

      // Use some tokens from client1
      rateLimiter.checkLimit(client1);
      rateLimiter.checkLimit(client1);

      // Client2 should still have full tokens
      const result = rateLimiter.checkLimit(client2);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });
  });

  describe('Cleanup', () => {
    it('should remove old buckets', async () => {
      const clientId = 'test-client';

      // Create bucket for client
      rateLimiter.checkLimit(clientId);

      // Wait for bucket to age
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clean up buckets older than 50ms
      rateLimiter.cleanup(50);

      // Bucket should be removed
      expect(rateLimiter.getStatus(clientId)).toBeUndefined();
    });

    it('should keep active buckets', () => {
      const clientId = 'test-client';

      // Create bucket for client
      rateLimiter.checkLimit(clientId);

      // Clean up with large maxAge
      rateLimiter.cleanup(10000);

      // Bucket should still exist
      expect(rateLimiter.getStatus(clientId)).toBeDefined();
    });
  });

  describe('Reset', () => {
    it('should reset limits for a client', () => {
      const clientId = 'test-client';

      // Use some tokens
      rateLimiter.checkLimit(clientId);
      rateLimiter.checkLimit(clientId);

      // Reset client
      rateLimiter.reset(clientId);

      // Should have full tokens again
      const result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });
  });

  describe('Default Configuration', () => {
    it('should use default config values', () => {
      const limiter = new RateLimiter(DEFAULT_RATE_LIMIT_CONFIG);
      const clientId = 'test-client';

      // Should allow first request
      const result = limiter.checkLimit(clientId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(DEFAULT_RATE_LIMIT_CONFIG.maxTokens - 1);
    });
  });
});
