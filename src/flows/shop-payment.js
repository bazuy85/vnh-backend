// ============================================================
// VIỆC NHÀ HÀNG — Shop Payment Flows
// ============================================================
const supabase = require('../db/supabase');
const logger   = require('../utils/logger');
const { createOrder, verifyCallback, PRICES } = require('../services/zalopay');
const { sendText, sendButtons } = require('../services/zalo');

async function initiateJobPostPayment(zaloId, shopId, jobPostId) {
  const order = await createOrder({
    shopId, zaloId,
    orderType: 'post_job',
    refId: jobPostId,
    description: 'Việc Nhà Hàng - Đăng tin tuyển dụng',
  });

  if (!order) {
    await sendText(zaloId, '❌ Có lỗi xảy ra khi tạo thanh toán. Vui lòng thử lại sau.');
    return;
  }

  await supabase
    .from('job_posts')
    .update({ payment_trans_id: order.app_trans_id, payment_status: 'pending' })
    .eq('id', jobPostId);

  const amount = PRICES.post_job.toLocaleString('vi-VN');

  await sendText(zaloId,
    `💳 Thanh toán phí đăng tin\n\nSố tiền: ${amount}đ\nNội dung: Đăng tin tuyển dụng - Việc Nhà Hàng\n\nBấm nút bên dưới để thanh toán qua ZaloPay:`
  );
  await sendButtons(zaloId, 'Thanh toán ngay:', [
    { title: `💳 Thanh toán ${amount}đ`, payload: order.order_url },
  ]);

  logger.info('Job post payment initiated', { shopId, jobPostId, trans_id: order.app_trans_id });
}

async function initiateUnlockPayment(zaloId, shopId, userId) {
  const { data: candidate } = await supabase
    .from('users')
    .select('id, display_name, role, district')
    .eq('id', userId)
    .single();

  if (!candidate) {
    await sendText(zaloId, '❌ Không tìm thấy thông tin ứng viên.');
    return;
  }

  const order = await createOrder({
    shopId, zaloId,
    orderType: 'unlock_candidate',
    refId: userId,
    description: `Việc Nhà Hàng - Mở khóa ứng viên ${candidate.display_name || ''}`,
  });

  if (!order) {
    await sendText(zaloId, '❌ Có lỗi xảy ra khi tạo thanh toán. Vui lòng thử lại sau.');
    return;
  }

  await supabase.from('unlock_transactions').insert({
    shop_id: shopId, user_id: userId,
    trans_id: order.app_trans_id,
    amount: PRICES.unlock_candidate,
    status: 'pending',
    created_at: new Date().toISOString(),
  });

  const amount = PRICES.unlock_candidate.toLocaleString('vi-VN');

  await sendText(zaloId,
    `🔓 Mở khóa thông tin ứng viên\n\nỨng viên: ${candidate.display_name || 'N/A'} | ${candidate.role || ''} | ${candidate.district || ''}\n\nPhí mở khóa: ${amount}đ\n(Bao gồm: SĐT, Zalo ID để liên hệ trực tiếp)\n\nBấm nút bên dưới để thanh toán:`
  );
  await sendButtons(zaloId, 'Thanh toán ngay:', [
    { title: `🔓 Mở khóa ${amount}đ`, payload: order.order_url },
  ]);

  logger.info('Unlock payment initiated', { shopId, userId, trans_id: order.app_trans_id });
}

async function handleZaloPayCallback(req, res) {
  const { data: dataStr, mac } = req.body;

  if (!verifyCallback(dataStr, mac)) {
    logger.warn('ZaloPay callback: invalid MAC');
    return res.json({ return_code: -1, return_message: 'Invalid MAC' });
  }

  let data;
  try { data = JSON.parse(dataStr); }
  catch (e) { return res.json({ return_code: -1, return_message: 'Invalid data' }); }

  const { app_trans_id, zp_trans_id, embed_data: embedStr } = data;
  let embed;
  try { embed = JSON.parse(embedStr); } catch (e) { embed = {}; }

  const { shopId, zaloId, orderType, refId } = embed;
  logger.info('ZaloPay callback received', { app_trans_id, orderType });

  if (orderType === 'post_job') {
    await activateJobPost(zaloId, shopId, refId, zp_trans_id);
  } else if (orderType === 'unlock_candidate') {
    await deliverCandidateInfo(zaloId, shopId, refId, app_trans_id, zp_trans_id);
  }

  res.json({ return_code: 1, return_message: 'success' });
}

async function activateJobPost(zaloId, shopId, jobPostId, zpTransId) {
  await supabase
    .from('job_posts')
    .update({
      payment_status: 'paid',
      payment_zp_id: zpTransId,
      status: 'active',
      activated_at: new Date().toISOString(),
    })
    .eq('id', jobPostId);

  await sendText(zaloId,
    `✅ Thanh toán thành công!\n\nTin tuyển dụng của bạn đã được đăng lên hệ thống.\n\nChúng tôi sẽ bắt đầu ghép ứng viên phù hợp và thông báo cho bạn trong 24 giờ. 🎯`
  );
  logger.info('Job post activated', { jobPostId, shopId, zpTransId });
}

async function deliverCandidateInfo(zaloId, shopId, userId, transId, zpTransId) {
  await supabase
    .from('unlock_transactions')
    .update({ status: 'paid', zp_trans_id: zpTransId, paid_at: new Date().toISOString() })
    .eq('trans_id', transId);

  const { data: user } = await supabase
    .from('users')
    .select('display_name, phone, zalo_id, role, district, interview_score, interview_role')
    .eq('id', userId)
    .single();

  if (!user) {
    await sendText(zaloId, '❌ Không lấy được thông tin ứng viên. Liên hệ support.');
    return;
  }

  const scoreText = user.interview_score
    ? `\n📊 Điểm phỏng vấn: ${user.interview_score}/100 (${user.interview_role || ''})`
    : '';

  await sendText(zaloId,
    `🔓 Thông tin ứng viên đã mở khóa:\n\n` +
    `👤 Họ tên: ${user.display_name || 'N/A'}\n` +
    `📱 SĐT: ${user.phone || 'N/A'}\n` +
    `💬 Zalo: ${user.zalo_id}\n` +
    `🍽️ Vị trí: ${user.role || 'N/A'}\n` +
    `📍 Khu vực: ${user.district || 'N/A'}` +
    scoreText +
    `\n\nBạn có thể liên hệ trực tiếp qua SĐT hoặc Zalo nhé! 🤝`
  );
  logger.info('Candidate info delivered', { shopId, userId, transId });
}

module.exports = { initiateJobPostPayment, initiateUnlockPayment, handleZaloPayCallback };
