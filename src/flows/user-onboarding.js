// ============================================================
// Flow ứng viên — Onboarding 5 câu hỏi
// Schema: users (zalo_id, name, role='candidate', desired_role,
//         experience_years, desired_salary, available_shifts,
//         location, onboarding_completed)
// ============================================================
const { sendText, sendButtons } = require('../services/zalo');
const { getSession, updateSession, clearSession } = require('../services/session');
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

const ROLES = {
  'phuc_vu':   'Phục vụ / Nhân viên bàn',
  'bep':       'Nhân viên bếp / Phụ bếp',
  'bartender': 'Bartender / Pha chế',
  'thu_ngan':  'Thu ngân',
  'quan_ly':   'Quản lý / Trưởng ca',
};

const SHIFTS = {
  'sang':  'Ca sáng (6h–14h)',
  'chieu': 'Ca chiều (14h–22h)',
  'toi':   'Ca tối (18h–24h)',
};

function normalize(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').trim();
}

function detectRole(text) {
  const t = normalize(text);
  if (t.includes('phuc vu') || t === '1') return 'phuc_vu';
  if (t.includes('bep') || t.includes('nau') || t === '2') return 'bep';
  if (t.includes('bar') || t.includes('pha che') || t === '3') return 'bartender';
  if (t.includes('thu ngan') || t === '4') return 'thu_ngan';
  if (t.includes('quan ly') || t.includes('truong ca') || t === '5') return 'quan_ly';
  return null;
}

