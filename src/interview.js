// ============================================================
// VIỆC NHÀ HÀNG — AI Interview System
// Phỏng vấn tự động qua Zalo OA chatbot
//
// Flow: START → Q1 → Q2 → Q3 → SCORE → CARD
// ============================================================
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

// ============================================================
// 1. NGÂN HÀNG CÂU HỎI — 5 vai trò F&B
// ============================================================
const QUESTION_BANK = {
  phuc_vu: [
    {
      id: 'pv_1',
      text: '🍽️ Bạn đã từng làm phục vụ chưa? Nếu có, kể tên 1–2 quán bạn đã làm và làm bao lâu?',
      key: 'experience',
      scoreGuide: { hasExp: 2, duration6m: 1, duration12m: 2 },
    },
    {
      id: 'pv_2',
      text: '😤 Khách phàn nàn món ăn chậm, bạn xử lý như thế nào?',
      key: 'conflict_handling',
      scoreGuide: { apologize: 1, explain: 1, solution: 2, followup: 1 },
    },
    {
      id: 'pv_3',
      text: '⏰ Bạn có thể làm ca tối (17h–22h) không? Và bạn có thể bắt đầu làm sớm nhất khi nào?',
      key: 'availability',
      scoreGuide: { canEvening: 2, startSoon: 2, flexible: 1 },
    },
  ],

  bep: [
    {
      id: 'bep_1',
      text: '👨‍🍳 Bạn có kinh nghiệm nấu bếp không? Bạn thường phụ trách phần nào (bếp lửa, bếp lạnh, sơ chế)?',
      key: 'experience',
      scoreGuide: { hasExp: 2, specialized: 2, duration6m: 1 },
    },
    {
      id: 'bep_2',
      text: '🔪 Bạn biết những món/kỹ thuật nào? Ví dụ: xào, nướng, hầm, trình bày món...',
      key: 'skills',
      scoreGuide: { multipleSkills: 2, presentationSkill: 2, hygieneAware: 1 },
    },
    {
      id: 'bep_3',
      text: '🌡️ Giờ cao điểm quán đông, bạn làm thế nào để không bị bỏ sót món?',
      key: 'pressure_handling',
      scoreGuide: { systematic: 2, communication: 1, calmUnderPressure: 2 },
    },
  ],

  pha_che: [
    {
      id: 'pc_1',
      text: '☕ Bạn đã từng pha chế chưa? Bạn biết pha những loại đồ uống nào (cà phê, trà sữa, cocktail...)?',
      key: 'experience',
      scoreGuide: { hasExp: 2, variety: 2, certified: 1 },
    },
    {
      id: 'pc_2',
      text: '🧃 Khách gọi món không có trong menu, bạn xử lý thế nào?',
      key: 'creativity',
      scoreGuide: { suggestAlternative: 2, explainMenu: 1, customerFocus: 2 },
    },
    {
      id: 'pc_3',
      text: '🧊 Bạn có thể làm việc nhanh trong giờ cao điểm (pha 20–30 ly/giờ) không? Bạn có kinh nghiệm quản lý nguyên liệu không?',
      key: 'efficiency',
      scoreGuide: { canHandleVolume: 2, inventoryAware: 2, teamPlayer: 1 },
    },
  ],

  thu_ngan: [
    {
      id: 'tn_1',
      text: '💳 Bạn đã từng làm thu ngân chưa? Bạn quen dùng phần mềm/máy POS nào?',
      key: 'experience',
      scoreGuide: { hasExp: 2, knowsPOS: 2, duration6m: 1 },
    },
    {
      id: 'tn_2',
      text: '💸 Khách trả tiền thừa 100k, bạn xử lý thế nào nếu cuối ca két không khớp?',
      key: 'integrity',
      scoreGuide: { honest: 3, procedureAware: 2 },
    },
    {
      id: 'tn_3',
      text: '📱 Bạn có biết dùng các hình thức thanh toán không tiền mặt (Momo, VNPay, QR) không?',
      key: 'digital_skills',
      scoreGuide: { knowsMultiplePayment: 2, quickLearner: 2, accurate: 1 },
    },
  ],

  quan_ly: [
    {
      id: 'ql_1',
      text: '👔 Bạn đã từng quản lý nhân viên chưa? Nhóm bao nhiêu người, trong bao lâu?',
      key: 'leadership',
      scoreGuide: { hasExp: 2, teamSize3: 1, teamSize5: 2, duration12m: 1 },
    },
    {
      id: 'ql_2',
      text: '😤 Nhân viên hay đi trễ hoặc nghỉ không xin phép, bạn xử lý thế nào?',
      key: 'people_management',
      scoreGuide: { clearPolicy: 2, fairProcess: 2, documentEvidence: 1 },
    },
    {
      id: 'ql_3',
      text: '📊 Bạn có kinh nghiệm quản lý doanh thu, kiểm kho, hoặc lên lịch nhân viên không?',
      key: 'operations',
      scoreGuide: { revenueTracking: 2, inventory: 1, scheduling: 2 },
    },
  ],
};

