/**
 * GATE CS 2027 — Web Application Main Controller
 * "Night Observatory" & "Paper" Themes, Gamified Mastery, Full Offline Capability.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. DATA INITIALIZATION & LOCALSTORAGE MANAGEMENT
  // =========================================================================
  let SYLLABUS = [];
  let TOPICS = [];
  let QUESTIONS = [];

  // LocalStorage Keys
  const STORAGE_KEYS = {
    GOAL_SLIDER: 'gate_plan_slider_pct',
    PLAN_OVERRIDES: 'gate_plan_overrides_v1',
    COMPLETED_TOPICS: 'gate_completed_topics_v1',
    COMPLETED_SUBTOPICS: 'gate_completed_subtopics_v1',
    BOOKMARKS: 'gate_bookmarked_qids_v1',
    SOLVED_STATE: 'gate_solved_questions_v1',
    MOCK_HISTORY: 'gate_mock_test_history_v1',
    THEME: 'gate_theme_v1',
    EXAM_DATE: 'gate_exam_date_v1',
    DAILY_ACTIVITY: 'gate_daily_activity_v1',
    REST_TOKEN: 'gate_rest_token_v1',
    USER_XP: 'gate_user_xp_v1'
  };

  function getStorage(key, defaultVal) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  }

  function setStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  // Persistent States
  let state = {
    theme: getStorage(STORAGE_KEYS.THEME, 'night'),
    examDate: getStorage(STORAGE_KEYS.EXAM_DATE, '2027-02-06'),
    dailyActivity: getStorage(STORAGE_KEYS.DAILY_ACTIVITY, {}), // "YYYY-MM-DD": count
    restTokens: getStorage(STORAGE_KEYS.REST_TOKEN, { count: 1, weekKey: getWeekKey(new Date()) }),
    userXp: getStorage(STORAGE_KEYS.USER_XP, 0),

    sliderGoal: getStorage(STORAGE_KEYS.GOAL_SLIDER, 80),
    planOverrides: getStorage(STORAGE_KEYS.PLAN_OVERRIDES, {}), // topicId: boolean
    subtopicFilter: 'all', // 'all' | 'important' | 'pending'
    allSubtopicsExpanded: false,
    completedTopics: new Set(getStorage(STORAGE_KEYS.COMPLETED_TOPICS, [])),
    completedSubtopics: new Set(getStorage(STORAGE_KEYS.COMPLETED_SUBTOPICS, [])),
    bookmarkedQids: new Set(getStorage(STORAGE_KEYS.BOOKMARKS, [])),
    solvedQuestions: getStorage(STORAGE_KEYS.SOLVED_STATE, {}), // qId -> { attempted, correct, studentAns, wrongCount, timestamp }
    mockHistory: getStorage(STORAGE_KEYS.MOCK_HISTORY, []),

    // UI Session States
    activeTab: 'today',
    isFocusMode: false,
    pomodoro: {
      timeLeft: 25 * 60,
      totalTime: 25 * 60,
      isRunning: false,
      interval: null,
      mode: 'work' // 'work' | 'break'
    },
    topicMode: {
      subject: '',
      topic: '',
      subtopic: 'all',
      currentIndex: 0,
      isErrorMode: false,
      isSpacedReviewMode: false,
      justEvaluatedQid: null,
      activeList: []
    },
    allPyqs: {
      search: '',
      year: 'all',
      subject: 'all',
      type: 'all',
      marks: 'all',
      bookmarkedOnly: false,
      page: 1,
      pageSize: 15,
      showAnswersAll: false,
      justEvaluatedQids: new Set()
    },
    mockTest: {
      active: false,
      mode: 'full',
      questions: [],
      responses: {}, // qIndex -> { selectedOption, selectedCheckboxes, natValue, status }
      currentIndex: 0,
      activeSection: 'GA',
      timeLeft: 180 * 60,
      timerInterval: null,
      startTime: null,
      endTime: null
    }
  };

  function getTodayIso() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  function getWeekKey(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${weekNo}`;
  }

  // =========================================================================
  // 2. BOOTSTRAP APP
  // =========================================================================
  async function initApp() {
    if (window.GATE_DATA) {
      SYLLABUS = window.GATE_DATA.syllabus ? (window.GATE_DATA.syllabus.subjects || window.GATE_DATA.syllabus) : [];
      TOPICS = window.GATE_DATA.topics ? (Array.isArray(window.GATE_DATA.topics) ? window.GATE_DATA.topics : (window.GATE_DATA.topics.topics || [])) : [];
      QUESTIONS = window.GATE_DATA.questions || [];
    } else {
      try {
        const [sRes, tRes, qRes] = await Promise.all([
          fetch('data/syllabus.json').then(r => r.json()),
          fetch('data/topics.json').then(r => r.json()),
          fetch('data/questions.json').then(r => r.json())
        ]);
        SYLLABUS = sRes ? (sRes.subjects || sRes) : [];
        TOPICS = tRes ? (Array.isArray(tRes) ? tRes : (tRes.topics || [])) : [];
        QUESTIONS = qRes || [];
      } catch (err) {
        console.error('Failed to load dataset:', err);
      }
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const requestedTheme = urlParams.get('theme');
      if (requestedTheme && (requestedTheme === 'night' || requestedTheme === 'paper')) {
        state.theme = requestedTheme;
      }
      const hashTab = (window.location.hash || '').replace('#', '');
      if (['today', 'plan', 'topic', 'all', 'mock'].includes(hashTab)) {
        state.activeTab = hashTab;
      }
    } catch (e) {}

    applyTheme(state.theme);
    migrateSolvedHistory();
    setupNavigation();
    initThemeToggle();
    initExamDateModal();
    initFocusModeAndPomodoro();
    initKeyboardShortcuts();
    initConfetti();

    recalcUserXp();
    updateHeaderStats();

    initTodayTab();
    initPlanTab();
    initTopicTab();
    initAllPyqsTab();
    initMockTab();

    switchTab(state.activeTab);

    // If screen=results or hash=mock-results requested
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const hashTab = (window.location.hash || '').replace('#', '');
      if (hashTab === 'mock-results' || urlParams.get('screen') === 'results') {
        setTimeout(showDemoMockResults, 120);
      }
    } catch (e) {}
  }

  // =========================================================================
  // 3. THEME & HEADER SYSTEM
  // =========================================================================
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = theme === 'paper' ? 'light-theme' : 'dark-theme';
    setStorage(STORAGE_KEYS.THEME, theme);

    const btnIcon = document.getElementById('theme-btn-icon');
    const btnText = document.getElementById('theme-btn-text');
    if (btnIcon && btnText) {
      if (theme === 'paper') {
        btnIcon.textContent = '🌙';
        btnText.textContent = 'Night';
      } else {
        btnIcon.textContent = '📜';
        btnText.textContent = 'Paper';
      }
    }

    const mobileThemeBtn = document.getElementById('mobile-btn-toggle-theme');
    if (mobileThemeBtn) {
      mobileThemeBtn.textContent = theme === 'paper' ? '🌙' : '📜';
      mobileThemeBtn.title = theme === 'paper' ? 'Switch to Night Theme' : 'Switch to Paper Theme';
    }
  }

  function initThemeToggle() {
    const btn = document.getElementById('btn-toggle-theme');
    if (btn) {
      btn.addEventListener('click', () => {
        const nextTheme = state.theme === 'night' ? 'paper' : 'night';
        applyTheme(nextTheme);
      });
    }

    const mobileBtn = document.getElementById('mobile-btn-toggle-theme');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        const nextTheme = state.theme === 'night' ? 'paper' : 'night';
        applyTheme(nextTheme);
      });
    }
  }

  function updateHeaderStats() {
    // Solved Counter
    const solvedCount = Object.keys(state.solvedQuestions).length;
    const totalCount = QUESTIONS.length || 1560;
    const solvedEl = document.getElementById('header-solved-val');
    if (solvedEl) solvedEl.textContent = `${solvedCount} / ${totalCount}`;

    // Streak calculation
    const streakData = computeStreak();
    const streakEl = document.getElementById('header-streak-val');
    if (streakEl) streakEl.textContent = `${streakData.streak} Day${streakData.streak !== 1 ? 's' : ''}`;

    // Countdown Days to GATE
    const cdEl = document.getElementById('header-countdown-val');
    if (cdEl) {
      const days = getDaysToExam();
      cdEl.textContent = `${days} Days`;
    }
  }

  function getDaysToExam() {
    const target = new Date(state.examDate);
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  function initExamDateModal() {
    const chip = document.getElementById('chip-countdown');
    const modal = document.getElementById('modal-exam-date');
    const cancelBtn = document.getElementById('btn-cancel-exam-date');
    const saveBtn = document.getElementById('btn-save-exam-date');
    const input = document.getElementById('input-exam-date');

    if (chip && modal && input) {
      chip.addEventListener('click', () => {
        input.value = state.examDate;
        modal.classList.remove('hidden');
      });
    }
    if (cancelBtn && modal) {
      cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }
    if (saveBtn && modal && input) {
      saveBtn.addEventListener('click', () => {
        if (input.value) {
          state.examDate = input.value;
          setStorage(STORAGE_KEYS.EXAM_DATE, state.examDate);
          updateHeaderStats();
          renderTodayMission();
        }
        modal.classList.add('hidden');
      });
    }
  }

  // =========================================================================
  // 4. NAVIGATION CONTROLLER
  // =========================================================================
  function setupNavigation() {
    const desktopTabs = document.querySelectorAll('#main-nav-tabs .nav-item-btn');
    const mobileTabs = document.querySelectorAll('#mobile-nav-tabs .mobile-nav-btn');

    desktopTabs.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    mobileTabs.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const brandLink = document.getElementById('brand-link');
    if (brandLink) {
      brandLink.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('today');
      });
    }
  }

  function switchTab(tabId) {
    if (state.mockTest.active && tabId !== 'mock') {
      if (!confirm('A mock test is currently in progress! Navigating away will keep the countdown running. Continue?')) {
        return;
      }
    }

    state.activeTab = tabId;

    // Update Sidebar
    document.querySelectorAll('#main-nav-tabs .nav-item-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update Mobile Nav
    document.querySelectorAll('#mobile-nav-tabs .mobile-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Switch View
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `view-${tabId}`);
    });

    // Update Breadcrumb
    const tabLabels = {
      today: "Today's Mission",
      plan: 'Plan & Mastery',
      topic: 'Topic Practice',
      all: 'All PYQs Archive',
      mock: 'Mock Simulator'
    };
    const titleEl = document.getElementById('header-active-tab-title');
    if (titleEl) titleEl.textContent = tabLabels[tabId] || 'Observatory';

    // Reset per-visit evaluation highlight flags when revisiting tabs
    state.topicMode.justEvaluatedQid = null;
    if (tabId === 'all') {
      state.allPyqs.justEvaluatedQids.clear();
    }

    // Refresh Tab Data
    if (tabId === 'today') renderTodayMission();
    if (tabId === 'plan') { renderPlan(); renderMasteryMap(); }
    if (tabId === 'topic') {
      syncTopicDropdowns();
      if (!state.topicMode.activeList || state.topicMode.activeList.length === 0 ||
          (!state.topicMode.isErrorMode && !state.topicMode.isSpacedReviewMode &&
           state.topicMode.activeList[0] && state.topicMode.activeList[0].topic !== state.topicMode.topic)) {
        loadTopicQuestions();
      } else {
        renderTopicPractice();
      }
    }
    if (tabId === 'all') renderAllQuestionsList();
    if (tabId === 'mock') renderMockLobby();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // =========================================================================
  // 5. XP & PROGRESSION SYSTEM
  // =========================================================================
  function recalcUserXp() {
    let xp = 0;
    // XP from solved questions
    for (const qid in state.solvedQuestions) {
      const item = state.solvedQuestions[qid];
      if (item && item.attempted && item.correct) {
        const q = QUESTIONS.find(x => x.id === qid);
        const marks = q ? q.marks : 1;
        xp += marks * 10;
        if (item.wrongCount && item.wrongCount > 0) xp += 15; // Correction bonus!
      }
    }
    // XP from completed topics
    xp += state.completedTopics.size * 100;
    // XP from mocks
    xp += state.mockHistory.length * 250;

    state.userXp = xp;
    setStorage(STORAGE_KEYS.USER_XP, xp);
    updateXpDisplay();
  }

  function addXp(amount, reason) {
    state.userXp += amount;
    setStorage(STORAGE_KEYS.USER_XP, state.userXp);
    updateXpDisplay();
  }

  function updateXpDisplay() {
    const xp = state.userXp;
    // Level formula: Level = floor(sqrt(XP / 100)) + 1
    const currentLevel = Math.floor(Math.sqrt(xp / 100)) + 1;
    const currentLevelBaseXp = Math.pow(currentLevel - 1, 2) * 100;
    const nextLevelXp = Math.pow(currentLevel, 2) * 100;
    const levelRange = Math.max(1, nextLevelXp - currentLevelBaseXp);
    const progressInLevel = Math.max(0, xp - currentLevelBaseXp);
    const pct = Math.min(100, Math.round((progressInLevel / levelRange) * 100));

    const ranks = ['Initiate', 'Novice', 'Apprentice', 'Scholar', 'Specialist', 'Master', 'Grandmaster'];
    const rankTitle = ranks[Math.min(ranks.length - 1, currentLevel - 1)];

    const lvlBadge = document.getElementById('sidebar-level-badge');
    const rankEl = document.getElementById('sidebar-rank-title');
    const fillEl = document.getElementById('sidebar-xp-fill');
    const curXpEl = document.getElementById('sidebar-xp-current');
    const nextXpEl = document.getElementById('sidebar-xp-next');

    if (lvlBadge) lvlBadge.textContent = `Level ${currentLevel}`;
    if (rankEl) rankEl.textContent = rankTitle;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (curXpEl) curXpEl.textContent = `${xp} XP`;
    if (nextXpEl) nextXpEl.textContent = `${nextLevelXp} XP`;
  }

  // =========================================================================
  // 6. STREAK, HEATMAP & SPACED REPETITION ENGINE
  // =========================================================================
  function recordDailyActivity() {
    const today = getTodayIso();
    state.dailyActivity[today] = (state.dailyActivity[today] || 0) + 1;
    setStorage(STORAGE_KEYS.DAILY_ACTIVITY, state.dailyActivity);
    updateHeaderStats();
  }

  function computeStreak() {
    const activity = state.dailyActivity;
    let streak = 0;
    const now = new Date();
    let checkDate = new Date(now);
    let todaySolved = (activity[getTodayIso()] || 0) > 0;

    if (!todaySolved) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    let restTokenUsed = false;
    for (let i = 0; i < 365; i++) {
      const iso = checkDate.toISOString().split('T')[0];
      const count = activity[iso] || 0;
      if (count > 0) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        // Check forgiving rest token
        if (!restTokenUsed && state.restTokens.count > 0 && i > 0) {
          restTokenUsed = true;
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    return {
      streak: Math.max(todaySolved ? 1 : 0, streak),
      todayCount: activity[getTodayIso()] || 0
    };
  }

  function getSpacedReviewDueQuestions() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const due = [];

    for (const qid in state.solvedQuestions) {
      const sol = state.solvedQuestions[qid];
      if (sol && sol.attempted && !sol.correct) {
        const time = sol.timestamp || (now - dayMs * 1.5);
        const daysAgo = (now - time) / dayMs;
        // Due if roughly 1, 3, or 7+ days ago
        if (daysAgo >= 0.8) {
          const q = QUESTIONS.find(x => x.id === qid);
          if (q) due.push(q);
        }
      }
    }
    return due;
  }

  // =========================================================================
  // 6B. ATTEMPT HISTORY & WRONG-ANSWER REVISIT HELPERS
  // =========================================================================
  function formatAnswerText(q, studentAns) {
    if (studentAns === null || studentAns === undefined) return 'None';
    if (q.type === 'MCQ') {
      const idx = parseInt(studentAns, 10);
      if (isNaN(idx)) return String(studentAns);
      const letter = String.fromCharCode(65 + idx);
      const optVal = (q.options && q.options[idx]) ? String(q.options[idx]).trim() : '';
      const hasDistinctText = !q.image && optVal && optVal !== letter && optVal !== `(${letter})`;
      return hasDistinctText ? `Option ${letter} (${optVal.slice(0, 40)}${optVal.length > 40 ? '…' : ''})` : `Option ${letter}`;
    }
    if (q.type === 'MSQ') {
      if (!Array.isArray(studentAns) || studentAns.length === 0) return 'None';
      return studentAns.map(idx => `Option ${String.fromCharCode(65 + idx)}`).join(', ');
    }
    if (q.type === 'NAT') {
      return `${studentAns}`;
    }
    return String(studentAns);
  }

  function formatHistoryDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function getQuestionHistory(q, sol) {
    if (!sol) return [];
    if (Array.isArray(sol.history) && sol.history.length > 0) {
      return sol.history.map((item, idx) => ({
        ...item,
        attempt: item.attempt || (idx + 1),
        ansText: item.ansText || (q ? formatAnswerText(q, item.studentAns) : String(item.studentAns)),
        dateStr: item.dateStr || formatHistoryDate(item.timestamp)
      }));
    }
    if (sol.attempted && sol.studentAns !== undefined && sol.studentAns !== null) {
      return [{
        attempt: 1,
        studentAns: sol.studentAns,
        ansText: q ? formatAnswerText(q, sol.studentAns) : String(sol.studentAns),
        correct: !!sol.correct,
        timestamp: sol.timestamp || Date.now(),
        dateStr: formatHistoryDate(sol.timestamp)
      }];
    }
    return [];
  }

  function migrateSolvedHistory() {
    let changed = false;
    for (const qid in state.solvedQuestions) {
      const sol = state.solvedQuestions[qid];
      if (!sol || !sol.attempted) continue;
      if (!Array.isArray(sol.history) || sol.history.length === 0) {
        const q = QUESTIONS.find(x => x.id === qid);
        sol.history = getQuestionHistory(q, sol);
        changed = true;
      }
    }
    if (changed) {
      setStorage(STORAGE_KEYS.SOLVED_STATE, state.solvedQuestions);
    }
  }

  function recordQuestionAttempt(q, studentAns, isCorrect) {
    const qid = q.id;
    const prevSol = state.solvedQuestions[qid] || null;
    const history = getQuestionHistory(q, prevSol);

    const now = Date.now();
    history.push({
      attempt: history.length + 1,
      studentAns: studentAns,
      ansText: formatAnswerText(q, studentAns),
      correct: isCorrect,
      timestamp: now,
      dateStr: formatHistoryDate(now)
    });

    const newWrongCount = history.filter(h => !h.correct).length;
    const prevWrongCount = prevSol ? (prevSol.wrongCount || history.slice(0, -1).filter(h => !h.correct).length) : 0;

    state.solvedQuestions[qid] = {
      attempted: true,
      correct: isCorrect,
      studentAns: studentAns,
      wrongCount: newWrongCount,
      timestamp: now,
      history: history
    };

    setStorage(STORAGE_KEYS.SOLVED_STATE, state.solvedQuestions);
    recordDailyActivity();

    if (isCorrect) {
      const xpGain = (q.marks * 10) + (prevWrongCount > 0 ? 15 : 0);
      addXp(xpGain, 'Question Correct');
      if (prevWrongCount > 0) triggerConfetti();
    }

    updateHeaderStats();
    return { prevWrongCount, newWrongCount, history };
  }

  function buildHistoryBannerHtml(q, sol, isRevisitedReset) {
    const history = getQuestionHistory(q, sol);
    if (history.length === 0) return '';

    const wrongAttempts = history.filter(h => !h.correct);
    if (wrongAttempts.length === 0 && !isRevisitedReset) return '';

    const lastWrong = wrongAttempts[wrongAttempts.length - 1];
    const isResolved = sol && sol.correct && !isRevisitedReset;
    const badgeLabel = wrongAttempts.length > 0
      ? `${wrongAttempts.length} wrong attempt${wrongAttempts.length > 1 ? 's' : ''}`
      : `${history.length} attempt${history.length > 1 ? 's' : ''}`;

    const summaryTitle = isRevisitedReset
      ? '<strong>Question Reset for Retry</strong> — previous wrong answer saved in history'
      : (isResolved
          ? '<strong>Resolved</strong> — past mistake history preserved'
          : '<strong>Attempt History</strong>');

    return `
      <div class="q-history-banner ${isResolved ? 'has-correct' : ''}">
        <div class="q-history-header" data-history-toggle="${q.id}">
          <div class="q-history-summary">
            <span class="history-icon">${isResolved ? '✓' : '↺'}</span>
            <span class="history-title">${summaryTitle}</span>
            <span class="history-pill ${isResolved ? 'resolved' : ''}">${badgeLabel}</span>
            ${lastWrong ? `<span class="history-last-ans">Last wrong: <strong>${lastWrong.ansText}</strong></span>` : ''}
          </div>
          <button type="button" class="btn-toggle-history-details" aria-expanded="false">
            <span>History (${history.length})</span> <span class="history-arrow">▼</span>
          </button>
        </div>
        <div class="q-history-details collapsed">
          ${history.slice().reverse().map(item => `
            <div class="history-item ${item.correct ? 'correct' : 'wrong'}">
              <span class="history-attempt-num">Attempt #${item.attempt}</span>
              <span class="history-ans-text">Answered <strong>${item.ansText}</strong></span>
              <span class="history-status-tag ${item.correct ? 'correct' : 'wrong'}">${item.correct ? '✓ Correct' : '✗ Wrong'}</span>
              <span class="history-timestamp">${item.dateStr || ''}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 7. TAB 1: TODAY'S MISSION CONTROLLER
  // =========================================================================
  function initTodayTab() {
    renderTodayMission();

    const g1Btn = document.getElementById('btn-start-goal-1');
    const g2Btn = document.getElementById('btn-start-goal-2');
    const g3Btn = document.getElementById('btn-start-goal-3');
    const revBtn = document.getElementById('btn-start-spaced-review');
    const nextStepBtn = document.getElementById('btn-go-next-step');

    if (g1Btn) {
      g1Btn.addEventListener('click', () => {
        const best = getBestNextTopic();
        if (best) {
          navigateToTopicPractice(best.subject_id, best.id);
        } else {
          switchTab('topic');
        }
      });
    }

    if (g2Btn) {
      g2Btn.addEventListener('click', () => switchTab('topic'));
    }

    if (g3Btn || revBtn) {
      const startRev = () => {
        const due = getSpacedReviewDueQuestions();
        state.topicMode.justEvaluatedQid = null;
        state.topicMode.retakeQid = null;
        if (due.length > 0) {
          state.topicMode.isSpacedReviewMode = true;
          state.topicMode.isErrorMode = false;
          state.topicMode.activeList = due;
          state.topicMode.currentIndex = 0;
          switchTab('topic');
        } else {
          // If no spaced review, fall back to general error log
          state.topicMode.isErrorMode = true;
          state.topicMode.isSpacedReviewMode = false;
          loadTopicQuestions();
          switchTab('topic');
        }
      };
      if (g3Btn) g3Btn.addEventListener('click', startRev);
      if (revBtn) revBtn.addEventListener('click', startRev);
    }

    if (nextStepBtn) {
      nextStepBtn.addEventListener('click', () => {
        const best = getBestNextTopic();
        if (best) {
          navigateToTopicPractice(best.subject_id, best.id);
        } else {
          switchTab('topic');
        }
      });
    }
  }

  function getBestNextTopic() {
    const uncompleted = TOPICS.filter(t => !state.completedTopics.has(t.id));
    if (uncompleted.length === 0) return TOPICS[0] || null;
    return uncompleted[0]; // Already sorted by priority_score
  }

  function renderTodayMission() {
    const today = getTodayIso();
    const todayCount = state.dailyActivity[today] || 0;
    const dueQuestions = getSpacedReviewDueQuestions();
    const bestTopic = getBestNextTopic();

    // Mission 1: Master High Impact Topic
    const g1El = document.getElementById('mission-goal-1');
    const g1Title = document.getElementById('goal-1-title');
    const g1Sub = document.getElementById('goal-1-sub');
    if (bestTopic) {
      if (g1Title) g1Title.textContent = `Master: ${bestTopic.name}`;
      if (g1Sub) g1Sub.textContent = `Priority Score ${bestTopic.priority_score} • ~${bestTopic.estimated_hours} hrs`;
    }
    const g1Done = bestTopic && state.completedTopics.has(bestTopic.id);
    if (g1El) g1El.classList.toggle('done', !!g1Done);

    // Mission 2: Daily 15 PYQs
    const g2El = document.getElementById('mission-goal-2');
    const g2Prog = document.getElementById('goal-2-prog');
    if (g2Prog) g2Prog.textContent = todayCount;
    const g2Done = todayCount >= 15;
    if (g2El) g2El.classList.toggle('done', g2Done);

    // Mission 3: Spaced Review
    const g3El = document.getElementById('mission-goal-3');
    const g3Sub = document.getElementById('goal-3-sub');
    if (g3Sub) g3Sub.textContent = dueQuestions.length > 0
      ? `${dueQuestions.length} mistake${dueQuestions.length > 1 ? 's' : ''} due for reinforcement today`
      : 'All mistake review cards are clear today!';
    const g3Done = dueQuestions.length === 0 && Object.keys(state.solvedQuestions).length > 0;
    if (g3El) g3El.classList.toggle('done', g3Done);

    // Circular Ring Completion Calculation
    let doneCount = (g1Done ? 1 : 0) + (g2Done ? 1 : 0) + (g3Done ? 1 : 0);
    const pct = Math.round((doneCount / 3) * 100);

    const ringFill = document.getElementById('mission-ring-fill');
    const ringText = document.getElementById('mission-ring-pct');
    if (ringFill) {
      const circ = 2 * Math.PI * 25; // ~157.08
      ringFill.style.strokeDasharray = `${circ}`;
      ringFill.style.strokeDashoffset = `${circ - (pct / 100) * circ}`;
    }
    if (ringText) ringText.textContent = `${pct}%`;

    const badgeCount = document.getElementById('badge-mission-count');
    if (badgeCount) badgeCount.textContent = `${3 - doneCount}`;

    // Reactive Motivation Text
    const motEl = document.getElementById('motivation-text');
    if (motEl) {
      const wrongCount = Object.values(state.solvedQuestions).filter(s => s.attempted && !s.correct).length;
      if (doneCount === 3) {
        motEl.textContent = '🌟 Extraordinary work! You completed all 3 daily missions today. Rest well or attempt a mini mock.';
      } else if (todayCount >= 10) {
        motEl.textContent = `🔥 Great momentum! You have conquered ${todayCount} GATE questions today. Keep your analytical edge sharp.`;
      } else if (wrongCount > 0) {
        motEl.textContent = `💡 Pro tip: Reviewing your ${wrongCount} error-log questions builds 2x more intuition than solving easy ones.`;
      } else {
        motEl.textContent = '“Consistent daily problem solving compounds into effortless mastery on exam day.”';
      }
    }

    // Render Streak & Week Heat-Strip
    renderWeekHeatStrip();
    renderActivityHeatmap();

    // Spaced Review Card
    const qCountEl = document.getElementById('today-queue-count');
    const qTextEl = document.getElementById('today-queue-text');
    if (qCountEl) qCountEl.textContent = `${dueQuestions.length} Due`;
    if (qTextEl) {
      qTextEl.textContent = dueQuestions.length > 0
        ? `You have ${dueQuestions.length} question${dueQuestions.length > 1 ? 's' : ''} ready for spaced recall today.`
        : 'All review cards up to date! Great job retaining concepts.';
    }

    // Best Next Step Card
    if (bestTopic) {
      const tEl = document.getElementById('next-step-topic-title');
      const gEl = document.getElementById('next-step-gain-text');
      if (tEl) tEl.textContent = `${bestTopic.name} (${bestTopic.subject})`;
      if (gEl) gEl.textContent = `Priority Score ${bestTopic.priority_score} • ~${bestTopic.estimated_hours} hrs study`;
    }
  }

  function renderWeekHeatStrip() {
    const strip = document.getElementById('today-week-strip');
    const streakCountEl = document.getElementById('today-streak-count');
    if (!strip) return;

    const streakData = computeStreak();
    if (streakCountEl) streakCountEl.textContent = streakData.streak;

    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Mon, 6 = Sun

    let html = '';
    for (let i = 0; i < 7; i++) {
      const diff = i - dayOfWeek;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      const iso = d.toISOString().split('T')[0];
      const count = state.dailyActivity[iso] || 0;
      const isActive = count > 0;
      const isPast = diff <= 0;

      html += `
        <div class="week-day-box">
          <span class="week-day-letter">${days[i]}</span>
          <div class="week-day-dot ${isActive ? 'active' : ''}" title="${iso}: ${count} questions">
            ${isActive ? '✓' : ''}
          </div>
        </div>
      `;
    }
    strip.innerHTML = html;
  }

  function renderActivityHeatmap() {
    const grid = document.getElementById('activity-heatmap-grid');
    const activeLabel = document.getElementById('heatmap-total-active');
    if (!grid) return;

    const now = new Date();
    let html = '';
    let activeDaysCount = 0;

    // 60 days back (approx 9 weeks)
    for (let i = 62; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      const count = state.dailyActivity[iso] || 0;
      if (count > 0) activeDaysCount++;

      let lvlClass = '';
      if (count >= 20) lvlClass = 'lvl-4';
      else if (count >= 10) lvlClass = 'lvl-3';
      else if (count >= 5) lvlClass = 'lvl-2';
      else if (count >= 1) lvlClass = 'lvl-1';

      html += `<div class="heatmap-cell ${lvlClass}" title="${iso}: ${count} questions solved"></div>`;
    }
    grid.innerHTML = html;
    if (activeLabel) activeLabel.textContent = `Active days: ${activeDaysCount}`;
  }

  // =========================================================================
  // 8. TAB 2: PLAN & MASTERY MAP CONTROLLER
  // =========================================================================
  function initPlanTab() {
    const slider = document.getElementById('importance-slider');
    const presets = document.querySelectorAll('.btn-preset-pill');
    const resetBtn = document.getElementById('btn-reset-plan');

    if (slider) {
      slider.value = state.sliderGoal;
      slider.addEventListener('input', (e) => {
        state.sliderGoal = parseInt(e.target.value, 10);
        state.planOverrides = {};
        setStorage(STORAGE_KEYS.GOAL_SLIDER, state.sliderGoal);
        setStorage(STORAGE_KEYS.PLAN_OVERRIDES, state.planOverrides);
        updatePresetButtons();
        renderPlan();
      });
    }

    presets.forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.preset, 10);
        state.sliderGoal = p;
        state.planOverrides = {};
        if (slider) slider.value = p;
        setStorage(STORAGE_KEYS.GOAL_SLIDER, state.sliderGoal);
        setStorage(STORAGE_KEYS.PLAN_OVERRIDES, state.planOverrides);
        updatePresetButtons();
        renderPlan();
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.sliderGoal = 100;
        state.planOverrides = {};
        if (slider) slider.value = 100;
        setStorage(STORAGE_KEYS.GOAL_SLIDER, 100);
        setStorage(STORAGE_KEYS.PLAN_OVERRIDES, {});
        updatePresetButtons();
        renderPlan();
      });
    }

    // Subtopic filter buttons
    document.querySelectorAll('.subtopic-filter-toolbar .btn-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.subtopic-filter-toolbar .btn-filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.subtopicFilter = btn.dataset.sf || 'all';
        renderPlan();
      });
    });

    const toggleAllBtn = document.getElementById('btn-toggle-all-subtopics');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        state.allSubtopicsExpanded = !state.allSubtopicsExpanded;
        toggleAllBtn.textContent = state.allSubtopicsExpanded ? 'Collapse All' : 'Expand All';
        renderPlan();
      });
    }

    renderPlan();
    renderMasteryMap();
  }

  function updatePresetButtons() {
    document.querySelectorAll('.btn-preset-pill').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.preset, 10) === state.sliderGoal);
    });
    const label = document.getElementById('slider-goal-label');
    if (label) label.textContent = `${state.sliderGoal}%`;
  }

  function isSubtopicImportant(subName) {
    if (!subName) return false;
    const s = subName.toLowerCase();
    const highYieldKeywords = [
      'logic', 'graph', 'eigenvalue', 'matrix', 'limit', 'probability', 'bayes', 'circuit',
      'sequential', 'combinational', 'pipelin', 'hazard', 'cache', 'memory', 'addressing',
      'c', 'recursion', 'tree', 'heap', 'stack', 'queue', 'complexity', 'dynamic programming',
      'greedy', 'shortest path', 'automata', 'dfa', 'turing', 'regular', 'context-free',
      'parsing', 'syntax', 'process', 'concurrency', 'deadlock', 'virtual memory', 'page',
      'relational', 'sql', 'b and b+', 'b+', 'transaction', 'routing', 'ipv4', 'tcp',
      'flow control', 'numerical', 'reasoning'
    ];
    return highYieldKeywords.some(k => s.includes(k));
  }

  function computeSubtopicPercentages(topicObj, subtopics) {
    if (!subtopics || subtopics.length === 0) return {};
    
    const scored = subtopics.map(sub => {
      const sLower = sub.toLowerCase();
      const isImp = isSubtopicImportant(sLower);
      let raw = 20 + (isImp ? 25 : 0) + (sub.length > 35 ? 8 : 0);

      if (typeof QUESTIONS !== 'undefined' && QUESTIONS.length > 0 && topicObj && topicObj.id) {
        const topicQs = QUESTIONS.filter(q => q.topic === topicObj.id);
        const subTerms = sLower.split(/[,:;]|\band\b/).map(t => t.trim()).filter(t => t.length > 2);
        let matches = 0;
        topicQs.slice(0, 40).forEach(q => {
          const hay = ((q.question || '') + ' ' + (q.explanation || '')).toLowerCase();
          if (subTerms.some(term => hay.includes(term))) matches++;
        });
        raw += Math.min(matches, 25);
      }
      return { sub, raw };
    });

    const sumRaw = scored.reduce((s, x) => s + x.raw, 0);
    const result = {};
    let totalDistributed = 0;
    scored.forEach((item, idx) => {
      if (idx === scored.length - 1) {
        result[item.sub] = Math.max(1, 100 - totalDistributed);
      } else {
        const pct = Math.max(1, Math.round((item.raw / sumRaw) * 100));
        result[item.sub] = pct;
        totalDistributed += pct;
      }
    });
    return result;
  }

  function computeSelectedTopics() {
    const totalPriority = TOPICS.reduce((sum, t) => sum + (t.priority_score || 0), 0);
    const targetPriority = (state.sliderGoal / 100) * totalPriority;

    const ranked = [...TOPICS].sort((a, b) => {
      const effA = a.priority_score / Math.max(a.estimated_hours, 1);
      const effB = b.priority_score / Math.max(b.estimated_hours, 1);
      return effB - effA;
    });

    let currentPriority = 0;
    const autoSelected = new Set();

    for (const t of ranked) {
      if (currentPriority < targetPriority || state.sliderGoal === 100) {
        autoSelected.add(t.id);
        currentPriority += t.priority_score;
      }
    }

    const finalSelected = new Set(autoSelected);
    for (const [tid, isManual] of Object.entries(state.planOverrides)) {
      if (isManual) finalSelected.add(tid);
      else finalSelected.delete(tid);
    }

    return {
      selectedSet: finalSelected,
      totalPriority,
      coveredPriority: TOPICS.filter(t => finalSelected.has(t.id)).reduce((sum, t) => sum + t.priority_score, 0)
    };
  }

  function renderPlan() {
    updatePresetButtons();
    const { selectedSet, totalPriority, coveredPriority } = computeSelectedTopics();

    const totalTopicsCount = TOPICS.length;
    const selectedCount = selectedSet.size;
    const outsideCount = totalTopicsCount - selectedCount;

    const importancePct = totalPriority > 0 ? Math.min(100, Math.round((coveredPriority / totalPriority) * 100)) : 0;
    const syllabusPct = totalTopicsCount > 0 ? Math.round((selectedCount / totalTopicsCount) * 100) : 0;
    const totalHours = TOPICS.filter(t => selectedSet.has(t.id)).reduce((sum, t) => sum + t.estimated_hours, 0);

    // Update Dual Donut SVG Rings
    const outerRing = document.getElementById('ring-importance');
    const innerRing = document.getElementById('ring-syllabus');
    const impLabel = document.getElementById('donut-importance-val');
    const sylLabel = document.getElementById('donut-syllabus-val');

    if (outerRing) {
      const circ = 2 * Math.PI * 90; // ~565.48
      outerRing.style.strokeDasharray = `${circ}`;
      outerRing.style.strokeDashoffset = `${circ - (importancePct / 100) * circ}`;
    }
    if (innerRing) {
      const circ = 2 * Math.PI * 68; // ~427.25
      innerRing.style.strokeDasharray = `${circ}`;
      innerRing.style.strokeDashoffset = `${circ - (syllabusPct / 100) * circ}`;
    }
    if (impLabel) impLabel.textContent = `${importancePct}%`;
    if (sylLabel) sylLabel.textContent = `${syllabusPct}%`;

    // Stat Cards
    const statTopics = document.getElementById('stat-topics-selected');
    const statOutside = document.getElementById('stat-topics-outside');
    const statHours = document.getElementById('stat-hours-selected');
    const statCompleted = document.getElementById('stat-topics-completed');
    const statCompletedPct = document.getElementById('stat-completed-pct');

    if (statTopics) statTopics.textContent = `${selectedCount} / ${totalTopicsCount}`;
    if (statOutside) statOutside.textContent = `${outsideCount} topics outside goal`;
    if (statHours) statHours.textContent = `${totalHours} hrs`;

    const completedCount = TOPICS.filter(t => state.completedTopics.has(t.id)).length;
    const compPct = totalTopicsCount > 0 ? Math.round((completedCount / totalTopicsCount) * 100) : 0;
    if (statCompleted) statCompleted.textContent = `${completedCount} / ${totalTopicsCount}`;
    if (statCompletedPct) statCompletedPct.textContent = `${compPct}% completed`;

    // Render Grouped Accordion
    const accordionContainer = document.getElementById('subject-accordion-list');
    if (!accordionContainer) return;
    accordionContainer.innerHTML = '';

    const totalExamPriority = TOPICS.reduce((sum, t) => sum + (t.priority_score || 0), 0);

    SYLLABUS.forEach(subj => {
      const subjTopics = subj.topics || [];
      const totalInSubj = subjTopics.length;
      const completedInSubj = subjTopics.filter(t => state.completedTopics.has(t.id)).length;
      const progressPct = totalInSubj > 0 ? Math.round((completedInSubj / totalInSubj) * 100) : 0;
      const subjTotalPriority = subjTopics.reduce((sum, t) => {
        const info = TOPICS.find(x => x.id === t.id);
        return sum + (info ? (info.priority_score || 0) : 0);
      }, 0);

      const card = document.createElement('div');
      card.className = 'subject-group-card';

      card.innerHTML = `
        <div class="subject-header" data-subjid="${subj.id}">
          <div class="subject-title-area">
            <span class="subj-code">${subj.id}</span>
            <span class="subj-name">${subj.name}</span>
          </div>
          <div class="subj-progress-area">
            <div class="subj-progress-bar-wrap">
              <div class="subj-progress-bar-fill" style="width: ${progressPct}%;"></div>
            </div>
            <span class="subj-progress-text">${completedInSubj}/${totalInSubj} done</span>
          </div>
        </div>
        <div class="topic-pills-grid" id="topics-grid-${subj.id}"></div>
      `;

      accordionContainer.appendChild(card);

      const grid = card.querySelector(`#topics-grid-${subj.id}`);
      subjTopics.forEach(top => {
        const topInfo = TOPICS.find(t => t.id === top.id) || {};
        const isSelected = selectedSet.has(top.id);
        const isCompleted = state.completedTopics.has(top.id);
        const subList = top.subtopics || [];

        const topicExamPct = totalExamPriority > 0 ? (((topInfo.priority_score || 0) / totalExamPriority) * 100).toFixed(1) : '0.0';
        const topicSubjPct = subjTotalPriority > 0 ? (((topInfo.priority_score || 0) / subjTotalPriority) * 100).toFixed(1) : '0.0';
        const subWeights = computeSubtopicPercentages(top, subList);

        const visibleSubtopics = subList.filter(sub => {
          const isImp = isSubtopicImportant(sub);
          const isSubDone = state.completedSubtopics.has(sub);
          if (state.subtopicFilter === 'important' && !isImp) return false;
          if (state.subtopicFilter === 'pending' && isSubDone) return false;
          return true;
        });

        const isExpanded = state.allSubtopicsExpanded;

        const pill = document.createElement('div');
        pill.className = `topic-pill-card ${isSelected ? 'selected' : ''} ${isCompleted ? 'completed' : ''}`;
        pill.title = 'Click card to toggle selection in Study Plan';

        pill.innerHTML = `
          <div class="topic-card-top">
            <span class="topic-card-name">${top.name}</span>
            <div class="topic-card-actions" onclick="event.stopPropagation()">
              <button type="button" class="btn-practice-topic" data-subjid="${subj.id}" data-topicid="${top.id}" title="Practice ${top.name} questions now">
                Practice ➔
              </button>
              <label class="topic-checkbox-label" onclick="event.stopPropagation()">
                <input type="checkbox" class="topic-checkbox" ${isCompleted ? 'checked' : ''} style="accent-color: var(--status-correct); cursor: pointer;">
                Done
              </label>
            </div>
          </div>
          <div class="topic-meta-row">
            <span class="topic-badge-score" title="Yield score = Historical Marks / Study Hours">Score: ${topInfo.priority_score || '—'}</span>
            <span>•</span>
            <span class="topic-badge-weight" title="${topicExamPct}% of entire GATE CS exam">${topicExamPct}% Exam</span>
            <span>•</span>
            <span class="topic-badge-subjweight" title="${topicSubjPct}% of ${subj.name}">${topicSubjPct}% of ${subj.id}</span>
            <span>•</span>
            <span>${topInfo.estimated_hours || 20} hrs</span>
            <span>•</span>
            <span>${topInfo.question_count || 0} Qs</span>
          </div>

          <div class="subtopic-details-box" style="display: ${isExpanded ? 'flex' : 'none'};" onclick="event.stopPropagation()">
            <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); margin-bottom: 2px;">
              Subtopics (${visibleSubtopics.length} of ${subList.length}) — Topic Importance:
            </div>
            ${visibleSubtopics.map(sub => {
              const isImp = isSubtopicImportant(sub);
              const isSubDone = state.completedSubtopics.has(sub);
              const subPct = subWeights[sub] || Math.round(100 / Math.max(subList.length, 1));
              return `
                <div class="subtopic-item ${isImp ? 'is-important' : ''}">
                  <input type="checkbox" class="subtopic-checkbox" ${isSubDone ? 'checked' : ''} data-sub="${sub}" style="accent-color: var(--status-correct); cursor: pointer;">
                  <span style="${isSubDone ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${sub}</span>
                  <span class="subtopic-pct-tag" title="${subPct}% importance within ${top.name}">${subPct}%</span>
                  ${isImp ? '<span class="subtopic-imp-tag" title="Frequently tested GATE concept">⭐ High Priority</span>' : ''}
                  <button type="button" class="btn-subtopic-practice" data-subjid="${subj.id}" data-topicid="${top.id}" data-sub="${sub}" title="Practice questions matching '${sub}'">➔</button>
                </div>
              `;
            }).join('')}
          </div>
        `;

        // Direct Practice Topic button
        const btnPractice = pill.querySelector('.btn-practice-topic');
        if (btnPractice) {
          btnPractice.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateToTopicPractice(subj.id, top.id);
          });
        }

        // Direct Subtopic practice buttons
        pill.querySelectorAll('.btn-subtopic-practice').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sid = btn.dataset.subjid;
            const tid = btn.dataset.topicid;
            const sName = btn.dataset.sub;
            navigateToTopicPractice(sid, tid, sName);
          });
        });

        // Toggle selection
        pill.addEventListener('click', (e) => {
          if (e.target.closest('.subtopic-details-box') || e.target.closest('.topic-card-actions')) return;
          const currentlySelected = selectedSet.has(top.id);
          state.planOverrides[top.id] = !currentlySelected;
          setStorage(STORAGE_KEYS.PLAN_OVERRIDES, state.planOverrides);
          renderPlan();
        });

        // Toggle topic completion
        const cb = pill.querySelector('.topic-checkbox');
        cb.addEventListener('change', (e) => {
          if (e.target.checked) {
            state.completedTopics.add(top.id);
            addXp(100, 'Topic Mastered');
            triggerConfetti();
          } else {
            state.completedTopics.delete(top.id);
          }
          setStorage(STORAGE_KEYS.COMPLETED_TOPICS, Array.from(state.completedTopics));
          renderPlan();
          renderTodayMission();
        });

        // Toggle subtopic completion
        pill.querySelectorAll('.subtopic-checkbox').forEach(scb => {
          scb.addEventListener('change', (e) => {
            const sub = e.target.dataset.sub;
            if (e.target.checked) {
              state.completedSubtopics.add(sub);
            } else {
              state.completedSubtopics.delete(sub);
            }
            setStorage(STORAGE_KEYS.COMPLETED_SUBTOPICS, Array.from(state.completedSubtopics));
            renderPlan();
          });
        });

        grid.appendChild(pill);
      });
    });
  }

  // =========================================================================
  // 9. VISUAL MASTERY MAP (Constellation Skill Map)
  // =========================================================================
  function renderMasteryMap() {
    const grid = document.getElementById('mastery-nodes-grid');
    if (!grid) return;

    const totalExamPriority = TOPICS.reduce((sum, t) => sum + (t.priority_score || 0), 0);

    let html = '';
    SYLLABUS.forEach(subj => {
      const subjQs = QUESTIONS.filter(q => q.subject_id === subj.id || q.subject === subj.name);
      const totalQs = subjQs.length;

      let attempted = 0;
      let correct = 0;
      subjQs.forEach(q => {
        const sol = state.solvedQuestions[q.id];
        if (sol && sol.attempted) {
          attempted++;
          if (sol.correct) correct++;
        }
      });

      const acc = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
      let tier = 'beginner';
      let tierLabel = 'Beginner';

      if (attempted >= 15 && acc >= 80) {
        tier = 'exam-ready';
        tierLabel = 'Exam-Ready';
      } else if (attempted >= 10 && acc >= 65) {
        tier = 'strong';
        tierLabel = 'Strong';
      } else if (attempted >= 5 && acc >= 40) {
        tier = 'solid';
        tierLabel = 'Solid';
      }

      const subjTopics = subj.topics || [];
      const topicsHtml = subjTopics.map(t => {
        const topInfo = TOPICS.find(x => x.id === t.id) || {};
        const examPct = totalExamPriority > 0 ? (((topInfo.priority_score || 0) / totalExamPriority) * 100).toFixed(1) : '0.0';
        return `
          <div class="mastery-topic-pill" data-subjid="${subj.id}" data-topicid="${t.id}" title="Click to practice ${t.name} (${examPct}% of entire GATE exam)">
            <span class="mastery-topic-pill-name">${t.name}</span>
            <span class="mastery-topic-pill-pct">${examPct}%</span>
          </div>
        `;
      }).join('');

      html += `
        <div class="mastery-subject-card" data-subjid="${subj.id}" title="Click subject to practice its questions">
          <div class="mastery-top-row">
            <span class="mastery-code">${subj.id}</span>
            <span class="mastery-tier-badge ${tier}">${tierLabel}</span>
          </div>
          <div class="mastery-title">${subj.name}</div>
          <div class="mastery-progress-row">
            <div class="mastery-track">
              <div class="mastery-bar-fill" style="width: ${acc}%;"></div>
            </div>
            <span class="mastery-acc-label">${acc}% acc</span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">
            ${attempted} / ${totalQs} Qs attempted
          </div>
          <div class="mastery-topics-list">
            ${topicsHtml}
          </div>
        </div>
      `;
    });

    grid.innerHTML = html;

    // Attach click listeners to topic chips inside the card
    grid.querySelectorAll('.mastery-topic-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = pill.dataset.subjid;
        const tid = pill.dataset.topicid;
        navigateToTopicPractice(sid, tid);
      });
    });

    // Subject card click defaults to subject's first topic
    grid.querySelectorAll('.mastery-subject-card').forEach(card => {
      card.addEventListener('click', () => {
        const sid = card.dataset.subjid;
        navigateToTopicPractice(sid);
      });
    });
  }

  // =========================================================================
  // 10. TAB 3: TOPIC-WISE PYQs & PRACTICE SCREEN
  // =========================================================================
  function syncTopicDropdowns() {
    const subjSelect = document.getElementById('topic-subject-select');
    const topicSelect = document.getElementById('topic-topic-select');
    const subtopicSelect = document.getElementById('topic-subtopic-select');
    if (!subjSelect || !topicSelect) return;

    if (subjSelect.children.length === 0) {
      subjSelect.innerHTML = SYLLABUS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    if (state.topicMode.subject) {
      subjSelect.value = state.topicMode.subject;
    } else if (SYLLABUS.length > 0) {
      state.topicMode.subject = SYLLABUS[0].id;
      subjSelect.value = state.topicMode.subject;
    }

    const subj = SYLLABUS.find(s => s.id === state.topicMode.subject);
    if (subj && subj.topics) {
      topicSelect.innerHTML = subj.topics.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      if (state.topicMode.topic && subj.topics.some(t => t.id === state.topicMode.topic)) {
        topicSelect.value = state.topicMode.topic;
      } else if (subj.topics.length > 0) {
        state.topicMode.topic = subj.topics[0].id;
        topicSelect.value = state.topicMode.topic;
      }
    }

    if (subtopicSelect) {
      const top = subj ? (subj.topics || []).find(t => t.id === state.topicMode.topic) : null;
      const subs = top ? (top.subtopics || []) : [];
      subtopicSelect.innerHTML = '<option value="all">All Subtopics</option>' +
        subs.map(sb => {
          const isImp = isSubtopicImportant(sb);
          return `<option value="${sb}">${isImp ? '⭐ ' : ''}${sb}</option>`;
        }).join('');
      subtopicSelect.value = state.topicMode.subtopic || 'all';
    }
  }

  function navigateToTopicPractice(subjId, topicId = null, subtopic = 'all') {
    if (subjId) state.topicMode.subject = subjId;
    const subj = SYLLABUS.find(s => s.id === state.topicMode.subject);
    if (topicId) {
      state.topicMode.topic = topicId;
    } else if (subj && subj.topics && subj.topics.length > 0) {
      state.topicMode.topic = subj.topics[0].id;
    }
    state.topicMode.subtopic = subtopic || 'all';
    state.topicMode.isErrorMode = false;
    state.topicMode.isSpacedReviewMode = false;
    state.topicMode.currentIndex = 0;
    state.topicMode.justEvaluatedQid = null;
    state.topicMode.retakeQid = null;

    syncTopicDropdowns();
    loadTopicQuestions();
    switchTab('topic');
  }

  function initTopicTab() {
    const subjSelect = document.getElementById('topic-subject-select');
    const topicSelect = document.getElementById('topic-topic-select');
    const subtopicSelect = document.getElementById('topic-subtopic-select');
    const errorModeBtn = document.getElementById('btn-toggle-error-mode');

    if (!subjSelect || !topicSelect) return;

    syncTopicDropdowns();

    subjSelect.addEventListener('change', (e) => {
      state.topicMode.subject = e.target.value;
      const subj = SYLLABUS.find(s => s.id === state.topicMode.subject);
      state.topicMode.topic = subj && subj.topics && subj.topics[0] ? subj.topics[0].id : null;
      state.topicMode.subtopic = 'all';
      state.topicMode.isErrorMode = false;
      state.topicMode.isSpacedReviewMode = false;
      syncTopicDropdowns();
      loadTopicQuestions();
    });

    topicSelect.addEventListener('change', (e) => {
      state.topicMode.topic = e.target.value;
      state.topicMode.subtopic = 'all';
      state.topicMode.isErrorMode = false;
      state.topicMode.isSpacedReviewMode = false;
      syncTopicDropdowns();
      loadTopicQuestions();
    });

    if (subtopicSelect) {
      subtopicSelect.addEventListener('change', (e) => {
        state.topicMode.subtopic = e.target.value;
        loadTopicQuestions();
      });
    }

    if (errorModeBtn) {
      errorModeBtn.addEventListener('click', () => {
        state.topicMode.isErrorMode = !state.topicMode.isErrorMode;
        state.topicMode.isSpacedReviewMode = false;
        loadTopicQuestions();
      });
    }

    if (!state.topicMode.activeList || state.topicMode.activeList.length === 0) {
      loadTopicQuestions();
    }
  }

  function loadTopicQuestions() {
    const errorModeBtn = document.getElementById('btn-toggle-error-mode');
    const errorModeText = document.getElementById('error-mode-text');

    const wrongQids = Object.keys(state.solvedQuestions).filter(id => {
      const q = state.solvedQuestions[id];
      return q && q.attempted && !q.correct;
    });

    if (errorModeText) {
      errorModeText.textContent = state.topicMode.isErrorMode
        ? `Back to Topic Mode (${wrongQids.length} wrong)`
        : `Retry Wrong Answers (${wrongQids.length})`;
    }

    if (state.topicMode.isSpacedReviewMode) {
      const due = getSpacedReviewDueQuestions();
      state.topicMode.activeList = due;
      if (errorModeBtn) errorModeBtn.classList.add('active');
    } else if (state.topicMode.isErrorMode) {
      state.topicMode.activeList = QUESTIONS.filter(q => wrongQids.includes(q.id));
      if (errorModeBtn) errorModeBtn.classList.add('active');
    } else {
      let filtered = QUESTIONS.filter(q => q.topic === state.topicMode.topic);
      if (state.topicMode.subtopic && state.topicMode.subtopic !== 'all') {
        const needle = state.topicMode.subtopic.toLowerCase();
        const subKeywords = needle.split(/[,:;]|\band\b/).map(k => k.trim()).filter(k => k.length > 2);
        const matched = filtered.filter(q => {
          const hay = ((q.question || '') + ' ' + (q.options || []).join(' ') + ' ' + (q.explanation || '')).toLowerCase();
          if (hay.includes(needle)) return true;
          return subKeywords.some(kw => hay.includes(kw));
        });
        if (matched.length > 0) filtered = matched;
      }
      state.topicMode.activeList = filtered;
      if (errorModeBtn) errorModeBtn.classList.remove('active');
    }

    state.topicMode.currentIndex = 0;
    state.topicMode.justEvaluatedQid = null;
    state.topicMode.retakeQid = null;
    renderTopicPractice();
  }

  function renderTopicPractice() {
    const container = document.getElementById('topic-practice-container');
    if (!container) return;

    const list = state.topicMode.activeList;
    const totalCount = list.length;
    const curIdx = state.topicMode.currentIndex;

    let correctCount = 0;
    let wrongCount = 0;
    list.forEach(q => {
      const sol = state.solvedQuestions[q.id];
      if (sol && sol.attempted) {
        if (sol.correct) correctCount++;
        else wrongCount++;
      }
    });

    const attempted = correctCount + wrongCount;
    const acc = attempted > 0 ? Math.round((correctCount / attempted) * 100) : 0;

    const tTotal = document.getElementById('tstat-total');
    const tCorrect = document.getElementById('tstat-correct');
    const tWrong = document.getElementById('tstat-wrong');
    const tAcc = document.getElementById('tstat-accuracy');

    if (tTotal) tTotal.textContent = totalCount;
    if (tCorrect) tCorrect.textContent = correctCount;
    if (tWrong) tWrong.textContent = wrongCount;
    if (tAcc) tAcc.textContent = `${acc}%`;

    if (totalCount === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: var(--space-12);">
          <h3 style="margin-bottom: var(--space-2);">All Clear!</h3>
          <p style="color: var(--text-secondary);">${state.topicMode.isErrorMode ? 'Your Error Log has 0 wrong answers!' : 'No questions found for this topic filter.'}</p>
        </div>
      `;
      return;
    }

    const q = list[curIdx];
    const isBookmarked = state.bookmarkedQids.has(q.id);
    const existingSol = state.solvedQuestions[q.id] || null;
    const isJustEvaluated = state.topicMode.justEvaluatedQid === q.id;
    const isRetaking = state.topicMode.retakeQid === q.id;
    // Revisiting a wrong question (not just submitted right now) automatically resets its active inputs
    const isRevisitedWrong = !!(existingSol && existingSol.attempted && !existingSol.correct && !isJustEvaluated);
    const showEvaluation = !!(existingSol && existingSol.attempted && !isRevisitedWrong && !isRetaking);

    let inputHtml = '';
    const isImageQ = !!q.image;
    const effectiveOpts = (q.options && q.options.length > 0 && !isImageQ) ? q.options : ['A', 'B', 'C', 'D'];

    if (q.type === 'MCQ') {
      inputHtml = `
        <div class="options-list ${isImageQ ? 'image-options-row' : ''}" id="topic-options-list">
          ${effectiveOpts.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = showEvaluation && existingSol.studentAns === i;
            let revealClass = '';
            if (showEvaluation) {
              if (q.correct_answer.includes(i)) revealClass = 'correct-reveal';
              else if (isSelected && !existingSol.correct) revealClass = 'wrong-reveal';
            }
            const showText = !isImageQ && opt && opt !== letter && opt !== `(${letter})`;
            return `
              <div class="option-item ${isSelected ? 'selected' : ''} ${revealClass}" data-opt-idx="${i}">
                <span class="option-letter">${letter}</span>
                ${showText ? `<span class="option-text">${opt}</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (q.type === 'MSQ') {
      inputHtml = `
        <div class="options-list ${isImageQ ? 'image-options-row' : ''}" id="topic-options-list">
          ${effectiveOpts.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isChecked = showEvaluation && Array.isArray(existingSol.studentAns) && existingSol.studentAns.includes(i);
            let revealClass = '';
            if (showEvaluation) {
              if (q.correct_answer.includes(i)) revealClass = 'correct-reveal';
              else if (isChecked && !q.correct_answer.includes(i)) revealClass = 'wrong-reveal';
            }
            const showText = !isImageQ && opt && opt !== letter && opt !== `(${letter})`;
            return `
              <div class="option-item ${isChecked ? 'selected' : ''} ${revealClass}" data-opt-idx="${i}">
                <input type="checkbox" style="margin-right: ${showText ? '8px' : '4px'}; accent-color: var(--accent-amber);" ${isChecked ? 'checked' : ''} disabled>
                <span class="option-letter">${letter}</span>
                ${showText ? `<span class="option-text">${opt}</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (q.type === 'NAT') {
      const val = (showEvaluation && existingSol.studentAns !== undefined) ? existingSol.studentAns : '';
      inputHtml = `
        <div class="nat-input-wrapper">
          <label for="topic-nat-input" style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">Enter Numerical Value:</label>
          <input type="number" step="any" id="topic-nat-input" class="nat-input" value="${val}" placeholder="e.g. 15.5">
        </div>
      `;
    }

    let feedbackHtml = '';
    if (showEvaluation) {
      const isCor = existingSol.correct;
      let ansLabel = '';
      if (q.type === 'MCQ' || q.type === 'MSQ') {
        ansLabel = q.correct_answer.map(idx => String.fromCharCode(65 + idx)).join(', ');
      } else if (q.type === 'NAT') {
        ansLabel = q.correct_answer[0] === q.correct_answer[1]
          ? `${q.correct_answer[0]}`
          : `${q.correct_answer[0]} to ${q.correct_answer[1]}`;
      }

      feedbackHtml = `
        <div class="answer-feedback-box ${isCor ? 'correct' : 'incorrect'}">
          <div class="feedback-status-row" style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);">
            <span>${isCor ? '✅ Correct Answer!' : '❌ Incorrect'}</span>
            <button type="button" class="btn btn-secondary btn-xs btn-topic-retry-now" id="btn-topic-retry-now" title="Reset this question to try again fresh">
              🔄 ${isCor ? 'Retake Fresh' : 'Try Again'}
            </button>
          </div>
          <div class="feedback-key">Official Answer Key: <strong>${ansLabel}</strong></div>
          ${q.explanation ? `<div class="feedback-explanation"><strong>Explanation:</strong> ${q.explanation}</div>` : ''}
        </div>
      `;
    }

    const historyBannerHtml = buildHistoryBannerHtml(q, existingSol, isRevisitedWrong || isRetaking);
    const checkBtnLabel = showEvaluation ? 'Re-check' : 'Check Answer';

    container.innerHTML = `
      <div class="question-card" data-qid="${q.id}">
        <div class="q-header-meta">
          <div class="q-badge-group">
            <span class="q-badge">${q.paper || `GATE ${q.year}`}</span>
            <span class="q-badge">${q.type}</span>
            <span class="q-badge marks">${q.marks} Mark${q.marks > 1 ? 's' : ''}</span>
            <span class="q-badge">Q.${q.qno}</span>
            <span class="q-badge">${q.difficulty}</span>
          </div>
          <button class="q-bookmark-btn ${isBookmarked ? 'active' : ''}" id="btn-topic-bookmark" title="Bookmark Question [B]">
            ${isBookmarked ? '★' : '☆'}
          </button>
        </div>

        ${historyBannerHtml}

        <div class="q-statement">${q.question}</div>

        ${q.image ? `
          <div class="q-diagram-container">
            <img src="${q.image}" alt="Question Diagram" class="q-diagram-img" loading="lazy">
          </div>
        ` : ''}

        ${inputHtml}
        ${feedbackHtml}

        <div class="q-footer-actions">
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <button class="btn btn-secondary btn-sm" id="btn-topic-prev" ${curIdx === 0 ? 'disabled' : ''}>← Prev [P]</button>
            <span style="font-size: 0.8rem; font-family: var(--font-mono); color: var(--text-muted);">${curIdx + 1} of ${totalCount}</span>
            <button class="btn btn-secondary btn-sm" id="btn-topic-next" ${curIdx === totalCount - 1 ? 'disabled' : ''}>Next → [N]</button>
          </div>

          <div style="display: flex; align-items: center; gap: var(--space-4);">
            <div class="keyboard-shortcut-hint">
              <span class="kbd-chip">1-4</span> Pick
              <span class="kbd-chip">Enter</span> Check
            </div>
            <button class="btn btn-primary" id="btn-topic-check">${checkBtnLabel}</button>
          </div>
        </div>
      </div>
    `;

    // Bind History toggle
    const histHeader = container.querySelector('.q-history-header');
    if (histHeader) {
      histHeader.addEventListener('click', () => {
        const details = container.querySelector('.q-history-details');
        const btnToggle = histHeader.querySelector('.btn-toggle-history-details');
        const arrow = histHeader.querySelector('.history-arrow');
        if (details) {
          const isCollapsed = details.classList.toggle('collapsed');
          if (btnToggle) btnToggle.setAttribute('aria-expanded', String(!isCollapsed));
          if (arrow) arrow.textContent = isCollapsed ? '▼' : '▲';
        }
      });
    }

    // Bind immediate Try Again / Retake button
    const retryNowBtn = container.querySelector('#btn-topic-retry-now');
    if (retryNowBtn) {
      retryNowBtn.addEventListener('click', () => {
        state.topicMode.justEvaluatedQid = null;
        state.topicMode.retakeQid = q.id;
        renderTopicPractice();
      });
    }

    // Bind Option clicks
    if (q.type === 'MCQ') {
      const items = container.querySelectorAll('.option-item');
      items.forEach(item => {
        item.addEventListener('click', () => {
          items.forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
        });
      });
    } else if (q.type === 'MSQ') {
      const items = container.querySelectorAll('.option-item');
      items.forEach(item => {
        item.addEventListener('click', () => {
          item.classList.toggle('selected');
          const cb = item.querySelector('input[type="checkbox"]');
          if (cb) cb.checked = item.classList.contains('selected');
        });
      });
    }

    // Bookmark
    const bmBtn = container.querySelector('#btn-topic-bookmark');
    if (bmBtn) {
      bmBtn.addEventListener('click', () => {
        if (state.bookmarkedQids.has(q.id)) state.bookmarkedQids.delete(q.id);
        else state.bookmarkedQids.add(q.id);
        setStorage(STORAGE_KEYS.BOOKMARKS, Array.from(state.bookmarkedQids));
        renderTopicPractice();
      });
    }

    // Navigation
    const prevBtn = container.querySelector('#btn-topic-prev');
    const nextBtn = container.querySelector('#btn-topic-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.topicMode.currentIndex > 0) {
          state.topicMode.currentIndex--;
          state.topicMode.justEvaluatedQid = null;
          state.topicMode.retakeQid = null;
          renderTopicPractice();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.topicMode.currentIndex < totalCount - 1) {
          state.topicMode.currentIndex++;
          state.topicMode.justEvaluatedQid = null;
          state.topicMode.retakeQid = null;
          renderTopicPractice();
        }
      });
    }

    // Check Answer
    const checkBtn = container.querySelector('#btn-topic-check');
    if (checkBtn) {
      checkBtn.addEventListener('click', () => evaluateTopicAnswer(q));
    }
  }

  function evaluateTopicAnswer(q) {
    let studentAns = null;
    let isCorrect = false;

    if (q.type === 'MCQ') {
      const sel = document.querySelector('#topic-options-list .option-item.selected');
      if (!sel) {
        alert('Please select an option first.');
        return;
      }
      studentAns = parseInt(sel.dataset.optIdx, 10);
      isCorrect = q.correct_answer.includes(studentAns);
    } else if (q.type === 'MSQ') {
      const sels = document.querySelectorAll('#topic-options-list .option-item.selected');
      if (sels.length === 0) {
        alert('Please select at least one option.');
        return;
      }
      studentAns = Array.from(sels).map(el => parseInt(el.dataset.optIdx, 10)).sort();
      isCorrect = studentAns.length === q.correct_answer.length &&
                  studentAns.every((val, idx) => val === q.correct_answer[idx]);
    } else if (q.type === 'NAT') {
      const input = document.getElementById('topic-nat-input');
      if (!input || input.value.trim() === '') {
        alert('Please enter a numerical answer.');
        return;
      }
      const num = parseFloat(input.value.trim());
      if (isNaN(num)) {
        alert('Please enter a valid number.');
        return;
      }
      studentAns = num;
      const min = q.correct_answer[0];
      const max = q.correct_answer[1];
      isCorrect = num >= (min - 1e-4) && num <= (max + 1e-4);
    }

    recordQuestionAttempt(q, studentAns, isCorrect);

    // Update error mode button count live without wiping active list yet
    const errorModeText = document.getElementById('error-mode-text');
    if (errorModeText) {
      const wrongCountTotal = Object.values(state.solvedQuestions).filter(s => s && s.attempted && !s.correct).length;
      errorModeText.textContent = state.topicMode.isErrorMode
        ? `Back to Topic Mode (${wrongCountTotal} wrong)`
        : `Retry Wrong Answers (${wrongCountTotal})`;
    }

    state.topicMode.justEvaluatedQid = q.id;
    state.topicMode.retakeQid = null;

    renderTopicPractice();
    renderTodayMission();
  }

  // =========================================================================
  // 11. TAB 4: ALL PYQs ARCHIVE CONTROLLER
  // =========================================================================
  function initAllPyqsTab() {
    const searchInput = document.getElementById('all-search-input');
    const filterYear = document.getElementById('filter-year');
    const filterSub = document.getElementById('filter-subject');
    const filterType = document.getElementById('filter-type');
    const filterMarks = document.getElementById('filter-marks');
    const filterBm = document.getElementById('filter-bookmarked-only');
    const clearBtn = document.getElementById('btn-clear-filters');
    const toggleAnswersBtn = document.getElementById('btn-toggle-all-answers');

    if (filterYear) {
      const years = Array.from(new Set(QUESTIONS.map(q => q.year))).sort((a,b) => b - a);
      filterYear.innerHTML = '<option value="all">All Years (2011–2025)</option>' +
        years.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    if (filterSub) {
      filterSub.innerHTML = '<option value="all">All Subjects</option>' +
        SYLLABUS.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    }

    if (searchInput) {
      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.allPyqs.search = e.target.value.toLowerCase().trim();
          state.allPyqs.page = 1;
          renderAllQuestionsList();
        }, 200);
      });
    }

    if (filterYear) {
      filterYear.addEventListener('change', (e) => {
        state.allPyqs.year = e.target.value;
        state.allPyqs.page = 1;
        renderAllQuestionsList();
      });
    }

    if (filterSub) {
      filterSub.addEventListener('change', (e) => {
        state.allPyqs.subject = e.target.value;
        state.allPyqs.page = 1;
        renderAllQuestionsList();
      });
    }

    if (filterType) {
      filterType.addEventListener('change', (e) => {
        state.allPyqs.type = e.target.value;
        state.allPyqs.page = 1;
        renderAllQuestionsList();
      });
    }

    if (filterMarks) {
      filterMarks.addEventListener('change', (e) => {
        state.allPyqs.marks = e.target.value;
        state.allPyqs.page = 1;
        renderAllQuestionsList();
      });
    }

    if (filterBm) {
      filterBm.addEventListener('change', (e) => {
        state.allPyqs.bookmarkedOnly = e.target.checked;
        state.allPyqs.page = 1;
        renderAllQuestionsList();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.allPyqs.search = '';
        state.allPyqs.year = 'all';
        state.allPyqs.subject = 'all';
        state.allPyqs.type = 'all';
        state.allPyqs.marks = 'all';
        state.allPyqs.bookmarkedOnly = false;
        state.allPyqs.page = 1;

        if (searchInput) searchInput.value = '';
        if (filterYear) filterYear.value = 'all';
        if (filterSub) filterSub.value = 'all';
        if (filterType) filterType.value = 'all';
        if (filterMarks) filterMarks.value = 'all';
        if (filterBm) filterBm.checked = false;

        renderAllQuestionsList();
      });
    }

    if (toggleAnswersBtn) {
      toggleAnswersBtn.addEventListener('click', () => {
        state.allPyqs.showAnswersAll = !state.allPyqs.showAnswersAll;
        toggleAnswersBtn.textContent = state.allPyqs.showAnswersAll ? 'Hide All Answers' : 'Show All Answers';
        renderAllQuestionsList();
      });
    }
  }

  function getFilteredAllQuestions() {
    return QUESTIONS.filter(q => {
      if (state.allPyqs.year !== 'all' && q.year !== parseInt(state.allPyqs.year, 10)) return false;
      if (state.allPyqs.subject !== 'all' && q.subject !== state.allPyqs.subject) return false;
      if (state.allPyqs.type !== 'all' && q.type !== state.allPyqs.type) return false;
      if (state.allPyqs.marks !== 'all' && q.marks !== parseInt(state.allPyqs.marks, 10)) return false;
      if (state.allPyqs.bookmarkedOnly && !state.bookmarkedQids.has(q.id)) return false;
      if (state.allPyqs.search) {
        const text = (q.question + ' ' + (q.options || []).join(' ') + ' ' + q.id).toLowerCase();
        if (!text.includes(state.allPyqs.search)) return false;
      }
      return true;
    });
  }

  function renderAllQuestionsList() {
    const listContainer = document.getElementById('all-questions-list');
    const countLabel = document.getElementById('all-results-count');
    const topPag = document.getElementById('all-pagination-top');
    const botPag = document.getElementById('all-pagination-bottom');

    if (!listContainer) return;

    const filtered = getFilteredAllQuestions();
    const total = filtered.length;
    const pageSize = state.allPyqs.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const curPage = Math.min(state.allPyqs.page, totalPages);
    state.allPyqs.page = curPage;

    if (countLabel) countLabel.textContent = `Showing ${total.toLocaleString()} question${total !== 1 ? 's' : ''}`;

    const paginationHtml = buildPaginationHtml(curPage, totalPages);
    if (topPag) topPag.innerHTML = paginationHtml;
    if (botPag) botPag.innerHTML = paginationHtml;

    bindPaginationEvents(topPag);
    bindPaginationEvents(botPag);

    if (total === 0) {
      listContainer.innerHTML = '<div class="card" style="text-align: center; padding: var(--space-8); color: var(--text-muted);"><p>No questions matched your search criteria.</p></div>';
      return;
    }

    const startIdx = (curPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = filtered.slice(startIdx, endIdx);

    listContainer.innerHTML = pageItems.map(q => {
      const isBm = state.bookmarkedQids.has(q.id);
      const showAns = state.allPyqs.showAnswersAll;

      let ansText = '';
      if (q.type === 'MCQ' || q.type === 'MSQ') {
        ansText = q.correct_answer.map(idx => String.fromCharCode(65 + idx)).join(', ');
      } else if (q.type === 'NAT') {
        ansText = q.correct_answer[0] === q.correct_answer[1]
          ? `${q.correct_answer[0]}`
          : `${q.correct_answer[0]} to ${q.correct_answer[1]}`;
      }

      const existingSol = state.solvedQuestions[q.id] || null;
      const attempted = existingSol && existingSol.attempted;
      const isJustEvaluatedAll = state.allPyqs.justEvaluatedQids.has(q.id);
      const isRevisitedWrongAll = !!(attempted && !existingSol.correct && !isJustEvaluatedAll);
      const showAttemptStateAll = !!(attempted && !isRevisitedWrongAll);
      const isImageQ = !!q.image;
      const effectiveOpts = (q.options && q.options.length > 0 && !isImageQ) ? q.options : ['A', 'B', 'C', 'D'];

      let optionsHtml = '';
      if (q.type === 'MCQ') {
        optionsHtml = `
          <div class="options-list ${isImageQ ? 'image-options-row' : ''} all-q-options" data-qid="${q.id}" style="margin-top: var(--space-2);">
            ${effectiveOpts.map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              const isSelected = showAttemptStateAll && existingSol.studentAns === i;
              let revealClass = '';
              if (showAttemptStateAll) {
                if (q.correct_answer.includes(i)) revealClass = 'correct-reveal';
                else if (isSelected && !existingSol.correct) revealClass = 'wrong-reveal';
              } else if (showAns && q.correct_answer.includes(i)) {
                revealClass = 'correct-reveal';
              }
              const showText = !isImageQ && opt && opt !== letter && opt !== `(${letter})`;
              return `
                <div class="option-item ${isSelected ? 'selected' : ''} ${revealClass} all-opt-item" data-opt-idx="${i}" data-qid="${q.id}" title="Select Option ${letter}">
                  <span class="option-letter">${letter}</span>
                  ${showText ? `<span class="option-text">${opt}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else if (q.type === 'MSQ') {
        optionsHtml = `
          <div class="options-list ${isImageQ ? 'image-options-row' : ''} all-q-options" data-qid="${q.id}" style="margin-top: var(--space-2);">
            ${effectiveOpts.map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              const isChecked = showAttemptStateAll && Array.isArray(existingSol.studentAns) && existingSol.studentAns.includes(i);
              let revealClass = '';
              if (showAttemptStateAll) {
                if (q.correct_answer.includes(i)) revealClass = 'correct-reveal';
                else if (isChecked && !q.correct_answer.includes(i)) revealClass = 'wrong-reveal';
              } else if (showAns && q.correct_answer.includes(i)) {
                revealClass = 'correct-reveal';
              }
              const showText = !isImageQ && opt && opt !== letter && opt !== `(${letter})`;
              return `
                <div class="option-item ${isChecked ? 'selected' : ''} ${revealClass} all-msq-opt-item" data-opt-idx="${i}" data-qid="${q.id}">
                  <input type="checkbox" style="margin-right: ${showText ? '8px' : '4px'}; accent-color: var(--accent-amber);" ${isChecked ? 'checked' : ''} disabled>
                  <span class="option-letter">${letter}</span>
                  ${showText ? `<span class="option-text">${opt}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div style="margin-top: var(--space-2);">
            <button class="btn btn-secondary btn-xs btn-check-msq-all" data-qid="${q.id}">Check MSQ</button>
          </div>
        `;
      } else if (q.type === 'NAT') {
        const val = (showAttemptStateAll && existingSol.studentAns !== undefined) ? existingSol.studentAns : '';
        let natBadge = '';
        if (showAttemptStateAll) {
          natBadge = existingSol.correct
            ? '<span style="color: var(--status-correct); font-size: 0.85rem; font-weight: 600;">✅ Correct</span>'
            : '<span style="color: var(--status-wrong); font-size: 0.85rem; font-weight: 600;">❌ Incorrect</span>';
        }
        optionsHtml = `
          <div class="nat-input-wrapper" style="flex-direction: row; align-items: center; gap: 8px; margin-top: var(--space-2);">
            <input type="number" step="any" class="nat-input all-nat-input" data-qid="${q.id}" value="${val}" placeholder="Answer" style="width: 140px; padding: 6px 10px; font-size: 0.9rem;">
            <button class="btn btn-secondary btn-xs btn-check-nat-all" data-qid="${q.id}">Check</button>
            ${natBadge}
          </div>
        `;
      }

      let statusPill = '';
      if (attempted) {
        statusPill = existingSol.correct
          ? '<span style="color: var(--status-correct); font-size: 0.78rem; font-weight: 600; background: rgba(16, 185, 129, 0.12); padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid rgba(16, 185, 129, 0.25);">Solved</span>'
          : '<span style="color: var(--status-wrong); font-size: 0.78rem; font-weight: 600; background: rgba(239, 68, 68, 0.12); padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid rgba(239, 68, 68, 0.25);">Retry Reset</span>';
      }

      const historyBannerAll = buildHistoryBannerHtml(q, existingSol, isRevisitedWrongAll);

      return `
        <div class="q-summary-card" data-qid="${q.id}">
          <div class="q-summary-top">
            <div class="q-badge-group">
              <span class="q-badge">${q.paper || `GATE ${q.year}`}</span>
              <span class="q-badge">${q.type}</span>
              <span class="q-badge marks">${q.marks}M</span>
              <span class="q-badge">Q.${q.qno}</span>
              <span class="q-badge">${q.subject}</span>
              ${statusPill}
            </div>
            <button class="q-bookmark-btn ${isBm ? 'active' : ''}" data-bm-qid="${q.id}">
              ${isBm ? '★' : '☆'}
            </button>
          </div>

          ${historyBannerAll}

          <div class="q-summary-body">${q.question}</div>

          ${q.image ? `
            <div class="q-diagram-container">
              <img src="${q.image}" alt="Diagram" class="q-diagram-img" loading="lazy">
            </div>
          ` : ''}

          ${optionsHtml}

          <div class="q-summary-footer">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="ans-pill ${showAns ? '' : 'hidden'}" id="ans-${q.id}">
                Official Key: <strong>${ansText}</strong>
              </span>
              <button class="btn btn-secondary btn-xs btn-toggle-single-ans" data-target="ans-${q.id}">
                ${showAns ? 'Hide Key' : 'Reveal Key'}
              </button>
              ${isJustEvaluatedAll && !existingSol.correct ? `<button class="btn btn-secondary btn-xs btn-retry-all-q" data-qid="${q.id}">🔄 Try Again</button>` : ''}
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${q.difficulty}</span>
          </div>
        </div>
      `;
    }).join('');

    // History expand toggles inside All PYQs
    listContainer.querySelectorAll('.q-history-header').forEach(histHeader => {
      histHeader.addEventListener('click', () => {
        const banner = histHeader.closest('.q-history-banner');
        const details = banner ? banner.querySelector('.q-history-details') : null;
        const btnToggle = histHeader.querySelector('.btn-toggle-history-details');
        const arrow = histHeader.querySelector('.history-arrow');
        if (details) {
          const isCollapsed = details.classList.toggle('collapsed');
          if (btnToggle) btnToggle.setAttribute('aria-expanded', String(!isCollapsed));
          if (arrow) arrow.textContent = isCollapsed ? '▼' : '▲';
        }
      });
    });

    // Try Again button on All PYQs cards
    listContainer.querySelectorAll('.btn-retry-all-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const qid = btn.dataset.qid;
        state.allPyqs.justEvaluatedQids.delete(qid);
        renderAllQuestionsList();
      });
    });

    // Bookmarks in list
    listContainer.querySelectorAll('.q-bookmark-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qid = btn.dataset.bmQid;
        if (state.bookmarkedQids.has(qid)) state.bookmarkedQids.delete(qid);
        else state.bookmarkedQids.add(qid);
        setStorage(STORAGE_KEYS.BOOKMARKS, Array.from(state.bookmarkedQids));
        renderAllQuestionsList();
      });
    });

    // Reveal Key
    listContainer.querySelectorAll('.btn-toggle-single-ans').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetEl = document.getElementById(btn.dataset.target);
        if (targetEl) {
          targetEl.classList.toggle('hidden');
          btn.textContent = targetEl.classList.contains('hidden') ? 'Reveal Key' : 'Hide Key';
        }
      });
    });

    // Clickable MCQ options in All PYQs
    listContainer.querySelectorAll('.all-opt-item').forEach(optEl => {
      optEl.addEventListener('click', () => {
        const qid = optEl.dataset.qid;
        const optIdx = parseInt(optEl.dataset.optIdx, 10);
        const q = QUESTIONS.find(x => x.id === qid);
        if (!q) return;

        const isCorrect = q.correct_answer.includes(optIdx);
        recordQuestionAttempt(q, optIdx, isCorrect);
        state.allPyqs.justEvaluatedQids.add(qid);

        renderAllQuestionsList();
        renderTodayMission();
      });
    });

    // MSQ toggle and checking in All PYQs
    listContainer.querySelectorAll('.all-msq-opt-item').forEach(optEl => {
      optEl.addEventListener('click', () => {
        optEl.classList.toggle('selected');
        const cb = optEl.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = optEl.classList.contains('selected');
      });
    });

    listContainer.querySelectorAll('.btn-check-msq-all').forEach(checkBtn => {
      checkBtn.addEventListener('click', () => {
        const qid = checkBtn.dataset.qid;
        const q = QUESTIONS.find(x => x.id === qid);
        if (!q) return;

        const card = checkBtn.closest('.q-summary-card');
        const selectedEls = card.querySelectorAll('.all-msq-opt-item.selected');
        if (selectedEls.length === 0) {
          alert('Please select at least one option.');
          return;
        }

        const studentAns = Array.from(selectedEls).map(el => parseInt(el.dataset.optIdx, 10)).sort();
        const isCorrect = studentAns.length === q.correct_answer.length &&
                          studentAns.every((val, idx) => val === q.correct_answer[idx]);

        recordQuestionAttempt(q, studentAns, isCorrect);
        state.allPyqs.justEvaluatedQids.add(qid);

        renderAllQuestionsList();
        renderTodayMission();
      });
    });

    // NAT checking in All PYQs
    listContainer.querySelectorAll('.btn-check-nat-all').forEach(checkBtn => {
      checkBtn.addEventListener('click', () => {
        const qid = checkBtn.dataset.qid;
        const q = QUESTIONS.find(x => x.id === qid);
        if (!q) return;

        const card = checkBtn.closest('.q-summary-card');
        const input = card.querySelector('.all-nat-input');
        if (!input || input.value.trim() === '') {
          alert('Please enter a numerical answer.');
          return;
        }

        const num = parseFloat(input.value.trim());
        if (isNaN(num)) {
          alert('Please enter a valid number.');
          return;
        }

        const min = q.correct_answer[0];
        const max = q.correct_answer[1];
        const isCorrect = num >= (min - 1e-4) && num <= (max + 1e-4);

        recordQuestionAttempt(q, num, isCorrect);
        state.allPyqs.justEvaluatedQids.add(qid);

        renderAllQuestionsList();
        renderTodayMission();
      });
    });
  }

  function buildPaginationHtml(cur, total) {
    if (total <= 1) return '';
    let pages = [];
    pages.push(1);
    for (let i = Math.max(2, cur - 2); i <= Math.min(total - 1, cur + 2); i++) pages.push(i);
    if (total > 1 && !pages.includes(total)) pages.push(total);

    let html = `<button class="btn-page ${cur === 1 ? 'disabled' : ''}" data-p="${cur - 1}">←</button>`;
    let last = 0;
    pages.forEach(p => {
      if (last && p - last > 1) html += '<span style="padding: 0 4px; color: var(--text-muted);">…</span>';
      html += `<button class="btn-page ${p === cur ? 'active' : ''}" data-p="${p}">${p}</button>`;
      last = p;
    });
    html += `<button class="btn-page ${cur === total ? 'disabled' : ''}" data-p="${cur + 1}">→</button>`;
    return html;
  }

  function bindPaginationEvents(container) {
    if (!container) return;
    container.querySelectorAll('.btn-page').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.p, 10);
        if (p && !btn.classList.contains('disabled')) {
          state.allPyqs.page = p;
          state.allPyqs.justEvaluatedQids.clear();
          renderAllQuestionsList();
          window.scrollTo({ top: 320, behavior: 'smooth' });
        }
      });
    });
  }

  // =========================================================================
  // 12. TAB 5: MOCK TEST SIMULATOR & RESULTS
  // =========================================================================
  function initMockTab() {
    const subPicker = document.getElementById('mock-subject-picker');
    if (subPicker) {
      subPicker.innerHTML = SYLLABUS.map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join('');
    }

    document.querySelectorAll('.btn-start-mock').forEach(btn => {
      btn.addEventListener('click', () => startMockTest(btn.dataset.mode));
    });

    const clearHistBtn = document.getElementById('btn-clear-history');
    if (clearHistBtn) {
      clearHistBtn.addEventListener('click', () => {
        if (confirm('Clear past mock test attempts?')) {
          state.mockHistory = [];
          setStorage(STORAGE_KEYS.MOCK_HISTORY, []);
          renderMockHistory();
        }
      });
    }

    // Modal Submit
    const promptSubmitBtn = document.getElementById('btn-submit-mock-prompt');
    const modal = document.getElementById('modal-submit-confirm');
    const cancelSubmitBtn = document.getElementById('btn-cancel-submit');
    const confirmSubmitBtn = document.getElementById('btn-confirm-submit');

    if (promptSubmitBtn && modal) {
      promptSubmitBtn.addEventListener('click', () => {
        updateSubmitModalCounts();
        modal.classList.remove('hidden');
      });
    }
    if (cancelSubmitBtn && modal) {
      cancelSubmitBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }
    if (confirmSubmitBtn && modal) {
      confirmSubmitBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        submitMockTest();
      });
    }

    // Mock Active Navigation
    const prevBtn = document.getElementById('btn-mock-prev');
    const nextBtn = document.getElementById('btn-mock-save-next');
    const clearBtn = document.getElementById('btn-mock-clear');
    const markReviewBtn = document.getElementById('btn-mock-mark-review');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.mockTest.currentIndex > 0) {
          saveCurrentMockAnswer(false);
          state.mockTest.currentIndex--;
          renderMockQuestion();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        saveCurrentMockAnswer(false);
        if (state.mockTest.currentIndex < state.mockTest.questions.length - 1) {
          state.mockTest.currentIndex++;
          renderMockQuestion();
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', clearCurrentMockAnswer);
    }
    if (markReviewBtn) {
      markReviewBtn.addEventListener('click', () => {
        saveCurrentMockAnswer(true);
        if (state.mockTest.currentIndex < state.mockTest.questions.length - 1) {
          state.mockTest.currentIndex++;
          renderMockQuestion();
        }
      });
    }

    // Section switchers
    const secTabs = document.querySelectorAll('#mock-section-tabs .sec-btn');
    secTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const sec = tab.dataset.sec;
        state.mockTest.activeSection = sec;
        secTabs.forEach(t => t.classList.toggle('active', t.dataset.sec === sec));
        const firstIdx = state.mockTest.questions.findIndex(q => q.section === sec);
        if (firstIdx !== -1) {
          state.mockTest.currentIndex = firstIdx;
          renderMockQuestion();
        }
      });
    });

    const retakeBtn = document.getElementById('btn-retake-mock');
    const lobbyBtn = document.getElementById('btn-back-to-lobby');
    if (retakeBtn) {
      retakeBtn.addEventListener('click', () => {
        document.getElementById('mock-results').classList.add('hidden');
        document.getElementById('mock-lobby').classList.remove('hidden');
      });
    }
    if (lobbyBtn) {
      lobbyBtn.addEventListener('click', () => {
        document.getElementById('mock-results').classList.add('hidden');
        document.getElementById('mock-lobby').classList.remove('hidden');
      });
    }

    renderMockHistory();
  }

  function renderMockLobby() {
    renderMockHistory();
  }

  function renderMockHistory() {
    const histContainer = document.getElementById('mock-history-list');
    if (!histContainer) return;
    const history = state.mockHistory || [];

    if (history.length === 0) {
      histContainer.innerHTML = '<p style="font-size: 0.88rem; color: var(--text-muted);">No mock tests taken yet. Start your first simulator above!</p>';
      return;
    }

    histContainer.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="dashboard-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Mode</th>
              <th>Score</th>
              <th>Accuracy</th>
              <th>Time Taken</th>
            </tr>
          </thead>
          <tbody>
            ${history.map(h => `
              <tr>
                <td>${new Date(h.date).toLocaleDateString()}</td>
                <td><strong>${h.title}</strong></td>
                <td><span style="color: var(--accent-amber); font-weight: 700;">${h.score}</span> / ${h.totalMarks}</td>
                <td>${h.accuracy}%</td>
                <td>${h.timeSpent}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function startMockTest(mode) {
    const subPicker = document.getElementById('mock-subject-picker');
    const selectedSubjId = subPicker ? subPicker.value : 'PDS';
    const mockQuestions = generateMockQuestions(mode, selectedSubjId);

    if (mockQuestions.length === 0) {
      alert('Question pool is currently too small for this test mode.');
      return;
    }

    let durationSec = 180 * 60;
    let mockTitle = 'GATE CS Full Mock Test';
    if (mode === 'subject') {
      durationSec = 45 * 60;
      const sObj = SYLLABUS.find(s => s.id === selectedSubjId);
      mockTitle = `${sObj ? sObj.name : selectedSubjId} Mini Mock`;
    } else if (mode === 'plan') {
      durationSec = 60 * 60;
      mockTitle = 'Plan Topics Practice Mock';
    }

    const responses = {};
    mockQuestions.forEach((q, idx) => {
      responses[idx] = {
        selectedOption: null,
        selectedCheckboxes: [],
        natValue: '',
        status: 'not-visited'
      };
    });

    state.mockTest = {
      active: true,
      mode: mode,
      title: mockTitle,
      questions: mockQuestions,
      responses: responses,
      currentIndex: 0,
      activeSection: mockQuestions[0].section || 'CS',
      timeLeft: durationSec,
      timerInterval: null,
      startTime: Date.now(),
      endTime: null
    };

    document.getElementById('mock-lobby').classList.add('hidden');
    document.getElementById('mock-results').classList.add('hidden');
    document.getElementById('mock-active').classList.remove('hidden');

    const titleEl = document.getElementById('mock-active-title');
    if (titleEl) titleEl.textContent = mockTitle;

    startMockTimer();
    renderMockQuestion();
  }

  function generateMockQuestions(mode, subjId) {
    const gaQs = QUESTIONS.filter(q => q.subject_id === 'GA' || q.subject === 'General Aptitude');
    const csQs = QUESTIONS.filter(q => q.subject_id !== 'GA' && q.subject !== 'General Aptitude');

    function shuffle(arr) {
      return [...arr].sort(() => Math.random() - 0.5);
    }

    if (mode === 'full') {
      const ga1 = shuffle(gaQs.filter(q => q.marks === 1)).slice(0, 5);
      const ga2 = shuffle(gaQs.filter(q => q.marks === 2)).slice(0, 5);
      const cs1 = shuffle(csQs.filter(q => q.marks === 1)).slice(0, 25);
      const cs2 = shuffle(csQs.filter(q => q.marks === 2)).slice(0, 30);

      const gaAll = [...ga1, ...ga2].map(q => ({ ...q, section: 'GA' }));
      const csAll = [...cs1, ...cs2].map(q => ({ ...q, section: 'CS' }));
      return [...gaAll, ...csAll];
    } else if (mode === 'subject') {
      const targetQs = csQs.filter(q => q.subject_id === subjId);
      const s1 = shuffle(targetQs.filter(q => q.marks === 1)).slice(0, 10);
      const s2 = shuffle(targetQs.filter(q => q.marks === 2)).slice(0, 10);
      return [...s1, ...s2].map(q => ({ ...q, section: 'CS' }));
    } else if (mode === 'plan') {
      const { selectedSet } = computeSelectedTopics();
      const planQs = csQs.filter(q => selectedSet.has(q.topic));
      return shuffle(planQs).slice(0, 30).map(q => ({ ...q, section: 'CS' }));
    }
    return [];
  }

  function startMockTimer() {
    clearInterval(state.mockTest.timerInterval);
    updateTimerDisplay();

    state.mockTest.timerInterval = setInterval(() => {
      state.mockTest.timeLeft--;
      updateTimerDisplay();

      if (state.mockTest.timeLeft <= 0) {
        clearInterval(state.mockTest.timerInterval);
        alert('Time is up! Submitting exam automatically.');
        submitMockTest();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const timerEl = document.getElementById('mock-countdown-timer');
    if (!timerEl) return;
    const s = state.mockTest.timeLeft;
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    timerEl.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }

  function renderMockQuestion() {
    const { questions, currentIndex, responses } = state.mockTest;
    const q = questions[currentIndex];
    const resp = responses[currentIndex];

    if (resp.status === 'not-visited') resp.status = 'not-answered';

    const secTabs = document.querySelectorAll('#mock-section-tabs .sec-btn');
    secTabs.forEach(t => t.classList.toggle('active', t.dataset.sec === q.section));

    document.getElementById('mock-current-qnum').textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    document.getElementById('mock-current-type').textContent = q.type;
    document.getElementById('mock-current-marks').textContent = `${q.marks} Mark${q.marks > 1 ? 's' : ''}`;
    document.getElementById('mock-current-sub').textContent = `${q.subject} (${q.section})`;

    const contentArea = document.getElementById('mock-question-content');
    if (!contentArea) return;

    let inputHtml = '';
    const isImageQ = !!q.image;
    const effectiveOpts = (q.options && q.options.length > 0 && !isImageQ) ? q.options : ['A', 'B', 'C', 'D'];

    if (q.type === 'MCQ') {
      inputHtml = `
        <div class="options-list ${isImageQ ? 'image-options-row' : ''}" id="mock-options-list">
          ${effectiveOpts.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = resp.selectedOption === i;
            const showText = !isImageQ && opt && opt !== letter && opt !== `(${letter})`;
            return `
              <div class="option-item ${isSelected ? 'selected' : ''}" data-opt-idx="${i}">
                <span class="option-letter">${letter}</span>
                ${showText ? `<span class="option-text">${opt}</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (q.type === 'MSQ') {
      inputHtml = `
        <div class="options-list ${isImageQ ? 'image-options-row' : ''}" id="mock-options-list">
          ${effectiveOpts.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isChecked = resp.selectedCheckboxes.includes(i);
            const showText = !isImageQ && opt && opt !== letter && opt !== `(${letter})`;
            return `
              <div class="option-item ${isChecked ? 'selected' : ''}" data-opt-idx="${i}">
                <input type="checkbox" style="margin-right: ${showText ? '8px' : '4px'}; accent-color: var(--accent-amber);" ${isChecked ? 'checked' : ''} disabled>
                <span class="option-letter">${letter}</span>
                ${showText ? `<span class="option-text">${opt}</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (q.type === 'NAT') {
      inputHtml = `
        <div class="nat-input-wrapper">
          <label for="mock-nat-input" style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">Enter Numerical Answer:</label>
          <input type="number" step="any" id="mock-nat-input" class="nat-input" value="${resp.natValue || ''}" placeholder="e.g. 24.5">
        </div>
      `;
    }

    contentArea.innerHTML = `
      <div class="q-statement" style="margin-bottom: var(--space-4);">${q.question}</div>
      ${q.image ? `
        <div class="q-diagram-container" style="margin-bottom: var(--space-4);">
          <img src="${q.image}" alt="Diagram" class="q-diagram-img">
        </div>
      ` : ''}
      ${inputHtml}
    `;

    // Bind option selections
    if (q.type === 'MCQ') {
      contentArea.querySelectorAll('.option-item').forEach(item => {
        item.addEventListener('click', () => {
          contentArea.querySelectorAll('.option-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          resp.selectedOption = parseInt(item.dataset.optIdx, 10);
        });
      });
    } else if (q.type === 'MSQ') {
      contentArea.querySelectorAll('.option-item').forEach(item => {
        item.addEventListener('click', () => {
          item.classList.toggle('selected');
          const idx = parseInt(item.dataset.optIdx, 10);
          const cb = item.querySelector('input[type="checkbox"]');
          if (item.classList.contains('selected')) {
            if (!resp.selectedCheckboxes.includes(idx)) resp.selectedCheckboxes.push(idx);
          } else {
            resp.selectedCheckboxes = resp.selectedCheckboxes.filter(i => i !== idx);
          }
          if (cb) cb.checked = item.classList.contains('selected');
        });
      });
    } else if (q.type === 'NAT') {
      const input = document.getElementById('mock-nat-input');
      if (input) {
        input.addEventListener('input', (e) => {
          resp.natValue = e.target.value.trim();
        });
      }
    }

    renderMockPalette();
  }

  function saveCurrentMockAnswer(isMarkForReview) {
    const { questions, currentIndex, responses } = state.mockTest;
    const q = questions[currentIndex];
    const resp = responses[currentIndex];

    let hasAnswered = false;
    if (q.type === 'MCQ') {
      hasAnswered = resp.selectedOption !== null && resp.selectedOption !== undefined;
    } else if (q.type === 'MSQ') {
      hasAnswered = resp.selectedCheckboxes.length > 0;
    } else if (q.type === 'NAT') {
      hasAnswered = resp.natValue !== '' && !isNaN(parseFloat(resp.natValue));
    }

    if (isMarkForReview) {
      resp.status = hasAnswered ? 'answered-marked' : 'marked';
    } else {
      resp.status = hasAnswered ? 'answered' : 'not-answered';
    }
    renderMockPalette();
  }

  function clearCurrentMockAnswer() {
    const { questions, currentIndex, responses } = state.mockTest;
    const q = questions[currentIndex];
    const resp = responses[currentIndex];

    resp.selectedOption = null;
    resp.selectedCheckboxes = [];
    resp.natValue = '';
    resp.status = 'not-answered';
    renderMockQuestion();
  }

  function renderMockPalette() {
    const grid = document.getElementById('mock-palette-grid');
    if (!grid) return;
    const { questions, currentIndex, responses } = state.mockTest;

    grid.innerHTML = questions.map((q, idx) => {
      const resp = responses[idx];
      const isCur = idx === currentIndex;
      let statusClass = resp.status;
      if (statusClass === 'answered-marked') statusClass = 'marked';

      return `
        <button class="palette-btn ${statusClass} ${isCur ? 'active' : ''}" data-idx="${idx}">
          ${idx + 1}
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        saveCurrentMockAnswer(false);
        state.mockTest.currentIndex = parseInt(btn.dataset.idx, 10);
        renderMockQuestion();
      });
    });
  }

  function updateSubmitModalCounts() {
    const { responses, questions } = state.mockTest;
    let ans = 0;
    let unans = 0;
    let marked = 0;

    questions.forEach((q, idx) => {
      const st = responses[idx].status;
      if (st === 'answered') ans++;
      else if (st === 'marked' || st === 'answered-marked') marked++;
      else unans++;
    });

    document.getElementById('modal-ans-count').textContent = ans;
    document.getElementById('modal-unans-count').textContent = unans;
    document.getElementById('modal-marked-count').textContent = marked;
  }

  function submitMockTest() {
    clearInterval(state.mockTest.timerInterval);
    state.mockTest.active = false;
    state.mockTest.endTime = Date.now();

    const { questions, responses, startTime, endTime, title } = state.mockTest;
    const timeSpentSec = Math.round((endTime - startTime) / 1000);
    const hrs = Math.floor(timeSpentSec / 3600);
    const mins = Math.floor((timeSpentSec % 3600) / 60);
    const timeSpentStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m ${timeSpentSec % 60}s`;

    let totalScore = 0;
    let maxMarks = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let attemptedCount = 0;

    const reviewItems = [];
    const secStats = {
      GA: { total: 0, attempted: 0, correct: 0, wrong: 0, penalty: 0, score: 0 },
      CS: { total: 0, attempted: 0, correct: 0, wrong: 0, penalty: 0, score: 0 }
    };
    const topicStats = {};

    questions.forEach((q, idx) => {
      const resp = responses[idx];
      maxMarks += q.marks;
      const sec = q.section || 'CS';
      secStats[sec].total++;

      if (!topicStats[q.topic]) topicStats[q.topic] = { name: q.topic, total: 0, correct: 0, wrong: 0 };
      topicStats[q.topic].total++;

      let isAttempted = false;
      let isCorrect = false;
      let marksAwarded = 0;

      if (q.type === 'MCQ') {
        if (resp.selectedOption !== null && resp.selectedOption !== undefined) {
          isAttempted = true;
          isCorrect = q.correct_answer.includes(resp.selectedOption);
          if (isCorrect) marksAwarded = q.marks;
          else marksAwarded = -(q.marks === 1 ? (1/3) : (2/3));
        }
      } else if (q.type === 'MSQ') {
        if (resp.selectedCheckboxes.length > 0) {
          isAttempted = true;
          const userAns = [...resp.selectedCheckboxes].sort();
          isCorrect = userAns.length === q.correct_answer.length &&
                      userAns.every((v, i) => v === q.correct_answer[i]);
          if (isCorrect) marksAwarded = q.marks;
          else marksAwarded = 0; // No penalty for MSQ
        }
      } else if (q.type === 'NAT') {
        if (resp.natValue !== '' && !isNaN(parseFloat(resp.natValue))) {
          isAttempted = true;
          const val = parseFloat(resp.natValue);
          isCorrect = val >= (q.correct_answer[0] - 1e-4) && val <= (q.correct_answer[1] + 1e-4);
          if (isCorrect) marksAwarded = q.marks;
          else marksAwarded = 0; // No penalty for NAT
        }
      }

      if (isAttempted) {
        attemptedCount++;
        secStats[sec].attempted++;
        if (isCorrect) {
          correctCount++;
          secStats[sec].correct++;
          topicStats[q.topic].correct++;
        } else {
          wrongCount++;
          secStats[sec].wrong++;
          topicStats[q.topic].wrong++;
          if (marksAwarded < 0) secStats[sec].penalty += Math.abs(marksAwarded);
        }
      }

      totalScore += marksAwarded;
      secStats[sec].score += marksAwarded;

      reviewItems.push({
        question: q,
        response: resp,
        isAttempted,
        isCorrect,
        marksAwarded
      });
    });

    totalScore = Math.max(0, Math.round(totalScore * 100) / 100);
    const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 100) : 0;

    // Save Mock Attempt
    const attemptRecord = {
      id: `MOCK_${Date.now()}`,
      title: title,
      date: new Date().toISOString(),
      score: totalScore,
      totalMarks: maxMarks,
      accuracy: accuracy,
      attempted: attemptedCount,
      totalQuestions: questions.length,
      timeSpent: timeSpentStr
    };

    state.mockHistory.unshift(attemptRecord);
    setStorage(STORAGE_KEYS.MOCK_HISTORY, state.mockHistory);
    addXp(250, 'Completed Full Mock Test');
    triggerConfetti();

    // Render Results Screen
    renderMockResultsScreen(attemptRecord, secStats, topicStats, reviewItems);
  }

  function renderMockResultsScreen(record, secStats, topicStats, reviewItems) {
    document.getElementById('mock-active').classList.add('hidden');
    document.getElementById('mock-results').classList.remove('hidden');

    document.getElementById('res-test-title').textContent = record.title;
    document.getElementById('res-total-score').textContent = record.score;
    document.getElementById('res-accuracy').textContent = `${record.accuracy}%`;
    document.getElementById('res-attempted').textContent = `${record.attempted} / ${record.totalQuestions}`;
    document.getElementById('res-time-spent').textContent = record.timeSpent;

    // Section Breakdown Table
    const tbody = document.getElementById('res-breakdown-tbody');
    if (tbody) {
      tbody.innerHTML = Object.keys(secStats).map(sec => {
        const st = secStats[sec];
        const label = sec === 'GA' ? 'General Aptitude (GA)' : 'Computer Science (CS)';
        return `
          <tr>
            <td><strong>${label}</strong></td>
            <td>${st.total}</td>
            <td>${st.attempted}</td>
            <td><span style="color: var(--status-correct); font-weight: 700;">${st.correct}</span></td>
            <td><span style="color: var(--status-wrong); font-weight: 700;">${st.wrong}</span></td>
            <td>-${Math.round(st.penalty * 100) / 100}</td>
            <td><strong style="color: var(--accent-amber);">${Math.round(st.score * 100) / 100}</strong></td>
          </tr>
        `;
      }).join('');
    }

    // Topic Performance Grid
    const topicGrid = document.getElementById('res-topic-performance-grid');
    if (topicGrid) {
      topicGrid.innerHTML = Object.keys(topicStats).map(tid => {
        const st = topicStats[tid];
        const acc = st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;
        const isWeak = acc < 50;
        return `
          <div class="card" style="padding: 12px; border-color: ${isWeak ? 'var(--status-wrong-border)' : 'var(--border-subtle)'}; background: ${isWeak ? 'var(--status-wrong-soft)' : 'var(--bg-surface)'};">
            <div style="font-weight: 600; font-size: 0.88rem; margin-bottom: 4px;">${tid.replace(/_/g, ' ')}</div>
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: var(--font-mono); color: var(--text-secondary);">
              <span>${st.correct}/${st.total} correct</span>
              <span style="font-weight: 700; color: ${isWeak ? 'var(--status-wrong)' : 'var(--status-correct)'};">${acc}%</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // Full Review list
    const reviewList = document.getElementById('res-review-questions-list');
    if (reviewList) {
      function renderItems(filter) {
        const filtered = reviewItems.filter(item => {
          if (filter === 'wrong') return item.isAttempted && !item.isCorrect;
          if (filter === 'unattempted') return !item.isAttempted;
          return true;
        });

        reviewList.innerHTML = filtered.map((item, i) => {
          const q = item.question;
          let statusBadge = '<span class="q-badge" style="background: var(--bg-elevated);">Unattempted</span>';
          if (item.isAttempted) {
            statusBadge = item.isCorrect
              ? '<span class="q-badge" style="background: var(--status-correct-soft); color: var(--status-correct);">Correct (+ ' + item.marksAwarded + ')</span>'
              : '<span class="q-badge" style="background: var(--status-wrong-soft); color: var(--status-wrong);">Wrong (' + item.marksAwarded + ')</span>';
          }

          let ansKeyText = '';
          if (q.type === 'MCQ' || q.type === 'MSQ') ansKeyText = q.correct_answer.map(idx => String.fromCharCode(65 + idx)).join(', ');
          else ansKeyText = `${q.correct_answer[0]} to ${q.correct_answer[1]}`;

          return `
            <div class="q-summary-card" style="margin-top: var(--space-4);">
              <div class="q-summary-top">
                <div class="q-badge-group">
                  <span class="q-badge">Q.${i + 1}</span>
                  <span class="q-badge">${q.type}</span>
                  <span class="q-badge marks">${q.marks}M</span>
                  <span class="q-badge">${q.subject}</span>
                </div>
                ${statusBadge}
              </div>

              <div class="q-summary-body">${q.question}</div>
              ${q.image ? `<div class="q-diagram-container"><img src="${q.image}" class="q-diagram-img"></div>` : ''}

              <div class="feedback-key" style="margin-top: 6px;">
                Official Answer Key: <strong>${ansKeyText}</strong>
              </div>
            </div>
          `;
        }).join('');
      }

      renderItems('all');

      document.querySelectorAll('#mock-results .btn-preset-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#mock-results .btn-preset-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderItems(btn.dataset.rf);
        });
      });
    }
  }

  function showDemoMockResults() {
    switchTab('mock');
    document.getElementById('mock-lobby').classList.add('hidden');
    document.getElementById('mock-active').classList.add('hidden');

    const sampleRecord = {
      id: 'MOCK_DEMO',
      title: 'GATE CS Full Mock Simulator #1',
      date: new Date().toISOString(),
      score: 71.67,
      totalMarks: 100,
      accuracy: 82.5,
      attempted: 58,
      totalQuestions: 65,
      timeSpent: '2h 42m'
    };

    const secStats = {
      GA: { total: 10, attempted: 9, correct: 8, wrong: 1, penalty: 0.33, score: 13.67 },
      CS: { total: 55, attempted: 49, correct: 41, wrong: 8, penalty: 3.33, score: 58.00 }
    };

    const topicStats = {
      data_structures: { name: 'Data Structures', total: 12, correct: 11, wrong: 1 },
      boolean_algebra_circuits: { name: 'Digital Logic', total: 6, correct: 5, wrong: 1 },
      asymptotic_complexity: { name: 'Algorithms', total: 8, correct: 7, wrong: 1 },
      processes_threads_concurrency: { name: 'Operating Systems', total: 8, correct: 5, wrong: 3 },
      er_relational_model: { name: 'Databases', total: 7, correct: 6, wrong: 1 },
      network_layer: { name: 'Computer Networks', total: 6, correct: 3, wrong: 3 }
    };

    const sampleReview = QUESTIONS.slice(0, 15).map((q, idx) => ({
      question: q,
      response: { selectedOption: idx % 2 === 0 ? q.correct_answer[0] : (q.correct_answer[0] + 1) % 4 },
      isAttempted: true,
      isCorrect: idx % 2 === 0,
      marksAwarded: idx % 2 === 0 ? q.marks : -(q.marks === 1 ? 0.33 : 0.67)
    }));

    renderMockResultsScreen(sampleRecord, secStats, topicStats, sampleReview);
  }

  // =========================================================================
  // 13. FOCUS MODE & POMODORO TIMER
  // =========================================================================
  function initFocusModeAndPomodoro() {
    const quickBtn = document.getElementById('btn-quick-focus');
    const mobileQuickBtn = document.getElementById('mobile-btn-quick-focus');
    const exitBtn = document.getElementById('btn-exit-focus');
    const togglePomoBtn = document.getElementById('btn-pomodoro-toggle');
    const resetPomoBtn = document.getElementById('btn-pomodoro-reset');

    if (quickBtn) {
      quickBtn.addEventListener('click', () => enterFocusMode());
    }
    if (mobileQuickBtn) {
      mobileQuickBtn.addEventListener('click', () => enterFocusMode());
    }
    if (exitBtn) {
      exitBtn.addEventListener('click', () => exitFocusMode());
    }
    if (togglePomoBtn) {
      togglePomoBtn.addEventListener('click', () => {
        state.pomodoro.isRunning = !state.pomodoro.isRunning;
        togglePomoBtn.textContent = state.pomodoro.isRunning ? 'Pause' : 'Resume';
        if (state.pomodoro.isRunning) runPomodoro();
        else clearInterval(state.pomodoro.interval);
      });
    }
    if (resetPomoBtn) {
      resetPomoBtn.addEventListener('click', () => {
        clearInterval(state.pomodoro.interval);
        state.pomodoro.isRunning = false;
        state.pomodoro.timeLeft = 25 * 60;
        updatePomodoroDisplay();
        if (togglePomoBtn) togglePomoBtn.textContent = 'Start';
      });
    }
  }

  function enterFocusMode() {
    state.isFocusMode = true;
    document.body.classList.add('focus-mode-active');
    switchTab('topic');
    state.pomodoro.isRunning = true;
    runPomodoro();
  }

  function exitFocusMode() {
    state.isFocusMode = false;
    document.body.classList.remove('focus-mode-active');
    clearInterval(state.pomodoro.interval);
    state.pomodoro.isRunning = false;
  }

  function runPomodoro() {
    clearInterval(state.pomodoro.interval);
    updatePomodoroDisplay();

    state.pomodoro.interval = setInterval(() => {
      state.pomodoro.timeLeft--;
      updatePomodoroDisplay();

      if (state.pomodoro.timeLeft <= 0) {
        clearInterval(state.pomodoro.interval);
        state.pomodoro.isRunning = false;
        addXp(50, 'Completed Pomodoro Session');
        triggerConfetti();
        alert('Pomodoro focus cycle completed! Take a 5-minute break.');
      }
    }, 1000);
  }

  function updatePomodoroDisplay() {
    const el = document.getElementById('pomodoro-timer-digits');
    if (!el) return;
    const s = state.pomodoro.timeLeft;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    el.textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // =========================================================================
  // 14. KEYBOARD SHORTCUTS
  // =========================================================================
  function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const key = e.key;

      // 1-4 Option select
      if (['1', '2', '3', '4'].includes(key)) {
        const idx = parseInt(key, 10) - 1;
        if (state.activeTab === 'topic') {
          const opt = document.querySelector(`#topic-options-list .option-item[data-opt-idx="${idx}"]`);
          if (opt) opt.click();
        } else if (state.activeTab === 'mock' && state.mockTest.active) {
          const opt = document.querySelector(`#mock-options-list .option-item[data-opt-idx="${idx}"]`);
          if (opt) opt.click();
        }
      }

      // Enter -> Check Answer or Save & Next
      if (key === 'Enter') {
        if (state.activeTab === 'topic') {
          const checkBtn = document.getElementById('btn-topic-check');
          if (checkBtn) checkBtn.click();
        } else if (state.activeTab === 'mock' && state.mockTest.active) {
          const nextBtn = document.getElementById('btn-mock-save-next');
          if (nextBtn) nextBtn.click();
        }
      }

      // N -> Next Question
      if (key === 'n' || key === 'N') {
        if (state.activeTab === 'topic') {
          const nextBtn = document.getElementById('btn-topic-next');
          if (nextBtn && !nextBtn.disabled) nextBtn.click();
        } else if (state.activeTab === 'mock' && state.mockTest.active) {
          const nextBtn = document.getElementById('btn-mock-save-next');
          if (nextBtn) nextBtn.click();
        }
      }

      // P -> Prev Question
      if (key === 'p' || key === 'P') {
        if (state.activeTab === 'topic') {
          const prevBtn = document.getElementById('btn-topic-prev');
          if (prevBtn && !prevBtn.disabled) prevBtn.click();
        } else if (state.activeTab === 'mock' && state.mockTest.active) {
          const prevBtn = document.getElementById('btn-mock-prev');
          if (prevBtn) prevBtn.click();
        }
      }

      // B -> Bookmark Toggle
      if (key === 'b' || key === 'B') {
        if (state.activeTab === 'topic') {
          const bmBtn = document.getElementById('btn-topic-bookmark');
          if (bmBtn) bmBtn.click();
        }
      }
    });
  }

  // =========================================================================
  // 15. SOFT CELEBRATION PARTICLES CANVAS
  // =========================================================================
  let confettiParticles = [];
  let confettiAnimationId = null;

  function initConfetti() {
    const canvas = document.getElementById('celebration-canvas');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }

  function triggerConfetti() {
    const canvas = document.getElementById('celebration-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = ['#F59E0B', '#FBBF24', '#14B8A6', '#2DD4BF', '#FFFFFF'];

    for (let i = 0; i < 45; i++) {
      confettiParticles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.4 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 7,
        vy: -Math.random() * 5 - 2,
        size: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: Math.random() * 0.02 + 0.012
      });
    }

    if (!confettiAnimationId) animateConfetti(ctx, canvas);
  }

  function animateConfetti(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    confettiParticles.forEach((p, idx) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // Gravity
      p.alpha -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (p.alpha <= 0) confettiParticles.splice(idx, 1);
    });

    if (confettiParticles.length > 0) {
      confettiAnimationId = requestAnimationFrame(() => animateConfetti(ctx, canvas));
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      confettiAnimationId = null;
    }
  }

  // Kickstart on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
