/**
 * ui.js - Modern Dark Theme Network Operations UI Controller
 * 
 * Handles:
 * - Realtime SVG/Canvas latency line chart and sparklines
 * - Waterfall timing visualizer (DNS, TCP, TLS, TTFB, Download)
 * - Modal tooltips with detailed network engineering explanations
 * - Tab switching, metric card updates, status badges, progress bars
 * - Export options: TXT, JSON, CSV, and Print-friendly trigger
 */

(function (window) {
  'use strict';

  // Safe DOM helper
  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Updates metric badge status and color
   * @param {string} elementId 
   * @param {string} value 
   * @param {string} status 'READY' | 'TESTING' | 'SUCCESS' | 'WARNING' | 'FAILED' | 'LIMITED' | 'UNAVAILABLE'
   * @param {string} [grade='MEASURED'] 'MEASURED' | 'ESTIMATED' | 'INFERRED' | 'UNAVAILABLE'
   */
  function updateMetricCard(elementId, value, status, grade = 'MEASURED') {
    const card = $(elementId);
    if (!card) return;

    const valEl = card.querySelector('.metric-val');
    const badgeEl = card.querySelector('.status-badge');
    const gradeEl = card.querySelector('.grade-badge');

    if (valEl) valEl.textContent = value;
    if (badgeEl) {
      badgeEl.textContent = status;
      badgeEl.className = 'status-badge status-' + status.toLowerCase();
    }
    if (gradeEl) {
      gradeEl.textContent = grade;
      gradeEl.className = 'grade-badge grade-' + grade.toLowerCase();
    }
  }

  /**
   * Render real-time SVG line graph for latency samples
   * Avoids external heavy chart libraries. Pure responsive SVG.
   * @param {string} containerId 
   * @param {number[]} samples Array of millisecond numbers
   */
  function renderLatencyChart(containerId, samples) {
    const container = $(containerId);
    if (!container) return;

    if (!samples || samples.length === 0) {
      container.innerHTML = '<div class="chart-empty">측정 데이터가 준비되지 않았습니다.</div>';
      return;
    }

    const width = 600;
    const height = 180;
    const padding = { top: 25, right: 30, bottom: 30, left: 45 };

    const maxVal = Math.max(10, ...samples) * 1.25;
    const minVal = 0;

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Generate points
    const points = samples.map((val, idx) => {
      const x = padding.left + (idx / Math.max(1, samples.length - 1)) * chartW;
      const y = padding.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
      return { x, y, val, idx: idx + 1 };
    });

    const pathD = points.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    // Area fill
    const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`;

    // Horizontal grid lines (3 steps)
    let gridLines = '';
    const steps = 3;
    for (let s = 0; s <= steps; s++) {
      const stepVal = Math.round((maxVal / steps) * s);
      const y = padding.top + chartH - (s / steps) * chartH;
      gridLines += `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#1e293b" stroke-dasharray="3,3" />
        <text x="${padding.left - 8}" y="${y + 4}" fill="#64748b" font-size="10" text-anchor="end">${stepVal}ms</text>
      `;
    }

    // Circles and value labels
    let nodes = '';
    points.forEach((p) => {
      nodes += `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#38bdf8" stroke="#0f172a" stroke-width="2" />
        <text x="${p.x}" y="${p.y - 8}" fill="#94a3b8" font-size="10" text-anchor="middle">#${p.idx} (${Math.round(p.val)}ms)</text>
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" class="latency-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${gridLines}
        <path d="${areaD}" fill="url(#chartGrad)" />
        <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${nodes}
      </svg>
    `;

    container.innerHTML = svg;
  }

  /**
   * Renders Timing Waterfall chart (DNS, TCP, TLS, TTFB, Download)
   * Displays actual ms or shows informative LIMITED notice when TAO is restricted
   * @param {string} containerId 
   * @param {Object} timingData 
   */
  function renderWaterfall(containerId, timingData) {
    const container = $(containerId);
    if (!container) return;

    if (!timingData || timingData.statusGrade === 'LIMITED' || timingData.dns === null) {
      container.innerHTML = `
        <div class="waterfall-notice limited">
          <div class="notice-icon">⚠️</div>
          <div class="notice-text">
            <strong>Timing-Allow-Origin (TAO) 미제공으로 상세 구간 마스킹됨</strong>
            <p>대상 서버의 CORS/TAO 헤더 설정상 DNS, TCP, TLS 세부 수치가 브라우저 보안 규정에 의해 0ms로 보호 마스킹되었습니다. 이는 사이트 장애가 아닌 표준 웹 브라우저의 프라이버시 보호 동작입니다.</p>
          </div>
        </div>
      `;
      return;
    }

    const stages = [
      { name: 'DNS Lookup', val: timingData.dns, color: '#38bdf8', desc: '도메인 이름 -> IP 변환' },
      { name: 'TCP Handshake', val: timingData.tcp, color: '#818cf8', desc: '서버와 3-way handshake 수립' },
      { name: 'TLS Negotiation', val: timingData.tls, color: '#c084fc', desc: 'HTTPS 보안 터널 및 인증서 검증' },
      { name: 'Server TTFB', val: timingData.ttfb, color: '#f59e0b', desc: '서버 어플리케이션 처리 대기' },
      { name: 'Content Download', val: timingData.download, color: '#10b981', desc: 'HTTP 응답 바이트 수신' }
    ];

    const totalTime = stages.reduce((acc, s) => acc + s.val, 0) || 1;

    let barsHtml = '';
    stages.forEach((s) => {
      const pct = Math.max(3, (s.val / totalTime) * 100);
      barsHtml += `
        <div class="waterfall-row">
          <div class="waterfall-label">
            <span class="dot" style="background:${s.color}"></span>
            <strong>${s.name}</strong>
            <span class="desc">${s.desc}</span>
          </div>
          <div class="waterfall-bar-track">
            <div class="waterfall-bar-fill" style="width:${pct}%; background:${s.color}">
              <span class="bar-val">${s.val} ms</span>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="waterfall-container">
        <div class="waterfall-header">
          <span>네트워크 페이즈 구분 (Total Measured: ${Math.round(totalTime)} ms)</span>
          <span class="badge grade-measured">TAO PERMITTED</span>
        </div>
        ${barsHtml}
      </div>
    `;
  }

  /**
   * Updates Quality Score Radial Dial and sub-score breakdown
   * @param {Object} scoreData Output of NQA_Analyzer.calculateScore()
   */
  function updateScoreDisplay(scoreData) {
    const scoreVal = $('score-number');
    const scoreGrade = $('score-grade');
    const scoreRing = $('score-ring-circle');

    if (scoreVal) scoreVal.textContent = scoreData.totalScore;
    if (scoreGrade) {
      scoreGrade.textContent = scoreData.gradeKo + ' (' + scoreData.grade + ')';
      scoreGrade.className = 'score-grade-text color-' + scoreData.gradeColor;
    }

    if (scoreRing) {
      // SVG strokeDashoffset calculation (Circumference = 2 * PI * 54 ≈ 339.29)
      const circumference = 339.29;
      const offset = circumference - (scoreData.totalScore / 100) * circumference;
      scoreRing.style.strokeDashoffset = offset;
      scoreRing.setAttribute('stroke', scoreData.gradeColor === 'emerald' ? '#10b981' : (scoreData.gradeColor === 'blue' ? '#38bdf8' : (scoreData.gradeColor === 'amber' ? '#f59e0b' : '#f43f5e')));
    }

    // Sub-scores
    const breakdown = scoreData.breakdown;
    if (breakdown) {
      ['latency', 'stability', 'download', 'website'].forEach((key) => {
        const item = breakdown[key];
        const el = $('subscore-' + key);
        if (el) {
          el.innerHTML = `
            <div class="subscore-info">
              <span class="label">${item.label}</span>
              <span class="score">${item.score} / ${item.max}</span>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" style="width: ${(item.score / item.max) * 100}%"></div>
            </div>
          `;
        }
      });
    }
  }

  /**
   * Sets up interactive modal dialogs for technical explanation (ⓘ buttons)
   */
  function setupExplanationModals() {
    const modal = $('explanation-modal');
    const modalTitle = $('modal-title');
    const modalBody = $('modal-body');
    const closeBtn = $('modal-close-btn');

    if (!modal) return;

    const GLOSSARY = {
      ping: {
        title: 'HTTP Latency (RTT) 란?',
        body: `
          <p><strong>측정 원리:</strong> 클라이언트 브라우저에서 대상 원격 엔드포인트로 HTTP 요청을 전송하고, 서버로부터 응답 헤더를 수신할 때까지의 왕복 소요시간(Round-Trip Time)입니다.</p>
          <p><strong>ICMP Ping과의 차이점:</strong> 일반 cmd/터미널의 Ping은 네트워크 3계층(ICMP) 프로토콜을 사용하지만, 웹 브라우저 샌드박스 보안 규정상 Raw Socket 및 ICMP 패킷 전송이 불가능합니다. 따라서 본 WebApp은 어플리케이션 레이어의 실제 HTTP RTT를 정밀 측정합니다.</p>
          <p><strong>우수 기준:</strong> 국내 Anycast CDN 기준 20ms 미만은 최우수(Excellent), 50ms 미만은 양호(Good)입니다.</p>
        `
      },
      jitter: {
        title: 'Jitter (지터) 란?',
        body: `
          <p><strong>정의:</strong> 연속된 패킷 또는 요청 간의 지연시간 변동폭(RFC 3550 표준 편차)을 의미합니다.</p>
          <p><strong>왜 중요한가:</strong> 평균 응답속도가 20ms로 빠르더라도 지터가 30ms 이상 높으면 화상 회의(Zoom, Teams), 실시간 음성 통화(VoIP), 클라우드 게이밍에서 주기적인 끊김(렉)과 패킷 버퍼링이 발생합니다.</p>
          <p><strong>판정 기준:</strong> 0~5ms (우수), 5~15ms (보통), 15~30ms (주의), 30ms+ (불안정/위험)</p>
        `
      },
      failureRate: {
        title: 'HTTP Request Failure Rate 란?',
        body: `
          <p><strong>정의:</strong> 여러 차례 반복하여 전송한 HTTP 요청 중 네트워크 오류, 타임아웃, 커넥션 단절 등으로 실패한 트랜잭션의 비율(%)입니다.</p>
          <p><strong>패킷 손실(Packet Loss)과의 관계:</strong> 브라우저는 3계층 패킷 단위 드롭을 감지할 수 없으므로, HTTP 레벨의 요청 실패율을 실측하여 통신 신뢰도를 진단합니다.</p>
        `
      },
      download: {
        title: 'Download Throughput (실제 다운로드 속도) 란?',
        body: `
          <p><strong>측정 원리:</strong> 원격 Anycast 글로벌 CDN으로부터 실제 고용량 바이너리 청크 페이로드를 직접 수신하며, 바이트 수와 소요 시간을 초당 메가비트(Mbps) 단위로 환산합니다.</p>
          <p><strong>가짜 속도 배제:</strong> 가상의 추정치나 인위적인 계산식을 일절 사용하지 않으며, 캐시 방지(no-store 및 query cache-buster)를 적용한 실제 전송 대역폭입니다.</p>
        `
      },
      upload: {
        title: 'Upload Speed (업로드 속도) 및 원격 수신 정책',
        body: `
          <p><strong>측정 원칙:</strong> 브라우저 메모리 상에서 실제 바이너리 버퍼를 생성한 뒤 원격 엔드포인트로 HTTP POST 스트림을 전송해야만 실측이 가능합니다.</p>
          <p><strong>UNAVAILABLE 상태인 이유:</strong> 수신 서버(CORS POST 허용 Echo/Sink 서버)가 구성되지 않은 순수 프론트엔드 환경에서는 업로드 속도를 절대 추정하거나 임의 생성하지 않으며, 정직하게 '측정 불가(UNAVAILABLE)' 상태로 명시합니다.</p>
        `
      },
      ttfb: {
        title: 'TTFB (Time To First Byte) 란?',
        body: `
          <p><strong>정의:</strong> 웹 브라우저가 HTTP 요청을 서버로 보낸 후, 서버로부터 첫 번째 바이트(First Byte)의 응답을 수신하기까지 걸린 시간입니다.</p>
          <p><strong>핵심 분석 포인트:</strong> 사용자 인터넷 회선 속도가 500Mbps 이상으로 매우 빨라도, 대상 서버의 백엔드 프로그램 처리(DB 쿼리 지연, 서버 과부하)가 느리면 TTFB가 치솟아 사용자는 사이트가 매우 느리다고 체감하게 됩니다.</p>
        `
      },
      tao: {
        title: 'Timing-Allow-Origin (TAO) 헤더와 보안 규정',
        body: `
          <p><strong>브라우저 보안 제약:</strong> 사용자가 입력한 임의의 Cross-Origin 웹사이트는 보안 규정상 DNS, TCP, TLS 세부 시간을 브라우저가 0ms로 마스킹합니다.</p>
          <p><strong>해결 및 진단:</strong> 대상 서버가 <code>Timing-Allow-Origin: *</code> 헤더를 선언했을 때만 세부 마이크로초 단위가 공개됩니다. 본 WebApp은 이 경우 0ms라고 왜곡하지 않고 '측정 제한(LIMITED)'으로 명확하게 판정합니다.</p>
        `
      }
    };

    document.querySelectorAll('.info-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const topic = btn.getAttribute('data-topic');
        const item = GLOSSARY[topic];
        if (item) {
          modalTitle.textContent = item.title;
          modalBody.innerHTML = item.body;
          modal.classList.add('active');
        }
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
      });
    }

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  /**
   * Tab switcher logic
   */
  function setupTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-tab');

        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        const targetContent = $(targetId);
        if (targetContent) targetContent.classList.add('active');
      });
    });
  }

  /**
   * Sets up Export options (Copy, TXT, JSON, CSV, Print)
   */
  function setupExportActions(getReportDataCallback) {
    const btnCopy = $('btn-copy-report');
    const btnTxt = $('btn-download-txt');
    const btnJson = $('btn-download-json');
    const btnCsv = $('btn-download-csv');
    const btnPrint = $('btn-print-report');

    function triggerFileDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        const data = getReportDataCallback();
        const text = window.NQA_Analyzer.generateTextReport(
          data.baseline, data.download, data.upload, data.target, data.analysis, data.score
        );
        try {
          await navigator.clipboard.writeText(text);
          btnCopy.textContent = '복사 완료!';
          setTimeout(() => { btnCopy.textContent = '텍스트 복사'; }, 2000);
        } catch (err) {
          alert('클립보드 권한이 필요합니다.');
        }
      });
    }

    if (btnTxt) {
      btnTxt.addEventListener('click', () => {
        const data = getReportDataCallback();
        const text = window.NQA_Analyzer.generateTextReport(
          data.baseline, data.download, data.upload, data.target, data.analysis, data.score
        );
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        triggerFileDownload(blob, 'network-quality-report-' + Date.now() + '.txt');
      });
    }

    if (btnJson) {
      btnJson.addEventListener('click', () => {
        const data = getReportDataCallback();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        triggerFileDownload(blob, 'network-quality-report-' + Date.now() + '.json');
      });
    }

    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        const data = getReportDataCallback();
        let csv = 'Category,Metric,Value,Unit,Grade\n';
        if (data.baseline && data.baseline.stats) {
          csv += `Baseline,Latency Median,${data.baseline.stats.median},ms,${data.baseline.statusGrade}\n`;
          csv += `Baseline,Jitter,${data.baseline.jitter},ms,MEASURED\n`;
          csv += `Baseline,Failure Rate,${data.baseline.failureRate},%,MEASURED\n`;
        }
        if (data.download) {
          csv += `Throughput,Download,${data.download.mbps},Mbps,${data.download.statusGrade}\n`;
        }
        if (data.target && data.target.stats) {
          csv += `Target,Response Median,${data.target.stats.median},ms,MEASURED\n`;
          csv += `Target,TTFB,${data.target.ttfb},ms,${data.target.ttfbGrade}\n`;
        }
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        triggerFileDownload(blob, 'network-quality-metrics-' + Date.now() + '.csv');
      });
    }

    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }
  }

  // Export to Global
  window.NQA_UI = {
    $,
    updateMetricCard,
    renderLatencyChart,
    renderWaterfall,
    updateScoreDisplay,
    setupExplanationModals,
    setupTabs,
    setupExportActions
  };

})(window);
