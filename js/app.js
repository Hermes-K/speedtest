/**
 * app.js - Main Application Orchestrator
 * Coordinates testing scenarios, user triggers, multi-endpoint baselines, and UI binding.
 */

(function (window) {
  'use strict';

  // Global state object
  const state = {
    isTesting: false,
    baselineResult: null,
    downloadResult: null,
    uploadResult: null,
    targetResult: null,
    analysisResult: null,
    scoreResult: null,
    testMode: 'standard' // 'quick' (3), 'standard' (5), 'deep' (10)
  };

  function getRepetitions(mode) {
    if (mode === 'quick') return 3;
    if (mode === 'deep') return 10;
    return 5;
  }

  /**
   * Initializes the Application
   */
  function initApp() {
    const ui = window.NQA_UI;
    const net = window.NQA_Network;
    const analyzer = window.NQA_Analyzer;

    // Check protocol (file:// vs http(s)://)
    checkEnvironment();

    // Setup UI components
    ui.setupTabs();
    ui.setupExplanationModals();
    ui.setupExportActions(() => state);

    // Populate Advanced Environment Tab
    populateAdvancedEnv();

    // Mode Selector listeners
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.testMode = btn.getAttribute('data-mode');
        updateEstimatedTrafficNotice();
      });
    });

    // Start Speed Test Button
    const btnStartSpeed = ui.$('btn-start-speedtest');
    if (btnStartSpeed) {
      btnStartSpeed.addEventListener('click', () => {
        if (!state.isTesting) runFullSpeedTest();
      });
    }

    // Start Target Website Test Button
    const btnStartTarget = ui.$('btn-start-target-test');
    if (btnStartTarget) {
      btnStartTarget.addEventListener('click', () => {
        if (!state.isTesting) runWebsiteQualityTest();
      });
    }

    // Comprehensive Diagnostics Button (Runs both)
    const btnStartAll = ui.$('btn-start-comprehensive');
    if (btnStartAll) {
      btnStartAll.addEventListener('click', () => {
        if (!state.isTesting) runComprehensiveTest();
      });
    }
  }

  /**
   * Detects file:// execution or browser restrictions and warns politely
   */
  function checkEnvironment() {
    const isFileProto = window.location.protocol === 'file:';
    const banner = window.NQA_UI.$('env-warning-banner');
    if (banner) {
      if (isFileProto) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div class="banner-inner">
            <span class="banner-icon">⚠️</span>
            <div class="banner-msg">
              <strong>file:// 프로토콜 실행 환경 안내</strong>
              <p>현재 로컬 파일 시스템에서 직접 실행 중입니다. 브라우저 보안 정책(CORS)으로 인해 일부 외부 엔드포인트의 세부 타이밍 조회가 제한될 수 있습니다. 정상적인 상호작용 및 정밀 분석을 위해선 GitHub Pages (https://) 환경을 권장합니다.</p>
            </div>
          </div>
        `;
      } else {
        banner.style.display = 'none';
      }
    }
  }

  /**
   * Updates Estimated Traffic usage notice based on test mode
   */
  function updateEstimatedTrafficNotice() {
    const noticeEl = window.NQA_UI.$('traffic-notice');
    if (!noticeEl) return;

    if (state.testMode === 'quick') {
      noticeEl.textContent = '예상 데이터 사용량: 약 1~5MB (빠른 3회 샘플 점검)';
    } else if (state.testMode === 'deep') {
      noticeEl.textContent = '예상 데이터 사용량: 약 25~35MB (10회 정밀 P95 및 장시간 편차 분석)';
    } else {
      noticeEl.textContent = '예상 데이터 사용량: 약 10~15MB (권장 표준 5회 샘플 점검)';
    }
  }

  /**
   * Populates system and network capabilities in the Advanced Tab
   */
  function populateAdvancedEnv() {
    const ui = window.NQA_UI;
    const net = window.NQA_Network;
    const netInfo = net.getBrowserNetworkInfo();

    const envContainer = ui.$('advanced-specs');
    if (!envContainer) return;

    envContainer.innerHTML = `
      <div class="spec-grid">
        <div class="spec-card">
          <div class="spec-title">Browser User Agent</div>
          <div class="spec-value small">${navigator.userAgent}</div>
        </div>
        <div class="spec-card">
          <div class="spec-title">Online State</div>
          <div class="spec-value">${navigator.onLine ? '🟢 ONLINE' : '🔴 OFFLINE'}</div>
        </div>
        <div class="spec-card">
          <div class="spec-title">Execution Context</div>
          <div class="spec-value">${window.location.protocol}// (${window.location.host || 'Local Disk'})</div>
        </div>
        <div class="spec-card">
          <div class="spec-title">Network Information API</div>
          <div class="spec-value">${netInfo.supported ? `${netInfo.effectiveType} (Downlink: ${netInfo.downlink}, RTT: ${netInfo.rtt})` : '미지원 (Unsupported)'}</div>
          <div class="spec-sub">${netInfo.note}</div>
        </div>
        <div class="spec-card">
          <div class="spec-title">Performance Resource Timing API</div>
          <div class="spec-value">${window.performance && window.performance.getEntriesByType ? '🟢 지원 (Active)' : '🔴 미지원'}</div>
        </div>
        <div class="spec-card">
          <div class="spec-title">Upload Endpoint State</div>
          <div class="spec-value">${net.CONFIG.uploadEndpoint ? '🟢 수신 엔드포인트 활성' : '⚪ 미설정 (UNAVAILABLE 유지)'}</div>
        </div>
      </div>
    `;
  }

  /**
   * Sets Global Testing state UI indicators
   */
  function setTestingState(testing, statusMessage = '') {
    state.isTesting = testing;
    const statusBar = window.NQA_UI.$('global-test-status');
    const startBtns = document.querySelectorAll('.action-trigger');

    if (statusBar) {
      if (testing) {
        statusBar.style.display = 'flex';
        statusBar.querySelector('.status-text').textContent = statusMessage;
      } else {
        statusBar.style.display = 'none';
      }
    }

    startBtns.forEach((btn) => {
      btn.disabled = testing;
    });
  }

  /**
   * Runs Speed Test Scenario
   */
  async function runFullSpeedTest() {
    const ui = window.NQA_UI;
    const net = window.NQA_Network;
    const reps = getRepetitions(state.testMode);

    setTestingState(true, '인터넷 기준선(Baseline) Latency 및 Jitter 측정 중...');
    ui.updateMetricCard('card-ping', '측정 중...', 'TESTING', 'MEASURED');
    ui.updateMetricCard('card-jitter', '측정 중...', 'TESTING', 'MEASURED');
    ui.updateMetricCard('card-failrate', '측정 중...', 'TESTING', 'MEASURED');

    try {
      // 1. Latency & Jitter
      const primaryEndpoint = net.CONFIG.baselineEndpoints[0].url;
      const baseline = await net.measureLatencyAndJitter(primaryEndpoint, reps, (curr, total, sample) => {
        setTestingState(true, `Latency 샘플 수집 중: (${curr}/${total}) - ${Math.round(sample.duration)}ms`);
      });
      state.baselineResult = baseline;

      // Extract sample numbers for chart
      const latencySamples = baseline.samples.map(s => s.duration);
      ui.renderLatencyChart('speed-latency-chart', latencySamples);

      ui.updateMetricCard('card-ping', baseline.stats.median + ' ms', 'SUCCESS', 'MEASURED');
      ui.updateMetricCard('card-jitter', baseline.jitter + ' ms', 'SUCCESS', 'MEASURED');
      ui.updateMetricCard('card-failrate', baseline.failureRate + ' %', baseline.failureRate > 0 ? 'WARNING' : 'SUCCESS', 'MEASURED');

      // 2. Download Throughput
      setTestingState(true, '실제 다운로드 대역폭(Throughput) 실측 중...');
      ui.updateMetricCard('card-download', '측정 중...', 'TESTING', 'MEASURED');

      const payloadSize = state.testMode === 'deep' ? 10 : 5;
      const download = await net.measureDownloadSpeed(payloadSize, (rec, total, currMbps) => {
        ui.updateMetricCard('card-download', currMbps + ' Mbps', 'TESTING', 'MEASURED');
      });
      state.downloadResult = download;

      if (download.statusGrade === 'MEASURED') {
        ui.updateMetricCard('card-download', download.mbps + ' Mbps', 'SUCCESS', 'MEASURED');
      } else {
        ui.updateMetricCard('card-download', '오류 발생', 'FAILED', 'MEASURED');
      }

      // 3. Upload Throughput
      ui.updateMetricCard('card-upload', '측정 불가', 'UNAVAILABLE', 'UNAVAILABLE');
      state.uploadResult = {
        mbps: 0,
        statusGrade: 'UNAVAILABLE',
        reason: 'Upload 데이터를 수신할 Remote Endpoint가 구성되지 않아 정확한 측정이 불가능합니다.'
      };

      // 4. Update Score & Diagnostics
      recomputeScoreAndAnalysis();

    } catch (err) {
      console.error(err);
      alert('속도 측정 중 예외가 발생했습니다: ' + err.message);
    } finally {
      setTestingState(false);
    }
  }

  /**
   * Runs Website Quality Test Scenario
   */
  async function runWebsiteQualityTest() {
    const ui = window.NQA_UI;
    const net = window.NQA_Network;
    const reps = getRepetitions(state.testMode);

    const inputUrl = ui.$('target-url-input').value;
    const validation = net.normalizeUrl(inputUrl);

    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    setTestingState(true, `목적지 웹사이트 [${validation.hostname}] 접근 품질 분석 중...`);
    ui.$('target-url-input').value = validation.url;

    try {
      const targetRes = await net.testTargetWebsite(validation.url, reps, (curr, total, s) => {
        setTestingState(true, `웹사이트 요청 테스트 중: (${curr}/${total}) - ${Math.round(s.duration)}ms`);
      });
      state.targetResult = targetRes;

      // Render Waterfall
      ui.renderWaterfall('waterfall-view', targetRes.timingData);

      // Render Target Latency Line Chart
      const durations = targetRes.samples.map(s => s.duration);
      ui.renderLatencyChart('target-latency-chart', durations);

      // Update Summary Cards
      ui.updateMetricCard('card-target-resp', targetRes.stats.median + ' ms', 'SUCCESS', 'MEASURED');
      ui.updateMetricCard('card-target-ttfb', targetRes.ttfb + ' ms', 'SUCCESS', targetRes.ttfbGrade);

      // Update Comparison View
      renderComparisonView();

      // Update Diagnostics
      recomputeScoreAndAnalysis();

    } catch (err) {
      console.error(err);
      alert('웹사이트 테스트 실패: ' + err.message);
    } finally {
      setTestingState(false);
    }
  }

  /**
   * Runs comprehensive diagnosis (Speed test + Target Website test)
   */
  async function runComprehensiveTest() {
    await runFullSpeedTest();
    const urlInput = window.NQA_UI.$('target-url-input').value;
    if (urlInput && urlInput.trim().length > 0) {
      await runWebsiteQualityTest();
    }
  }

  /**
   * Recomputes Analysis & Quality Scores
   */
  function recomputeScoreAndAnalysis() {
    const ui = window.NQA_UI;
    const analyzer = window.NQA_Analyzer;

    const score = analyzer.calculateScore(state.baselineResult, state.downloadResult, state.targetResult);
    state.scoreResult = score;
    ui.updateScoreDisplay(score);

    const analysis = analyzer.analyzeNetwork(state.baselineResult, state.downloadResult, state.targetResult);
    state.analysisResult = analysis;
    renderAnalysisOutput(analysis);

    // Update Text Report Preview
    const reportPreview = window.NQA_UI.$('text-report-preview');
    if (reportPreview) {
      reportPreview.textContent = analyzer.generateTextReport(
        state.baselineResult, state.downloadResult, state.uploadResult, state.targetResult, analysis, score
      );
    }
  }

  /**
   * Renders Diagnostic Output Card
   */
  function renderAnalysisOutput(analysis) {
    const container = window.NQA_UI.$('diagnostic-output');
    if (!container || !analysis) return;

    let findingsHtml = analysis.findings.map(f => `<li>✓ ${f}</li>`).join('');
    let causesHtml = analysis.possibleCauses.length > 0 ? analysis.possibleCauses.map(c => `<li>• ${c}</li>`).join('') : '<li>• 특이 장애 요인 없음</li>';
    let recoHtml = analysis.recommendations.length > 0 ? analysis.recommendations.map(r => `<li>👉 ${r}</li>`).join('') : '<li>👉 현재 조치할 사항 없음</li>';

    container.innerHTML = `
      <div class="verdict-banner verdict-${analysis.verdictClass}">
        <div class="verdict-top">
          <span class="verdict-badge">${analysis.verdict}</span>
          <span class="confidence-badge">신뢰도: ${analysis.confidence}% (INFERRED)</span>
        </div>
        <h3 class="verdict-title">${analysis.verdictTitle}</h3>
      </div>
      <div class="diag-details-grid">
        <div class="diag-col">
          <h4>측정 분석 근거 (Findings)</h4>
          <ul>${findingsHtml}</ul>
        </div>
        <div class="diag-col">
          <h4>가능 원인 추론 (Possible Root Causes)</h4>
          <ul>${causesHtml}</ul>
        </div>
        <div class="diag-col">
          <h4>개선 및 엔지니어 가이드 (Recommendations)</h4>
          <ul>${recoHtml}</ul>
        </div>
      </div>
    `;
  }

  /**
   * Renders Baseline vs Target comparison box
   */
  function renderComparisonView() {
    const container = window.NQA_UI.$('comparison-view');
    if (!container || !state.baselineResult || !state.targetResult) return;

    const baseLat = state.baselineResult.stats.median;
    const targetLat = state.targetResult.stats.median;
    const diff = targetLat - baseLat;
    const pct = baseLat > 0 ? Math.round((diff / baseLat) * 100) : 0;

    container.innerHTML = `
      <div class="comp-box">
        <div class="comp-item">
          <span class="label">인터넷 기준선 (Baseline RTT)</span>
          <span class="val">${baseLat} ms</span>
        </div>
        <div class="comp-arrow">➔</div>
        <div class="comp-item">
          <span class="label">목적지 웹사이트 (${state.targetResult.hostname})</span>
          <span class="val">${targetLat} ms</span>
        </div>
        <div class="comp-diff ${diff > 100 ? 'diff-bad' : 'diff-good'}">
          <span class="diff-title">편차 (Difference)</span>
          <span class="diff-val">${diff >= 0 ? '+' + diff : diff} ms (${diff >= 0 ? '+' + pct : pct}%)</span>
        </div>
      </div>
    `;
  }

  // Self Bootstrapping
  window.addEventListener('DOMContentLoaded', initApp);

})(window);
