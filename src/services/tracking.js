const supabase = require('../db/supabase');
const logger = require('../utils/logger');

async function createAppointment(userId, jobPostId, shopId) {
  const now = new Date();
  const day3 = new Date(now); day3.setDate(day3.getDate() + 3);
  const day7 = new Date(now); day7.setDate(day7.getDate() + 7);

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      user_id:       userId,
      job_post_id:   jobPostId,
      shop_id:       shopId,
      status:        'introduced',
      introduced_at: now.toISOString(),
      checkin_due:   day3.toISOString(),
      confirm_due:   day7.toISOString(),
      checkin_sent:  false,
      confirm_sent:  false,
    })
    .select()
    .single();

  if (error) { logger.error('Failed to create appointment', { userId, error }); return null; }
  logger.info('Appointment created', { appointmentId: data.id, userId, shopId });
  return data;
}

async function runTrackingCron() {
  logger.info('Running tracking cron');
  const now = new Date();
  await sendDay3Checkins(now);
  await sendDay7Confirms(now);
  await markNoShows(now);
}

async function sendDay3Checkins(now) {
  const { data: due, error } = await supabase
    .from('appointments')
    .select('*, users(zalo_id), job_posts(role, shops(name))')
    .eq('status', 'introduced')
    .eq('checkin_sent', false)
    .lte('checkin_due', now.toISOString());

  if (error || !due || due.length === 0) return;
  const { sendText, sendButtons } = require('./zalo');

  for (const appt of due) {
    const zaloId = appt.users?.zalo_id;
    if (!zaloId) continue;
    const shopName = appt.job_posts?.shops?.name || 'Quán F&B';
    const role = appt.job_posts?.role || 'vị trí';
    try {
      await sendText(zaloId,
        `👋 Việc Nhà Hàng nhắc nhẹ!\n\n` +
        `3 ngày trước mình đã giới thiệu bạn đến **${shopName}** (${role}).\n\n` +
        `Bạn đã liên hệ hoặc đến phỏng vấn chưa?`
      );
      await sendButtons(zaloId, 'Cho mình biết tình hình nhé:', [
        { title: '✅ Đã đến phỏng vấn rồi', payload: `checkin_yes_${appt.id}` },
        { title: '📅 Chưa, sẽ đi sắp tới',  payload: `checkin_soon_${appt.id}` },
        { title: '❌ Không muốn đến nữa',    payload: `checkin_no_${appt.id}` },
      ]);
      await supabase.from('appointments')
        .update({ checkin_sent: true, checkin_sent_at: now.toISOString() })
        .eq('id', appt.id);
      logger.info('Day-3 checkin sent', { appointmentId: appt.id });
    } catch (err) {
      logger.error('Failed to send day-3 checkin', { appointmentId: appt.id, error: err.message });
    }
  }
}

async function sendDay7Confirms(now) {
  const { data: due, error } = await supabase
    .from('appointments')
    .select('*, users(zalo_id), job_posts(role, shops(name))')
    .in('status', ['introduced', 'visited'])
    .eq('confirm_sent', false)
    .lte('confirm_due', now.toISOString());

  if (error || !due || due.length === 0) return;
  const { sendText, sendButtons } = require('./zalo');

  for (const appt of due) {
    const zaloId = appt.users?.zalo_id;
    if (!zaloId) continue;
    const shopName = appt.job_posts?.shops?.name || 'Quán F&B';
    const role = appt.job_posts?.role || 'vị trí';
    try {
      await sendText(zaloId,
        `🗓️ Đã 7 ngày kể từ khi mình giới thiệu bạn đến **${shopName}** (${role}).\n\nKết quả như thế nào rồi?`
      );
      await sendButtons(zaloId, 'Chọn kết quả của bạn:', [
        { title: '🎉 Được nhận vào làm!',              payload: `result_hired_${appt.id}` },
        { title: '😔 Phỏng vấn nhưng không được nhận', payload: `result_rejected_${appt.id}` },
        { title: '🚫 Chưa đến phỏng vấn',              payload: `result_noshow_${appt.id}` },
      ]);
      await supabase.from('appointments')
        .update({ confirm_sent: true, confirm_sent_at: now.toISOString() })
        .eq('id', appt.id);
      logger.info('Day-7 confirm sent', { appointmentId: appt.id });
    } catch (err) {
      logger.error('Failed to send day-7 confirm', { appointmentId: appt.id, error: err.message });
    }
  }
}

