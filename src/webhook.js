// ============================================================
// Zalo OA Webhook Handler
// ============================================================
// Zalo gửi event đến endpoint này mỗi khi:
//   - User follow/unfollow OA
//   - User gửi tin nhắn
//   - User bấm nút (payload)
// ============================================================
const express = require('express');
const crypto = require('crypto');
const { handleUserMessage } = require('./flows/user-onboarding');
const { handleShopMessage } = require('./flows/shop-onboarding');
const supabase = require('./db/supabase');
const logger = require('./utils/logger');
const { sendText } = require('./services/zalo');

const router = express.Router();

// ============================================================
// Zalo webhook verification (GET) — Zalo gọi 1 lần khi setup
// ============================================================
router.get('/', (req, res) => {
  const { challenge } = req.query;
  if (challenge) {
    logger.info('Zalo webhook verified');
    return res.json({ data: { challenge } });
  }
  res.send('Việc Nhà Hàng webhook OK');
});

// ============================================================
// Nhận event từ Zalo (POST)
// ============================================================
router.post('/', async (req, res) => {
  // Trả 200 ngay để Zalo không retry
  res.sendStatus(200);

  try {
    const event = req.body;
    logger.debug('Webhook event received', { eventName: event.event_name, app_id: event.app_id });

    // Xác thực chữ ký (MAC) từ Zalo
    if (!verifyZaloSignature(req)) {
      logger.warn('Invalid Zalo signature', { headers: req.headers });
      return;
    }

    const eventName = event.event_name;

    // --- User follow OA ---
    if (eventName === 'follow') {
      await handleFollow(event);
      return;
    }

    // --- User unfollow OA ---
    if (eventName === 'unfollow') {
      await handleUnfollow(event);
      return;
    }

    // --- User gửi tin nhắn văn bản ---
    if (eventName === 'user_send_text') {
      await handleIncomingMessage(event);
      return;
    }

    // --- User bấm nút (button payload) ---
    if (eventName === 'user_send_image' || eventName === 'oa_chatbot') {
      // Nếu là payload từ nút
      if (event.message?.msg_type === 'query_show') {
        await handleIncomingMessage({
          ...event,
          message: { text: event.message.payload }
        });
      }
      return;
    }

  } catch (err) {
    logger.error('Webhook handler error', { error: err.message, stack: err.stack });
  }
});

// ============================================================
// Xác thực chữ ký Zalo
// ============================================================
function verifyZaloSignature(req) {
  // Nếu chưa cấu hình webhook secret → bỏ qua (dev mode)
  if (!process.env.ZALO_WEBHOOK_SECRET) {
    logger.warn('ZALO_WEBHOOK_SECRET not set — skipping signature verification (dev mode)');
    return true;
  }

  const receivedMac = req.headers['x-zevent-mac'] || req.headers['mac'];
  if (!receivedMac) return false;

  const body = JSON.stringify(req.body);
  const expectedMac = crypto
    .createHmac('sha256', process.env.ZALO_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(receivedMac, 'hex'),
    Buffer.from(expectedMac, 'hex')
  );
}

// ============================================================
// Xử lý user follow OA
// ============================================================
async function handleFollow(event) {
  const zaloId = event.follower?.id || event.sender?.id;
  const displayName = event.follower?.display_name || '';

  logger.info('New follower', { zaloId, displayName });

  // Hỏi user muốn tìm việc hay đăng tuyển
  await sendText(zaloId,
    `Xin chào ${displayName ? displayName.split(' ').pop() : 'bạn'}! 👋\n\n` +
    `Bạn đến với Việc Nhà Hàng để làm gì?`
  );

  const { sendButtons } = require('./services/zalo');
  await sendButtons(zaloId, 'Chọn 1 trong 2 nhé:', [
    { title: '🔍 Tìm việc F&B', payload: 'intent_find_job' },
    { title: '🏪 Tuyển nhân viên cho quán', payload: 'intent_hire' },
  ]);
}

// ============================================================
// Xử lý user unfollow
// ============================================================
async function handleUnfollow(event) {
  const zaloId = event.follower?.id || event.sender?.id;
  logger.info('User unfollowed', { zaloId });

  // Đánh dấu inactive trong DB
  await supabase.from('users').update({ status: 'inactive' }).eq('zalo_id', zaloId);
  await supabase.from('shops').update({ status: 'inactive' }).eq('zalo_id', zaloId);
}

// ============================================================
// Phân luồng tin nhắn đến
// ============================================================
async function handleIncomingMessage(event) {
  const zaloId = event.sender?.id;
  const text = (event.message?.text || '').trim();
  const displayName = event.sender?.display_name || '';

  if (!zaloId || !text) return;

  logger.info('Incoming message', { zaloId, text: text.substring(0, 50) });

  // Lệnh đặc biệt — override mọi flow
  const lowerText = text.toLowerCase();

  if (lowerText === 'intent_find_job' || lowerText === 'tim viec' || lowerText === 'tìm việc') {
    // Đánh dấu user type = job_seeker
    const { getSession, updateSession } = require('./services/session');
    await updateSession(zaloId, { userType: 'job_seeker' });
    return handleUserMessage(zaloId, 'start', displayName);
  }

  if (lowerText === 'intent_hire' || lowerText === 'tuyen dung' || lowerText === 'tuyển dụng') {
    const { updateSession } = require('./services/session');
    await updateSession(zaloId, { userType: 'shop' });
    return handleShopMessage(zaloId, 'start', displayName);
  }

  // Xác định user type từ session hoặc DB
  const { getSession } = require('./services/session');
  const session = await getSession(zaloId);

  if (session?.userType === 'shop' || session?.flow?.startsWith('shop_')) {
    return handleShopMessage(zaloId, text, displayName);
  }

  if (session?.userType === 'job_seeker' || session?.flow?.startsWith('user_')) {
    return handleUserMessage(zaloId, text, displayName);
  }

  // Chưa xác định → check DB
  const { data: shop } = await supabase
    .from('shops').select('id').eq('zalo_id', zaloId).single();

  if (shop) {
    return handleShopMessage(zaloId, text, displayName);
  }

  const { data: user } = await supabase
    .from('users').select('id').eq('zalo_id', zaloId).single();

  if (user) {
    return handleUserMessage(zaloId, text, displayName);
  }

  // Người lạ → hỏi intent
  const { sendButtons } = require('./services/zalo');
  await sendButtons(zaloId, 'Bạn muốn:', [
    { title: '🔍 Tìm việc F&B', payload: 'intent_find_job' },
    { title: '🏪 Tuyển nhân viên', payload: 'intent_hire' },
  ]);
}

module.exports = router;
