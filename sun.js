const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '../data/history');
const LEARNING_FILE = path.join(HISTORY_DIR, 'learning_data_sun.json');
const HISTORY_FILE = path.join(HISTORY_DIR, 'prediction_history_sun.json');
const EXTERNAL_HISTORY_FILE = path.join(HISTORY_DIR, 'external_history_sun.json');

// Tạo thư mục nếu chưa tồn tại
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

// Khởi tạo dữ liệu
let predictionHistory = { sun: [] };
let externalHistory = [];
const MIN_HISTORY_FOR_PREDICTION = 10;
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { sun: null };

let learningData = {
  sun: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    reversalState: {
      active: false,
      activatedAt: null,
      consecutiveLosses: 0,
      reversalCount: 0,
      lastReversalResult: null
    },
    transitionMatrix: {
      'Tài->Tài': 0, 'Tài->Xỉu': 0,
      'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0
    }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.3, 'cau_dao_11': 1.2, 'cau_22': 1.15, 'cau_33': 1.2,
  'cau_121': 1.1, 'cau_123': 1.1, 'cau_321': 1.1, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.15, 'cau_3van1': 1.2, 'cau_be_cau': 1.25,
  'cau_chu_ky': 1.1, 'distribution': 0.9, 'dice_pattern': 1.0,
  'sum_trend': 1.05, 'edge_cases': 1.1, 'momentum': 1.15,
  'cau_tu_nhien': 0.8, 'dice_trend_line': 1.2, 'break_pattern': 1.3,
  'fibonacci': 1.0, 'resistance_support': 1.15, 'wave': 1.1,
  'golden_ratio': 1.0, 'day_gay': 1.25, 'cau_44': 1.2, 'cau_55': 1.25,
  'cau_212': 1.1, 'cau_1221': 1.15, 'cau_2112': 1.15, 'cau_gap': 1.1,
  'cau_ziczac': 1.2, 'cau_doi': 1.15, 'cau_rong': 1.3, 'smart_bet': 1.2,
  'markov_chain': 1.35, 'moving_avg_drift': 1.2, 'sum_pressure': 1.25,
  'volatility': 1.15, 'sun_hot_cold': 1.3, 'sun_streak_break': 1.35,
  'sun_balance': 1.2, 'sun_momentum_shift': 1.25
};

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Origin": "https://play.sun.win"
};

const initialMessages = [
  [
    1, "MiniGame", "GM_fbbdbebndbbc", "123123p",
    {
      "info": "{\"ipAddress\":\"2402:800:62cd:cb7c:1a7:7a52:9c3e:c290\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJuZG5lYmViYnMiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMTIxMDczMTUsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJ0aW1lc3RhbXAiOjE3NTQ5MjYxMDI1MjcsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjQwMjo4MDA6NjJjZDpjYjdjOjFhNzo3YTUyOjljM2U6YzI5MCIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMDEucG5nIiwicGxhdGZvcm1JZCI6NSwidXNlcklkIjoiN2RhNDlhNDQtMjlhYS00ZmRiLWJkNGMtNjU5OTQ5YzU3NDdkIiwicmVnVGltZSI6MTc1NDkyNjAyMjUxNSwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJHTV9mYmJkYmVibmRiYmMifQ.DAyEeoAnz8we-Qd0xS0tnqOZ8idkUJkxksBjr_Gei8A\",\"locale\":\"vi\",\"userId\":\"7da49a44-29aa-4fdb-bd4c-659949c5747d\",\"username\":\"GM_fbbdbebndbbc\",\"timestamp\":1754926102527,\"refreshToken\":\"7cc4ad191f4348849f69427a366ea0fd.a68ece9aa85842c7ba523170d0a4ae3e\"}",
      "signature": "53D9E12F910044B140A2EC659167512E2329502FE84A6744F1CD5CBA9B6EC04915673F2CBAE043C4EDB94DDF88F3D3E839A931100845B8F179106E1F44ECBB4253EC536610CCBD0CE90BD8495DAC3E8A9DBDB46FE49B51E88569A6F117F8336AC7ADC226B4F213ECE2F8E0996F2DD5515476C8275F0B2406CDF2987F38A6DA24"
    }
  ],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let currentSessionId = null;
let wsConnected = false;

// ========== HÀM LOAD/SAVE DỮ LIỆU ==========

function loadExternalHistory() {
  try {
    if (fs.existsSync(EXTERNAL_HISTORY_FILE)) {
      const data = fs.readFileSync(EXTERNAL_HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      externalHistory = Array.isArray(parsed) ? parsed : [];
      console.log(`[Sun] ✅ External history loaded: ${externalHistory.length} records`);
    } else {
      externalHistory = [];
      console.log('[Sun] No external history file, starting fresh');
    }
  } catch (error) {
    console.error('[Sun] ❌ Error loading external history:', error.message);
    externalHistory = [];
  }
}

function saveExternalHistory() {
  try {
    fs.writeFileSync(EXTERNAL_HISTORY_FILE, JSON.stringify(externalHistory, null, 2));
  } catch (error) {
    console.error('[Sun] ❌ Error saving external history:', error.message);
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && parsed.sun) {
        learningData.sun = { ...learningData.sun, ...parsed.sun };
      }
      console.log('[Sun] ✅ Learning data loaded successfully');
    }
  } catch (error) {
    console.error('[Sun] ❌ Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('[Sun] ❌ Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { sun: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { sun: null };
      console.log('[Sun] ✅ Prediction history loaded successfully');
      console.log(`  - Sun: ${predictionHistory.sun?.length || 0} records`);
    }
  } catch (error) {
    console.error('[Sun] ❌ Error loading prediction history:', error.message);
    predictionHistory = { sun: [] };
  }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien
    }, null, 2));
  } catch (error) {
    console.error('[Sun] ❌ Error saving prediction history:', error.message);
  }
}

