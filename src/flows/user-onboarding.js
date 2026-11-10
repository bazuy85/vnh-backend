// ============================================================
// Flow ứng viên — Onboarding 5 câu hỏi
// ============================================================
const { sendText, sendButtons } = require('../services/zalo');
const { getSession, updateSession, clearSession } = require('../services/session');
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

const ROLES = {
  'phuc_vu': 'Phục vụ / Nhân viên bàn',
  'bep':     'Nhân viên bếp / Phụ bếp',
  'bartender': 'Bartender / Pha chế',
  'thu_ngan': 'Thu ngân',
  'quan_ly': 'Quản lý / Trưởng ca',
};

const SHIFTS = {
  'sang':  'Ca sáng (6h–14h)',
  'chieu': 'Ca chiều (14h–22h)',
  'toi':   'Ca tối (18h–24h)',
};

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}

function detectRole(text) {
  const t = normalize(text);
  if (t.includes('phuc vu') || t.includes('phục vụ') || t === '1') return 'phuc_vu';
  if (t.includes('bep') || t.includes('nau an') || t === '2') return 'bep';
  if (t.includes('bar') || t.includes('pha che') || t === '3') return 'bartender';
  if (t.includes('thu ngan') || t.includes('cashier') || t === '4') return 'thu_ngan';
  if (t.includes('quan ly') || t.includes('truong ca') || t === '5') return 'quan_ly';
  return null;
}

function detectShifts(text) {
  const t = normalize(text);
  const result = [];
  if (t.includes('sang') || t.includes('1')) result.push('sang');
  if (t.includes('chieu') || t.includes('2')) result.push('chieu');
  if (t.includes('toi') || t.includes('3')) result.push('toi');
  if (t.includes('ca') && t.includes('linh')) result.push('sang', 'chieu', 'toi');
  if (t.includes('tat ca') || t.includes('tất cả')) return ['sang', 'chieu', 'toi'];
  return [...new Set(result)];
}

function parseSalary(text) {
  const t = normalize(text).replace(/[,\.]/g, '');
  const match = t.match(/(\d+)/);
  if (!match) return null;
  let num = parseInt(match[1]);
  if (num < 1000) num = num * 1_000_000;
  else if (num < 10_000) num = num * 1_000;
  return num;
}

async function handleUserMessage(zaloId, messageText, displayName) {
  const session = await getSession(zaloId);

  if (!session || session.flow !== 'user_onboarding') {
    const { data: existingUser } = await supabase
      .from('users').select('id, onboarding_completed').eq('zalo_id', zaloId).single();

    if (existingUser?.onboarding_completed) {
      return handleExistingUser(zaloId, messageText, existingUser);
    }
    return startOnboarding(zaloId, displayName);
  }

  return processOnboardingStep(zaloId, messageText, session);
}

async function startOnboarding(zaloId, displayName) {
  await updateSession(zaloId, { flow: 'user_onboarding', step: 'q1_role' });
  const name = displayName ? `, ${displayName.split(' ').pop()}` : '';

  await sendText(zaloId,
    `Chào bạn${name}! 👋 Mình là Việc Nhà Hàng — bot kết nối việc làm F&B tại Hà Nội.\n\n` +
    `Chỉ cần trả lời 5 câu hỏi nhanh (~2 phút), mình sẽ tự động tìm quán phù hợp cho bạn.\n\nBắt đầu nhé! 🚀`
  );

  await sendButtons(zaloId, '📌 Câu 1/5 — Bạn muốn làm vị trí gì?', [
    { title: '🍽️ Phục vụ / Nhân viên bàn', payload: 'role_phuc_vu' },
    { title: '🍳 Nhân viên bếp / Phụ bếp', payload: 'role_bep' },
    { title: '🍹 Bartender / Pha chế', payload: 'role_bartender' },
    { title: '💰 Thu ngân', payload: 'role_thu_ngan' },
    { title: '📋 Quản lý / Trưởng ca', payload: 'role_quan_ly' },
  ]);
}