async function markNoShows(now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 10);
  const { error } = await supabase.from('appointments')
    .update({ status: 'no_show', closed_at: now.toISOString() })
    .in('status', ['introduced', 'visited'])
    .eq('confirm_sent', true)
    .lte('confirm_sent_at', cutoff.toISOString());
  if (error) logger.error('Failed to mark no-shows', { error });
}

async function handleTrackingResponse(zaloId, payload) {
  if (payload.startsWith('checkin_')) return handleCheckinResponse(zaloId, payload);
  if (payload.startsWith('result_'))  return handleResultResponse(zaloId, payload);
}

async function handleCheckinResponse(zaloId, payload) {
  const { sendText } = require('./zalo');
  const parts = payload.split('_');
  const answer = parts[1];
  const appointmentId = parts[2];

  if (answer === 'yes') {
    await supabase.from('appointments')
      .update({ status: 'visited', visited_at: new Date().toISOString() })
      .eq('id', appointmentId);
    await sendText(zaloId, `✅ Tuyệt! Chúc bạn phỏng vấn thành công! 🍀\n\nMình sẽ hỏi lại kết quả sau vài ngày nhé.`);
  } else if (answer === 'soon') {
    await sendText(zaloId, `📅 OK bạn nhớ đến nhé! Mình sẽ hỏi lại sau vài ngày.`);
  } else if (answer === 'no') {
    await supabase.from('appointments')
      .update({ status: 'cancelled', closed_at: new Date().toISOString() })
      .eq('id', appointmentId);
    await sendText(zaloId, `Không sao! Mình sẽ tiếp tục tìm quán khác phù hợp hơn cho bạn 🔍`);
  }
  logger.info('Checkin response', { answer, appointmentId, zaloId });
}

async function handleResultResponse(zaloId, payload) {
  const { sendText } = require('./zalo');
  const parts = payload.split('_');
  const result = parts[1];
  const appointmentId = parts[2];

  if (result === 'hired') {
    await supabase.from('appointments')
      .update({ status: 'hired', hired_at: new Date().toISOString() })
      .eq('id', appointmentId);
    const { data: appt } = await supabase.from('appointments').select('shop_id').eq('id', appointmentId).single();
    if (appt?.shop_id) {
      await supabase.from('reputation_events').insert({
        shop_id: appt.shop_id, event_type: 'hire_success', delta: 10,
        note: 'Tuyển dụng thành công', created_at: new Date().toISOString(),
      });
    }
    await sendText(zaloId, `🎉 Chúc mừng bạn được nhận vào làm!\n\nChúc bạn công việc thuận lợi và thu nhập tốt! 💪`);
  } else if (result === 'rejected') {
    await supabase.from('appointments')
      .update({ status: 'rejected', closed_at: new Date().toISOString() })
      .eq('id', appointmentId);
    await sendText(zaloId, `😔 Tiếc quá! Nhưng đừng nản — mình sẽ tìm quán khác phù hợp hơn cho bạn.`);
  } else if (result === 'noshow') {
    await supabase.from('appointments')
      .update({ status: 'no_show', closed_at: new Date().toISOString() })
      .eq('id', appointmentId);
    await sendText(zaloId, `Không sao! Nếu vẫn muốn tìm việc, gõ *tìm việc* để mình tìm lại nhé 🔍`);
  }
  logger.info('Result response', { result, appointmentId, zaloId });
}

function startTrackingCron() {
  runTrackingCron().catch(err => logger.error('Cron run failed', { error: err.message }));
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    runTrackingCron().catch(err => logger.error('Cron run failed', { error: err.message }));
  }, ONE_HOUR);
  logger.info('Tracking cron started (every 1 hour)');
}

module.exports = { createAppointment, runTrackingCron, startTrackingCron, handleTrackingResponse };
