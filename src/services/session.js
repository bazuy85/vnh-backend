// ============================================================
// Session management — lưu trạng thái hội thoại trong Redis
// Nếu chưa có Redis, tự động dùng bộ nhớ tạm (Map)
// ============================================================
const logger = require('../utils/logger');

// Fallback: lưu trong RAM nếu không có Redis
const memoryStore = new Map();

let redisClient = null;

async function getRedis() {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;

  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => logger.error('Redis error', { err: err.message }));
    await redisClient.connect();
    logger.info('Redis connected');
    return redisClient;
  } catch (err) {
    logger.warn('Redis unavailable, using memory store', { error: err.message });
    return null;
  }
}

// Key format: session:{zaloId}
const KEY = (zaloId) => `session:${zaloId}`;
const TTL = 60 * 60 * 2; // 2 giờ (giây)

// Lấy session của 1 user
async function getSession(zaloId) {
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(KEY(zaloId));
    return raw ? JSON.parse(raw) : null;
  }
  return memoryStore.get(KEY(zaloId)) || null;
}

// Lưu/cập nhật session
async function setSession(zaloId, data) {
  const session = { ...data, updatedAt: Date.now() };
  const redis = await getRedis();
  if (redis) {
    await redis.setEx(KEY(zaloId), TTL, JSON.stringify(session));
  } else {
    memoryStore.set(KEY(zaloId), session);
    // Tự dọn sau 2 giờ
    setTimeout(() => memoryStore.delete(KEY(zaloId)), TTL * 1000);
  }
  return session;
}

// Xóa session (khi hoàn thành flow)
async function clearSession(zaloId) {
  const redis = await getRedis();
  if (redis) {
    await redis.del(KEY(zaloId));
  } else {
    memoryStore.delete(KEY(zaloId));
  }
}

// Cập nhật 1 trường trong session (tiện lợi hơn setSession)
async function updateSession(zaloId, patch) {
  const current = await getSession(zaloId) || {};
  return setSession(zaloId, { ...current, ...patch });
}

module.exports = { getSession, setSession, clearSession, updateSession };