async function processOnboardingStep(zaloId, text, session) {
  const step = session.step;

  if (step === 'q1_role') {
    const payload = text.startsWith('role_') ? text.replace('role_', '') : null;
    const role = payload || detectRole(text);
    if (!role) {
      await sendText(zaloId, 'Mình chưa nhận ra vị trí đó 😅 Bạn bấm nút hoặc gõ: phục vụ / bếp / bartender / thu ngân / quản lý');
      return;
    }
    await updateSession(zaloId, { step: 'q2_experience', role });
    await sendButtons(zaloId,
      `👍 Vị trí: **${ROLES[role]}**\n\n📌 Câu 2/5 — Bạn có bao nhiêu năm kinh nghiệm?`,
      [
        { title: '🌱 Chưa có kinh nghiệm', payload: 'exp_0' },
        { title: '📅 Dưới 1 năm', payload: 'exp_1' },
        { title: '📅 1–2 năm', payload: 'exp_2' },
        { title: '⭐ 3 năm trở lên', payload: 'exp_3' },
      ]
    );
    return;
  }

  if (step === 'q2_experience') {
    let exp = 0;
    if (text.startsWith('exp_')) {
      exp = parseInt(text.replace('exp_', ''));
    } else {
      const n = normalize(text);
      if (n.includes('chua') || n.includes('0')) exp = 0;
      else if (n.includes('1') || n.includes('mot') || n.includes('một')) exp = 1;
      else if (n.includes('2') || n.includes('hai')) exp = 2;
      else if (n.includes('3') || n.match(/[3-9]|[1-9]\d/)) exp = 3;
      else { await sendText(zaloId, 'Bạn gõ số năm kinh nghiệm nhé! Ví dụ: 0, 1, 2, 3...'); return; }
    }
    await updateSession(zaloId, { step: 'q3_salary', experience_years: exp });
    await sendButtons(zaloId,
      `✅ Kinh nghiệm: **${exp === 0 ? 'Chưa có' : exp + ' năm'}**\n\n📌 Câu 3/5 — Lương kỳ vọng (NET/tháng)?`,
      [
        { title: '4–6 triệu', payload: 'salary_4_6' },
        { title: '6–8 triệu', payload: 'salary_6_8' },
        { title: '8–12 triệu', payload: 'salary_8_12' },
        { title: 'Trên 12 triệu', payload: 'salary_12_up' },
      ]
    );
    return;
  }

  if (step === 'q3_salary') {
    let salaryMin = 0, salaryMax = 0;
    if (text.startsWith('salary_')) {
      const map = { '4_6': [4e6,6e6], '6_8': [6e6,8e6], '8_12': [8e6,12e6], '12_up': [12e6,30e6] };
      [salaryMin, salaryMax] = map[text.replace('salary_', '')] || [0, 0];
    } else {
      const nums = text.match(/\d[\d,\.]+/g);
      if (nums) { salaryMin = parseSalary(nums[0]) || 0; salaryMax = nums[1] ? parseSalary(nums[1]) || salaryMin : salaryMin; }
      if (!salaryMin) { await sendText(zaloId, 'Bạn nhập lại lương kỳ vọng nhé! Ví dụ: "5 triệu", "6-8 triệu"'); return; }
    }
    await updateSession(zaloId, { step: 'q4_shifts', salary_min: salaryMin, salary_max: salaryMax });
    const salaryText = salaryMax > salaryMin ? `${(salaryMin/1e6).toFixed(0)}–${(salaryMax/1e6).toFixed(0)} triệu` : `${(salaryMin/1e6).toFixed(0)} triệu`;
    await sendButtons(zaloId,
      `✅ Lương kỳ vọng: **${salaryText}/tháng**\n\n📌 Câu 4/5 — Ca làm việc?`,
      [
        { title: '☀️ Ca sáng (6h–14h)', payload: 'shift_sang' },
        { title: '🌤️ Ca chiều (14h–22h)', payload: 'shift_chieu' },
        { title: '🌙 Ca tối (18h–24h)', payload: 'shift_toi' },
        { title: '🔄 Linh hoạt (tất cả ca)', payload: 'shift_all' },
      ]
    );
    return;
  }

  if (step === 'q4_shifts') {
    let shifts = [];
    if (text === 'shift_all') shifts = ['sang', 'chieu', 'toi'];
    else if (text.startsWith('shift_')) shifts = [text.replace('shift_', '')];
    else shifts = detectShifts(text);
    if (shifts.length === 0) { await sendText(zaloId, 'Bạn chọn ca nào? Bấm nút hoặc gõ: sáng / chiều / tối / tất cả'); return; }
    await updateSession(zaloId, { step: 'q5_location', available_shifts: shifts });
    const shiftText = shifts.map(s => SHIFTS[s]).join(', ');
    await sendText(zaloId, `✅ Ca làm: **${shiftText}**\n\n📌 Câu 5/5 — Bạn ở quận nào tại Hà Nội?\n\nGõ tên quận nhé! Ví dụ: Hoàng Mai, Tây Hồ, Cầu Giấy...`);
    return;
  }

  if (step === 'q5_location') {
    const district = text.trim();
    if (district.length < 2) { await sendText(zaloId, 'Bạn gõ tên quận nhé! Ví dụ: Hoàng Mai, Tây Hồ...'); return; }
    await updateSession(zaloId, { step: 'confirm', district });
    return completeOnboarding(zaloId, session);
  }

  logger.warn('Unknown step in user_onboarding', { zaloId, step });
  await clearSession(zaloId);
  return startOnboarding(zaloId, null);
}