function detectShifts(text) {
  const t = normalize(text);
  const result = [];
  if (t.includes('sang') || t === '1') result.push('sang');
  if (t.includes('chieu') || t === '2') result.push('chieu');
  if (t.includes('toi') || t === '3') result.push('toi');
  if (t.includes('linh hoat') || t.includes('tat ca')) return ['sang', 'chieu', 'toi'];
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

// ============================================================
// ENTRY POINT
// ============================================================
async function handleUserMessage(zaloId, messageText, displayName) {
  const session = await getSession(zaloId);

  // Đang trong flow onboarding
  if (session?.flow === 'user_onboarding') {
    return processOnboardingStep(zaloId, messageText, session);
  }

  // Kiểm tra đã onboard chưa
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, onboarding_completed, desired_role')
    .eq('zalo_id', zaloId)
    .eq('role', 'candidate')
    .maybeSingle();

  if (existingUser?.onboarding_completed) {
    return handleExistingUser(zaloId, messageText, existingUser);
  }

  return startOnboarding(zaloId, displayName);
}

// ============================================================
// Bắt đầu onboarding
// ============================================================
async function startOnboarding(zaloId, displayName) {
  await updateSession(zaloId, { flow: 'user_onboarding', step: 'q1_role', displayName });
  const name = displayName ? `, ${displayName.split(' ').pop()}` : '';

  await sendText(zaloId,
    `Chào bạn${name}! 👋 Mình là Việc Nhà Hàng.\n\n` +
    `Chỉ cần trả lời 5 câu hỏi nhanh (~2 phút), mình sẽ tự động tìm quán F&B phù hợp cho bạn.\n\n` +
    `Bắt đầu nhé! 🚀`
  );

  await sendButtons(zaloId, '📌 Câu 1/5 — Bạn muốn làm vị trí gì?', [
    { title: '🍽️ Phục vụ / Nhân viên bàn', payload: 'role_phuc_vu' },
    { title: '🍳 Nhân viên bếp / Phụ bếp',  payload: 'role_bep' },
    { title: '🍹 Bartender / Pha chế',       payload: 'role_bartender' },
    { title: '💰 Thu ngân',                  payload: 'role_thu_ngan' },
    { title: '📋 Quản lý / Trưởng ca',       payload: 'role_quan_ly' },
  ]);
}

// ============================================================
// Xử lý từng bước onboarding
// ============================================================
async function processOnboardingStep(zaloId, text, session) {
  const step = session.step;

  // Q1: Vị trí
  if (step === 'q1_role') {
    const role = text.startsWith('role_') ? text.replace('role_', '') : detectRole(text);
    if (!role) {
      await sendText(zaloId, 'Mình chưa nhận ra 😅 Bạn bấm nút hoặc gõ: phục vụ / bếp / bartender / thu ngân / quản lý');
      return;
    }
    await updateSession(zaloId, { step: 'q2_experience', desired_role: role });
    await sendButtons(zaloId,
      `✅ Vị trí: ${ROLES[role]}\n\n📌 Câu 2/5 — Bạn có bao nhiêu năm kinh nghiệm?`,
      [
        { title: '🌱 Chưa có kinh nghiệm', payload: 'exp_0' },
        { title: '📅 Dưới 1 năm',          payload: 'exp_1' },
        { title: '📅 1–2 năm',             payload: 'exp_2' },
        { title: '⭐ 3 năm trở lên',        payload: 'exp_3' },
      ]
    );
    return;
  }

  // Q2: Kinh nghiệm
  if (step === 'q2_experience') {
    let exp = 0;
    if (text.startsWith('exp_')) {
      exp = parseInt(text.replace('exp_', ''));
    } else {
      const n = normalize(text);
      if (n.includes('chua') || n === '0') exp = 0;
      else if (n.includes('1') || n.includes('mot') || n.includes('một')) exp = 1;
      else if (n.includes('2') || n.includes('hai')) exp = 2;
      else exp = 3;
    }
    await updateSession(zaloId, { step: 'q3_salary', experience_years: exp });
    await sendButtons(zaloId,
      `✅ Kinh nghiệm: ${exp === 0 ? 'Chưa có' : exp + ' năm'}\n\n📌 Câu 3/5 — Lương kỳ vọng (NET/tháng)?`,
      [
        { title: '4–6 triệu', payload: 'salary_4_6' },
        { title: '6–8 triệu', payload: 'salary_6_8' },
        { title: '8–12 triệu', payload: 'salary_8_12' },
        { title: 'Trên 12 triệu', payload: 'salary_12_up' },
      ]
    );
    return;
  }

  // Q3: Lương
  if (step === 'q3_salary') {
    let salary = 0;
    const salMap = { '4_6': 5e6, '6_8': 7e6, '8_12': 10e6, '12_up': 15e6 };
    if (text.startsWith('salary_')) {
      salary = salMap[text.replace('salary_', '')] || 0;
    } else {
      salary = parseSalary(text) || 0;
      if (!salary) { await sendText(zaloId, 'Bạn nhập lại nhé! Ví dụ: "5 triệu", "6-8 triệu"'); return; }
    }
    await updateSession(zaloId, { step: 'q4_shifts', desired_salary: salary });
    const salaryText = salary >= 1e6 ? `${(salary/1e6).toFixed(0)} triệu` : `${salary}đ`;
    await sendButtons(zaloId,
      `✅ Lương kỳ vọng: ${salaryText}/tháng\n\n📌 Câu 4/5 — Ca làm việc?`,
      [
        { title: '☀️ Ca sáng (6h–14h)',   payload: 'shift_sang' },
        { title: '🌤️ Ca chiều (14h–22h)', payload: 'shift_chieu' },
        { title: '🌙 Ca tối (18h–24h)',    payload: 'shift_toi' },
        { title: '🔄 Linh hoạt (tất cả)', payload: 'shift_all' },
      ]
    );
    return;
  }

  // Q4: Ca làm việc
  if (step === 'q4_shifts') {
    let shifts = [];
    if (text === 'shift_all') shifts = ['sang', 'chieu', 'toi'];
    else if (text.startsWith('shift_')) shifts = [text.replace('shift_', '')];
    else shifts = detectShifts(text);
    if (!shifts.length) { await sendText(zaloId, 'Bạn chọn ca nào? sáng / chiều / tối / tất cả'); return; }
    await updateSession(zaloId, { step: 'q5_location', available_shifts: shifts });
    const shiftText = shifts.map(s => SHIFTS[s]).join(', ');
    await sendText(zaloId,
      `✅ Ca làm: ${shiftText}\n\n` +
      `📌 Câu 5/5 — Bạn ở quận/huyện nào tại TP.HCM?\n\n` +
      `Gõ tên quận nhé! Ví dụ: Quận 1, Bình Thạnh, Gò Vấp, Thủ Đức...`
    );
    return;
  }

  // Q5: Khu vực
  if (step === 'q5_location') {
    const location = text.trim();
    if (location.length < 2) { await sendText(zaloId, 'Bạn gõ tên quận nhé! Ví dụ: Quận 1, Bình Thạnh...'); return; }
    await updateSession(zaloId, { location });
    return completeOnboarding(zaloId);
  }

  logger.warn('Unknown step in user_onboarding', { zaloId, step });
  await clearSession(zaloId);
  return startOnboarding(zaloId, null);
}

// ============================================================
// Hoàn tất onboarding → lưu vào DB
// ============================================================
async function completeOnboarding(zaloId) {
  const session = await getSession(zaloId);
  try {
    const { error } = await supabase.from('users').upsert({
      zalo_id:              zaloId,
      name:                 session.displayName || null,
      role:                 'candidate',
      desired_role:         session.desired_role,
      experience_years:     session.experience_years || 0,
      desired_salary:       session.desired_salary || 0,
      available_shifts:     session.available_shifts || [],
      location:             session.location,
      status:               'active',
      onboarding_completed: true,
      last_active_at:       new Date().toISOString(),
    }, { onConflict: 'zalo_id' });

    if (error) throw error;
    await clearSession(zaloId);

    const roleText   = ROLES[session.desired_role] || session.desired_role;
    const shiftText  = (session.available_shifts || []).map(s => SHIFTS[s]).join(', ');
    const salaryText = session.desired_salary ? `${(session.desired_salary/1e6).toFixed(0)} triệu` : '?';

    await sendText(zaloId,
      `🎉 Hồ sơ của bạn đã được lưu!\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📌 Vị trí: ${roleText}\n` +
      `📅 Kinh nghiệm: ${session.experience_years === 0 ? 'Chưa có' : session.experience_years + ' năm'}\n` +
      `💰 Lương kỳ vọng: ${salaryText}/tháng\n` +
      `🕐 Ca làm: ${shiftText}\n` +
      `📍 Khu vực: ${session.location}\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `Mình sẽ tự động tìm quán phù hợp và báo ngay khi có! 🔍\n\n` +
      `Gõ *kết quả* để xem tình trạng, gõ *sửa hồ sơ* để cập nhật.`
    );
    logger.info('User onboarding completed', { zaloId, role: session.desired_role });
  } catch (err) {
    logger.error('Failed to save user onboarding', { zaloId, error: err.message });
    await sendText(zaloId, 'Có lỗi xảy ra khi lưu hồ sơ 😕 Bạn gõ *bắt đầu* để thử lại nhé!');
  }
}

// ============================================================
// Xử lý user đã onboard
// ============================================================
async function handleExistingUser(zaloId, text, user) {
  const t = normalize(text);

  if (t.includes('sua') || t.includes('thay doi') || t.includes('cap nhat') || t.includes('bat dau')) {
    await updateSession(zaloId, { flow: 'user_onboarding', step: 'q1_role' });
    return startOnboarding(zaloId, null);
  }

  if (t.includes('ket qua') || t.includes('trang thai') || t.includes('tim viec')) {
    return showUserResults(zaloId, user.id);
  }

  await sendButtons(zaloId,
    `Hồ sơ của bạn đang hoạt động ✅\n\nBạn muốn:`,
    [
      { title: '📊 Xem kết quả tìm việc', payload: 'ket qua' },
      { title: '✏️ Sửa hồ sơ',            payload: 'sua ho so' },
    ]
  );
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
    const shop   = m.job_posts?.shops;
    const role   = ROLES[m.job_posts?.role] || m.job_posts?.role || '';
    const salary = m.job_posts?.salary_min ? `${(m.job_posts.salary_min/1e6).toFixed(0)}tr` : '?';
    return `${i+1}. ${shop?.name || 'Quán F&B'} — ${shop?.district || ''}\n   ${role} | ${salary}+/tháng`;
  }).join('\n\n');

  await sendText(zaloId, `📊 Kết quả tìm việc của bạn:\n\n${lines}\n\nMình sẽ liên hệ sắp xếp phỏng vấn khi quán xác nhận!`);
}

module.exports = { handleUserMessage };