async function getOrCreateSession(userId) {
  const { data: existing } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['started', 'q1_sent', 'q2_sent', 'q3_sent'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return existing || null;
}

async function startInterview(userId, role) {
  const normalizedRole = normalizeRole(role);
  if (!QUESTION_BANK[normalizedRole]) {
    return { error: `Vai trò "${role}" chưa được hỗ trợ. Vui lòng chọn: phục vụ, bếp, pha chế, thu ngân, quản lý.` };
  }

  await supabase
    .from('interview_sessions')
    .update({ status: 'abandoned' })
    .eq('user_id', userId)
    .in('status', ['started', 'q1_sent', 'q2_sent', 'q3_sent']);

  const { data: session, error } = await supabase
    .from('interview_sessions')
    .insert({
      user_id: userId,
      role: normalizedRole,
      status: 'started',
      answers: {},
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create interview session', { userId, error });
    return { error: 'Không thể bắt đầu phỏng vấn. Thử lại sau nhé!' };
  }

  const q1 = QUESTION_BANK[normalizedRole][0];
  await supabase
    .from('interview_sessions')
    .update({ status: 'q1_sent' })
    .eq('id', session.id);

  logger.info('Interview started', { userId, role: normalizedRole, sessionId: session.id });

  return {
    sessionId: session.id,
    message: buildIntroMessage(normalizedRole) + '\n\n' + q1.text,
    step: 1,
  };
}

async function handleAnswer(userId, answerText) {
  const session = await getOrCreateSession(userId);
  if (!session) {
    return {
      message: 'Bạn chưa bắt đầu phỏng vấn. Nhắn "phỏng vấn" để bắt đầu nhé!',
      done: false,
    };
  }

  const questions = QUESTION_BANK[session.role];
  const stepMap = { q1_sent: 1, q2_sent: 2, q3_sent: 3 };
  const currentStep = stepMap[session.status];

  if (!currentStep) {
    return { message: 'Phỏng vấn đã kết thúc rồi nhé!', done: true };
  }

  const updatedAnswers = { ...session.answers, [`q${currentStep}`]: answerText };
  const nextStatus = currentStep < 3 ? `q${currentStep + 1}_sent` : 'scoring';

  await supabase
    .from('interview_sessions')
    .update({ answers: updatedAnswers, status: nextStatus })
    .eq('id', session.id);

  if (currentStep < 3) {
    const nextQ = questions[currentStep];
    logger.info('Interview answer recorded', { userId, step: currentStep });
    return {
      message: `✅ Cảm ơn bạn!\n\n${nextQ.text}`,
      step: currentStep + 1,
      done: false,
    };
  }

  logger.info('Interview complete, scoring', { userId, sessionId: session.id });
  return await scoreAndFinish(session.id, userId, session.role, updatedAnswers);
}

async function scoreAndFinish(sessionId, userId, role, answers) {
  const scoreResult = scoreAnswers(role, answers);

  await supabase
    .from('interview_sessions')
    .update({
      status: 'done',
      score: scoreResult.total,
      score_breakdown: scoreResult.breakdown,
      completed_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  await supabase
    .from('users')
    .update({ interview_score: scoreResult.total, interview_role: role })
    .eq('id', userId);

  const card = buildProfileCard(userId, role, scoreResult);
  logger.info('Interview scored', { userId, role, score: scoreResult.total });

  return {
    message: buildScoreMessage(scoreResult),
    card,
    score: scoreResult.total,
    done: true,
  };
}

function scoreAnswers(role, answers) {
  const questions = QUESTION_BANK[role] || [];
  let total = 0;
  const breakdown = {};

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = (answers[`q${i + 1}`] || '').toLowerCase();
    const pts = scoreOneAnswer(answer, q.key, role);
    total += pts;
    breakdown[q.key] = { score: pts, maxScore: 5 };
  }

  const maxRaw = questions.length * 5;
  const normalized = Math.round((total / maxRaw) * 100);

  return { total: normalized, rawTotal: total, maxRaw, breakdown, level: getLevel(normalized) };
}

function scoreOneAnswer(answer, key) {
  const positiveKeywords = {
    experience: ['năm', 'tháng', 'quán', 'nhà hàng', 'đã làm', 'kinh nghiệm', 'từng làm'],
    conflict_handling: ['xin lỗi', 'giải thích', 'hỗ trợ', 'xử lý', 'nhanh', 'khách'],
    availability: ['có thể', 'được', 'sẵn sàng', 'linh hoạt', 'ngay', 'tuần sau'],
    skills: ['xào', 'nướng', 'hầm', 'chiên', 'trình bày', 'vệ sinh', 'thái', 'chế biến'],
    pressure_handling: ['ưu tiên', 'thứ tự', 'thông báo', 'nhanh', 'bình tĩnh', 'phối hợp'],
    creativity: ['gợi ý', 'tương tự', 'thay thế', 'giải thích', 'menu', 'khách'],
    efficiency: ['nhanh', 'kịp', 'quản lý', 'theo dõi', 'nguyên liệu', 'phối hợp'],
    integrity: ['hoàn trả', 'báo cáo', 'trung thực', 'đúng quy trình', 'quản lý', 'ghi lại'],
    digital_skills: ['momo', 'vnpay', 'qr', 'chuyển khoản', 'pos', 'ứng dụng'],
    leadership: ['nhóm', 'nhân viên', 'quản lý', 'phân công', 'theo dõi', 'hướng dẫn'],
    people_management: ['quy định', 'nhắc nhở', 'xử lý', 'công bằng', 'lần 2', 'kỷ luật'],
    operations: ['doanh thu', 'kiểm kho', 'lịch', 'theo dõi', 'báo cáo', 'excel'],
  };

  const keywords = positiveKeywords[key] || [];
  let matches = 0;
  for (const kw of keywords) {
    if (answer.includes(kw)) matches++;
  }

  if (matches >= 4) return 5;
  if (matches === 3) return 4;
  if (matches === 2) return 3;
  if (matches === 1) return 2;
  if (answer.length > 20) return 1;
  return 0;
}

function getLevel(score) {
  if (score >= 80) return { label: '⭐⭐⭐ Xuất sắc', emoji: '🌟', color: 'gold' };
  if (score >= 60) return { label: '⭐⭐ Khá', emoji: '✨', color: 'blue' };
  if (score >= 40) return { label: '⭐ Trung bình', emoji: '👍', color: 'green' };
  return { label: 'Cần cải thiện', emoji: '💪', color: 'gray' };
}

function buildIntroMessage(role) {
  const roleNames = { phuc_vu: 'Phục vụ', bep: 'Bếp', pha_che: 'Pha chế', thu_ngan: 'Thu ngân', quan_ly: 'Quản lý' };
  return `🎯 Bắt đầu phỏng vấn vị trí **${roleNames[role] || role}**!\n\nTôi sẽ hỏi bạn 3 câu ngắn. Trả lời tự nhiên thôi nhé — không có câu trả lời đúng sai! 😊`;
}

function buildScoreMessage(scoreResult) {
  const { total, level } = scoreResult;
  const lines = [`${level.emoji} Phỏng vấn hoàn thành!`, ``, `📊 Điểm của bạn: **${total}/100** — ${level.label}`, ``];
  if (total >= 70) lines.push('🎉 Bạn có hồ sơ rất tốt! Thẻ ứng viên của bạn đã được tạo — các quán sẽ sớm liên hệ nhé!');
  else if (total >= 40) lines.push('👍 Hồ sơ của bạn đã sẵn sàng! Hệ thống sẽ tìm quán phù hợp cho bạn.');
  else lines.push('💪 Cảm ơn bạn đã tham gia! Bạn có thể cải thiện bằng cách thêm kinh nghiệm thực tế.');
  return lines.join('\n');
}

function buildProfileCard(userId, role, scoreResult) {
  const roleLabels = { phuc_vu: 'Phục vụ bàn', bep: 'Nhân viên bếp', pha_che: 'Pha chế / Barista', thu_ngan: 'Thu ngân', quan_ly: 'Quản lý' };
  return { type: 'profile_card', user_id: userId, role: roleLabels[role] || role, score: scoreResult.total, level: scoreResult.level.label, badges: buildBadges(role, scoreResult), created_at: new Date().toISOString() };
}

function buildBadges(role, scoreResult) {
  const badges = [];
  const { breakdown } = scoreResult;
  if (breakdown.experience?.score >= 4) badges.push('✅ Có kinh nghiệm');
  if (breakdown.conflict_handling?.score >= 3 || breakdown.people_management?.score >= 3) badges.push('🤝 Xử lý tình huống tốt');
  if (breakdown.availability?.score >= 3) badges.push('⏰ Lịch linh hoạt');
  if (breakdown.skills?.score >= 4) badges.push('🔧 Kỹ năng chuyên môn');
  if (breakdown.integrity?.score >= 4) badges.push('💎 Trung thực');
  if (breakdown.digital_skills?.score >= 3) badges.push('📱 Thành thạo công nghệ');
  if (breakdown.leadership?.score >= 4) badges.push('👑 Có kinh nghiệm quản lý');
  return badges.length > 0 ? badges : ['🌱 Ứng viên tiềm năng'];
}

function normalizeRole(role) {
  if (!role) return '';
  const r = role.toLowerCase().trim();
  if (r.includes('phục vụ') || r.includes('phuc vu') || r.includes('server') || r === 'pv') return 'phuc_vu';
  if (r.includes('bếp') || r.includes('bep') || r.includes('cook') || r.includes('chef')) return 'bep';
  if (r.includes('pha chế') || r.includes('pha che') || r.includes('bartender') || r.includes('barista') || r === 'pc') return 'pha_che';
  if (r.includes('thu ngân') || r.includes('thu ngan') || r.includes('cashier') || r === 'tn') return 'thu_ngan';
  if (r.includes('quản lý') || r.includes('quan ly') || r.includes('manager') || r === 'ql') return 'quan_ly';
  return r;
}

module.exports = { startInterview, handleAnswer, getOrCreateSession, QUESTION_BANK, scoreAnswers, normalizeRole };