async function completeOnboarding(zaloId, sessionData) {
  const session = await getSession(zaloId);
  try {
    const { error } = await supabase.from('users').upsert({
      zalo_id: zaloId,
      display_name: session.displayName || null,
      role: session.role,
      experience_years: session.experience_years || 0,
      expected_salary_min: session.salary_min || 0,
      expected_salary_max: session.salary_max || session.salary_min || 0,
      available_shifts: session.available_shifts || [],
      district: session.district,
      status: 'active',
      onboarding_completed: true,
      last_active_at: new Date().toISOString(),
    }, { onConflict: 'zalo_id' });

    if (error) throw error;
    await clearSession(zaloId);

    const roleText = ROLES[session.role] || session.role;
    const shiftText = (session.available_shifts || []).map(s => SHIFTS[s]).join(', ');
    const salaryText = session.salary_max > session.salary_min
      ? `${(session.salary_min/1e6).toFixed(0)}–${(session.salary_max/1e6).toFixed(0)} triệu`
      : `${(session.salary_min/1e6).toFixed(0)} triệu`;

    await sendText(zaloId,
      `🎉 Hồ sơ của bạn đã được lưu!\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📌 Vị trí: ${roleText}\n` +
      `📅 Kinh nghiệm: ${session.experience_years === 0 ? 'Chưa có' : session.experience_years + ' năm'}\n` +
      `💰 Lương kỳ vọng: ${salaryText}/tháng\n` +
      `🕐 Ca làm: ${shiftText}\n` +
      `📍 Khu vực: ${session.district}\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `Mình sẽ tự động tìm quán phù hợp và báo bạn ngay khi có! 🔍\n\n` +
      `Gõ *phỏng vấn* để làm bài phỏng vấn AI — tăng cơ hội được chọn nhé!`
    );
    logger.info('User onboarding completed', { zaloId, role: session.role });
  } catch (err) {
    logger.error('Failed to save user onboarding', { zaloId, error: err.message });
    await sendText(zaloId, 'Có lỗi xảy ra khi lưu hồ sơ 😕 Bạn gõ *bắt đầu* để thử lại nhé!');
  }
}

async function handleExistingUser(zaloId, text, user) {
  const t = normalize(text);

  if (t.includes('sua') || t.includes('thay doi') || t.includes('cap nhat')) {
    await updateSession(zaloId, { flow: 'user_onboarding', step: 'q1_role' });
    return startOnboarding(zaloId, null);
  }

  if (t.includes('ket qua') || t.includes('trang thai') || t.includes('tim viec')) {
    return showUserResults(zaloId, user.id);
  }

  if (t.includes('phong van') || t.includes('phỏng vấn') || t.includes('interview')) {
    return startInterviewFlow(zaloId, user);
  }

  const { getOrCreateSession } = require('../services/interview');
  const interviewSession = await getOrCreateSession(zaloId);
  if (interviewSession) {
    return handleInterviewAnswer(zaloId, text);
  }

  await sendText(zaloId,
    `Xin chào! Hồ sơ của bạn đang hoạt động ✅\n\n` +
    `Các lệnh bạn có thể dùng:\n` +
    `• *phỏng vấn* — làm bài phỏng vấn AI để tăng điểm hồ sơ\n` +
    `• *kết quả của tôi* — xem quán đang quan tâm bạn\n` +
    `• *sửa hồ sơ* — cập nhật thông tin tìm việc`
  );
}

async function startInterviewFlow(zaloId, user) {
  const { startInterview } = require('../services/interview');
  const role = user.role || user.desired_role;
  if (!role) {
    await sendText(zaloId, 'Bạn chưa chọn vị trí muốn làm. Gõ *sửa hồ sơ* để cập nhật nhé!');
    return;
  }
  const result = await startInterview(zaloId, role);
  if (result.error) { await sendText(zaloId, result.error); return; }
  await sendText(zaloId, result.message);
}

async function handleInterviewAnswer(zaloId, text) {
  const { handleAnswer } = require('../services/interview');
  const result = await handleAnswer(zaloId, text);
  await sendText(zaloId, result.message);
  if (result.done && result.card) {
    logger.info('Interview card generated', { zaloId, score: result.score });
  }
}

async function showUserResults(zaloId, userId) {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, status, score, job_posts(role, salary_min, shops(name, district))')
    .eq('user_id', userId)
    .order('score', { ascending: false })
    .limit(5);

  if (!matches || matches.length === 0) {
    await sendText(zaloId, `Mình đang tìm quán phù hợp cho bạn ⏳\n\nThường mất 24–48 giờ. Mình sẽ nhắn ngay khi có kết quả!`);
    return;
  }

  const lines = matches.map((m, i) => {
    const shop = m.job_posts?.shops;
    const role = m.job_posts?.role || '';
    const salary = m.job_posts?.salary_min ? `${(m.job_posts.salary_min/1e6).toFixed(0)}tr` : '?';
    return `${i+1}. ${shop?.name || 'Quán F&B'} — ${shop?.district || ''}\n   Vị trí: ${role} | Lương: ${salary}+`;
  }).join('\n\n');

  await sendText(zaloId, `📊 Kết quả tìm việc của bạn:\n\n${lines}\n\nMình sẽ liên hệ khi quán quan tâm để sắp xếp phỏng vấn!`);
}

module.exports = { handleUserMessage };