function startAutoSaveTask() {
  setInterval(() => {
    saveLearningData();
    savePredictionHistory();
    saveExternalHistory();
  }, AUTO_SAVE_INTERVAL);
  console.log('[Sun] ✅ Auto-save task started (every 30s)');
}

// ========== WEBSOCKET ==========

function connectWebSocket() {
  if (ws) {
    ws.removeAllListeners();
    try { 
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(); 
      }
    } catch (e) {}
  }

  console.log('[Sun] 🔌 Connecting to WebSocket...');
  
  try {
    ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
      console.log('[Sun] ✅ WebSocket connected');
      wsConnected = true;
      
      // Gửi tin nhắn khởi tạo
      initialMessages.forEach((msg, i) => {
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
            console.log(`[Sun] 📤 Sent init message ${i + 1}`);
          }
        }, i * 600);
      });

      // Ping interval
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 15000);
    });

    ws.on('pong', () => {
      // Giữ kết nối
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        // Xử lý message format
        if (!Array.isArray(data) || data.length < 2) return;
        
        const messageData = data[1];
        if (typeof messageData !== 'object') return;

        const { cmd, sid, d1, d2, d3, gBB } = messageData;

        // Lưu session ID
        if (cmd === 1008 && sid) {
          currentSessionId = sid;
          console.log(`[Sun] 📝 Session ID: ${currentSessionId}`);
        }

        // Xử lý kết quả game
        if (cmd === 1003 && gBB) {
          if (d1 === undefined || d2 === undefined || d3 === undefined) return;

          const total = d1 + d2 + d3;
          const ketqua = total >= 11 ? "Tài" : "Xỉu"; // Lưu ý: 10 là Xỉu, 11+ là Tài

          const result = {
            Phien: currentSessionId || Date.now().toString(),
            Xuc_xac_1: d1,
            Xuc_xac_2: d2,
            Xuc_xac_3: d3,
            Tong: total,
            Ket_qua: ketqua,
            timestamp: Date.now()
          };

          // Kiểm tra trùng lặp
          const exists = externalHistory.some(h => h.Phien === result.Phien);
          if (!exists && result.Phien) {
            externalHistory.unshift(result);
            if (externalHistory.length > MAX_HISTORY) {
              externalHistory = externalHistory.slice(0, MAX_HISTORY);
            }
            console.log(`[Sun] 🎲 Phiên ${result.Phien}: ${d1}-${d2}-${d3} = ${total} (${ketqua})`);
            saveExternalHistory();
          }
        }
      } catch (e) {
        // Silent fail for parsing errors
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Sun] 🔌 WebSocket closed (${code}). Reconnecting in 5s...`);
      wsConnected = false;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (error) => {
      console.error('[Sun] ❌ WebSocket error:', error.message);
      wsConnected = false;
    });

  } catch (error) {
    console.error('[Sun] ❌ Failed to connect WebSocket:', error.message);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  }
}

// ========== HÀM TIỆN ÍCH ==========

function normalizeResult(result) {
  if (!result) return 'Tài';
  const lower = result.toString().toLowerCase();
  if (lower === 'tài' || lower === 'tai' || lower === 't') return 'Tài';
  if (lower === 'xỉu' || lower === 'xiu' || lower === 'x') return 'Xỉu';
  return 'Tài';
}

function fetchData() {
  if (!externalHistory || externalHistory.length === 0) return null;
  return { data: [...externalHistory] };
}

// ========== THUẬT TOÁN DỰ ĐOÁN ==========

function calculateAdvancedPrediction(data, type) {
  if (!data || data.length < MIN_HISTORY_FOR_PREDICTION) {
    return { prediction: 'Tài', confidence: 50, factors: { error: 'Not enough data' } };
  }

  let taiCount = 0, xiuCount = 0;
  const recentResults = data.slice(0, 20);
  
  recentResults.forEach(item => {
    const result = normalizeResult(item.Ket_qua);
    if (result === 'Tài') taiCount++;
    else xiuCount++;
  });

  // Phân tích chuỗi
  const lastResults = data.slice(0, 10).map(d => normalizeResult(d.Ket_qua));
  let currentStreak = 1;
  for (let i = 1; i < lastResults.length; i++) {
    if (lastResults[i] === lastResults[0]) currentStreak++;
    else break;
  }

  // Dự đoán cơ bản dựa trên tỷ lệ
  let prediction = taiCount > xiuCount ? 'Xỉu' : 'Tài';
  let confidence = 50 + Math.abs(taiCount - xiuCount) * 1.5;

  // Điều chỉnh theo chuỗi (cầu)
  if (currentStreak >= 4) {
    // Đảo cầu sau 4 phiên
    prediction = lastResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
    confidence += 15;
  } else if (currentStreak >= 3) {
    confidence += 8;
  } else if (currentStreak >= 2) {
    confidence += 3;
  }

  // Phân tích tổng điểm
  const sumTrend = data.slice(0, 10).map(d => d.Tong).filter(v => v);
  if (sumTrend.length > 0) {
    const avgSum = sumTrend.reduce((a, b) => a + b, 0) / sumTrend.length;
    if (avgSum > 12) {
      if (prediction === 'Tài') confidence += 5;
      else confidence -= 3;
    } else if (avgSum < 9) {
      if (prediction === 'Xỉu') confidence += 5;
      else confidence -= 3;
    }
  }

  // Giới hạn confidence
  confidence = Math.min(92, Math.max(50, Math.round(confidence)));

  return {
    prediction,
    confidence,
    factors: {
      taiCount,
      xiuCount,
      streak: currentStreak,
      totalRounds: data.length
    }
  };
}

// ========== QUẢN LÝ LỊCH SỬ DỰ ĐOÁN ==========

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: '@mryanhdz',
    timestamp: new Date().toISOString()
  };
  
  if (!predictionHistory[type]) predictionHistory[type] = [];
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  savePredictionHistory();
  return record;
}

function recordPrediction(type, phien, prediction, confidence, factors) {
  if (!learningData[type]) return;
  
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction: normalizeResult(prediction),
    confidence,
    factors,
    timestamp: Date.now(),
    verified: false
  });

  if (learningData[type].predictions.length > MAX_HISTORY) {
    learningData[type].predictions = learningData[type].predictions.slice(0, MAX_HISTORY);
  }
}

async function verifyPredictions(type, currentData) {
  if (!learningData[type] || !currentData || currentData.length === 0) return;

  const unverified = learningData[type].predictions.filter(p => !p.verified);
  let updated = false;
  
  for (const pred of unverified) {
    const actual = currentData.find(d => d.Phien?.toString() === pred.phien);
    if (actual) {
      const actualResult = normalizeResult(actual.Ket_qua);
      pred.verified = true;
      pred.actual = actualResult;
      pred.isCorrect = pred.prediction === actualResult;

      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        learningData[type].streakAnalysis.wins++;
      } else {
        learningData[type].streakAnalysis.losses++;
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
      }

      // Cập nhật best/worst streak
      if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
        learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
      }
      if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
        learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
      }

      learningData[type].totalPredictions++;
      learningData[type].lastUpdate = new Date().toISOString();
      updated = true;
    }
  }
  
  if (updated) {
    // Cập nhật accuracy gần đây
    const recentCorrect = learningData[type].predictions.slice(0, 20).filter(p => p.verified && p.isCorrect).length;
    const recentTotal = learningData[type].predictions.slice(0, 20).filter(p => p.verified).length;
    if (recentTotal > 0) {
      learningData[type].recentAccuracy.unshift(recentCorrect / recentTotal);
      if (learningData[type].recentAccuracy.length > 10) {
        learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(0, 10);
      }
    }
    saveLearningData();
  }
}

// ========== API ROUTES ==========

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API Sun - Tài Xỉu Prediction',
    wsConnected,
    historyCount: externalHistory.length,
    canPredict: externalHistory.length >= MIN_HISTORY_FOR_PREDICTION,
    minRequired: MIN_HISTORY_FOR_PREDICTION
  });
});

router.get('/taixiu', async (req, res) => {
  try {
    if (externalHistory.length < MIN_HISTORY_FOR_PREDICTION) {
      return res.json({
        success: false,
        error: `Cần ít nhất ${MIN_HISTORY_FOR_PREDICTION} lịch sử để dự đoán`,
        current: externalHistory.length,
        required: MIN_HISTORY_FOR_PREDICTION,
        wsConnected,
        message: 'Đang chờ dữ liệu từ WebSocket...'
      });
    }
    
    const data = fetchData();
    if (!data || !data.data || data.data.length === 0) {
      return res.status(500).json({ success: false, error: 'Không thể lấy dữ liệu' });
    }
    
    // Verify các dự đoán trước
    await verifyPredictions('sun', data.data);
    
    const gameData = data.data;
    const latestPhien = gameData[0].Phien;
    
    // Tính phiên tiếp theo
    let nextPhien;
    if (typeof latestPhien === 'number') {
      nextPhien = latestPhien + 1;
    } else if (typeof latestPhien === 'string') {
      const num = parseInt(latestPhien);
      nextPhien = isNaN(num) ? Date.now().toString() : (num + 1).toString();
    } else {
      nextPhien = Date.now().toString();
    }
    
    const result = calculateAdvancedPrediction(gameData, 'sun');
    
    savePredictionToHistory('sun', nextPhien, result.prediction, result.confidence);
    recordPrediction('sun', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      success: true,
      phien: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@mryanhdz',
      factors: result.factors
    });
  } catch (error) {
    console.error('[Sun] Error in /taixiu:', error);
    res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
});

router.get('/taixiu/lichsu', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    success: true,
    type: 'Sun Tài Xỉu',
    history: externalHistory.slice(0, limit),
    total: externalHistory.length,
    wsConnected
  });
});

router.get('/stats', (req, res) => {
  const stats = learningData.sun;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
    
  res.json({
    success: true,
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    accuracy: accuracy + '%',
    streakAnalysis: stats.streakAnalysis,
    recentAccuracy: stats.recentAccuracy.length > 0 
      ? (stats.recentAccuracy.reduce((a,b) => a+b, 0) / stats.recentAccuracy.length * 100).toFixed(1) + '%'
      : 'N/A',
    wsConnected,
    historyCount: externalHistory.length
  });
});

router.get('/ls', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    success: true,
    total: externalHistory.length,
    canPredict: externalHistory.length >= MIN_HISTORY_FOR_PREDICTION,
    minRequired: MIN_HISTORY_FOR_PREDICTION,
    wsConnected,
    data: externalHistory.slice(0, limit)
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    wsConnected,
    historyCount: externalHistory.length,
    uptime: process.uptime()
  });
});

// ========== KHỞI TẠO ==========

console.log('[Sun] Initializing Sun module...');
loadLearningData();
loadPredictionHistory();
loadExternalHistory();
startAutoSaveTask();
connectWebSocket();

module.exports = router;