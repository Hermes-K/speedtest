/**
 * analyzer.js - Rule-Based Diagnostic Engine & Quality Scoring System
 * 
 * Provides:
 * - Diagnostic rules for root-cause inference (Server vs Client vs DNS vs TLS)
 * - Transparent scoring algorithms (0-100) with detailed sub-scores
 * - High-confidence grading metrics
 * - Korean technical explanations and actionable remediation steps
 */

(function (window) {
  'use strict';

  // Diagnostic Threshold Constants (Fully customizable for network engineers)
  const THRESHOLDS = {
    latency: {
      excellent: 20, // < 20ms
      good: 50,      // 20 ~ 50ms
      normal: 100,   // 50 ~ 100ms
      slow: 200      // 100 ~ 200ms, >200 Very Slow
    },
    jitter: {
      excellent: 5,  // < 5ms
      good: 15,      // 5 ~ 15ms
      warning: 30    // 15 ~ 30ms, >30 Poor
    },
    failureRate: {
      excellent: 0,
      acceptable: 2,
      warning: 5,
      critical: 10
    },
    download: {
      excellent: 100, // > 100 Mbps
      good: 50,       // 50 ~ 100 Mbps
      normal: 20,     // 20 ~ 50 Mbps
      slow: 5         // 5 ~ 20 Mbps, <5 Very Slow
    },
    ttfb: {
      excellent: 100, // < 100ms
      good: 300,      // 100 ~ 300ms
      normal: 600,    // 300 ~ 600ms
      slow: 1000      // 600 ~ 1000ms, >1000 Very Slow
    },
    dns: {
      excellent: 15,
      good: 40,
      warning: 80
    },
    tcp: {
      excellent: 30,
      good: 70,
      warning: 120
    },
    tls: {
      excellent: 40,
      good: 90,
      warning: 150
    }
  };

  /**
   * Evaluates performance tier based on metric value and threshold ranges
   * @param {number} val Measured value
   * @param {Object} thresh Threshold definition
   * @param {boolean} [lowerIsBetter=true]
   * @returns {{tier: string, label: string, color: string}}
   */
  function evaluateTier(val, thresh, lowerIsBetter = true) {
    if (val === null || val === undefined || isNaN(val)) {
      return { tier: 'UNKNOWN', label: '측정 불가', color: 'gray' };
    }

    if (lowerIsBetter) {
      if (val <= thresh.excellent) return { tier: 'EXCELLENT', label: '매우 우수 (Excellent)', color: 'emerald' };
      if (val <= thresh.good) return { tier: 'GOOD', label: '우수 (Good)', color: 'blue' };
      if (thresh.normal && val <= thresh.normal) return { tier: 'NORMAL', label: '보통 (Normal)', color: 'amber' };
      if (thresh.warning && val <= thresh.warning) return { tier: 'WARNING', label: '주의 (Warning)', color: 'amber' };
      return { tier: 'POOR', label: '지연/불안정 (Poor)', color: 'rose' };
    } else {
      if (val >= thresh.excellent) return { tier: 'EXCELLENT', label: '매우 우수 (Excellent)', color: 'emerald' };
      if (val >= thresh.good) return { tier: 'GOOD', label: '우수 (Good)', color: 'blue' };
      if (val >= thresh.normal) return { tier: 'NORMAL', label: '보통 (Normal)', color: 'amber' };
      if (val >= thresh.slow) return { tier: 'SLOW', label: '다소 느림 (Slow)', color: 'amber' };
      return { tier: 'POOR', label: '매우 느림 (Very Slow)', color: 'rose' };
    }
  }

  /**
   * Calculates overall Network Quality Score (0 to 100)
   * Formula is transparently weighted and deterministically derived.
   * @param {Object} baseline Latency/Jitter/Failure result
   * @param {Object} download Download result
   * @param {Object} target Website test result (optional)
   * @returns {Object} Total score, sub-scores, and qualitative rating
   */
  function calculateScore(baseline, download, target = null) {
    // 1. Latency Sub-score (max 30 pts)
    let latencyScore = 30;
    if (baseline && baseline.stats && baseline.stats.median > 0) {
      const lat = baseline.stats.median;
      if (lat <= 15) latencyScore = 30;
      else if (lat <= 30) latencyScore = 27;
      else if (lat <= 60) latencyScore = 22;
      else if (lat <= 100) latencyScore = 16;
      else if (lat <= 200) latencyScore = 10;
      else latencyScore = 4;
    } else {
      latencyScore = 20; // Default fallback
    }

    // 2. Stability & Jitter Sub-score (max 25 pts)
    let stabilityScore = 25;
    if (baseline) {
      const jit = baseline.jitter || 0;
      const fail = baseline.failureRate || 0;

      if (jit <= 3) stabilityScore -= 0;
      else if (jit <= 8) stabilityScore -= 3;
      else if (jit <= 18) stabilityScore -= 7;
      else if (jit <= 35) stabilityScore -= 12;
      else stabilityScore -= 18;

      if (fail > 0) {
        stabilityScore -= Math.min(15, fail * 2);
      }
      stabilityScore = Math.max(0, stabilityScore);
    }

    // 3. Download Sub-score (max 25 pts)
    let downloadScore = 20;
    if (download && download.mbps > 0) {
      const mbps = download.mbps;
      if (mbps >= 300) downloadScore = 25;
      else if (mbps >= 100) downloadScore = 23;
      else if (mbps >= 50) downloadScore = 19;
      else if (mbps >= 20) downloadScore = 14;
      else if (mbps >= 5) downloadScore = 8;
      else downloadScore = 4;
    }

    // 4. Target Site Accessibility Sub-score (max 20 pts)
    let websiteScore = 20;
    if (target && target.stats && target.stats.median > 0) {
      const respTime = target.stats.median;
      if (respTime <= 150) websiteScore = 20;
      else if (respTime <= 350) websiteScore = 17;
      else if (respTime <= 700) websiteScore = 12;
      else if (respTime <= 1500) websiteScore = 7;
      else websiteScore = 2;

      if (target.failureRate > 0) {
        websiteScore -= Math.min(10, target.failureRate);
      }
      websiteScore = Math.max(0, websiteScore);
    }

    const totalScore = Math.min(100, Math.max(0, latencyScore + stabilityScore + downloadScore + websiteScore));

    let grade = 'Excellent';
    let gradeKo = '매우 우수';
    let gradeColor = 'emerald';

    if (totalScore >= 90) {
      grade = 'Excellent';
      gradeKo = '최상급 네트워크 품질';
      gradeColor = 'emerald';
    } else if (totalScore >= 75) {
      grade = 'Good';
      gradeKo = '원활한 정상 품질';
      gradeColor = 'blue';
    } else if (totalScore >= 55) {
      grade = 'Normal';
      gradeKo = '일반적 웹서핑 가능 (경미한 지연)';
      gradeColor = 'amber';
    } else if (totalScore >= 35) {
      grade = 'Warning';
      gradeKo = '품질 저하 감지 (지연 및 패킷 손실)';
      gradeColor = 'orange';
    } else {
      grade = 'Critical';
      gradeKo = '심각한 네트워크 장애/불안정';
      gradeColor = 'rose';
    }

    return {
      totalScore,
      grade,
      gradeKo,
      gradeColor,
      breakdown: {
        latency: { score: latencyScore, max: 30, label: '회선 지연율 (Latency)' },
        stability: { score: stabilityScore, max: 25, label: '지터 및 안정성 (Stability)' },
        download: { score: downloadScore, max: 25, label: '다운로드 대역폭 (Throughput)' },
        website: { score: websiteScore, max: 20, label: '목적지 응답성 (Target Website)' }
      }
    };
  }

  /**
   * Diagnostic Engine: Performs root-cause analysis
   * Compares Baseline Network against Target Website performance
   * @param {Object} baseline Baseline measurement
   * @param {Object} download Download measurement
   * @param {Object} target Target website measurement
   * @returns {Object} Structured diagnostic report
   */
  function analyzeNetwork(baseline, download, target) {
    const findings = [];
    const possibleCauses = [];
    const recommendations = [];

    const baseLat = baseline && baseline.stats ? baseline.stats.median : 0;
    const baseJitter = baseline ? baseline.jitter : 0;
    const baseFail = baseline ? baseline.failureRate : 0;
    const dlSpeed = download ? download.mbps : 0;

    const targetMedian = target && target.stats ? target.stats.median : 0;
    const targetFail = target ? target.failureRate : 0;
    const targetTtfb = target ? target.ttfb : null;
    const timing = target ? target.timingData : null;

    let verdict = 'NORMAL';
    let verdictTitle = '네트워크 및 사이트 상태 정상';
    let verdictClass = 'success';
    let confidence = 85;

    // Rule 1: High target response while general network is great
    if (baseLat > 0 && baseLat < 60 && baseJitter < 15 && targetMedian > 0) {
      const ratio = targetMedian / baseLat;
      if (targetMedian > 700 || ratio >= 3.5) {
        verdict = 'SERVER_SIDE_SUSPECTED';
        verdictTitle = '대상 서버(Server-Side) 처리 지연 유력';
        verdictClass = 'warning';
        confidence = 90;

        findings.push('사용자의 인터넷 회선 RTT는 ' + baseLat + 'ms로 매우 정상적입니다.');
        findings.push('다운로드 대역폭(' + dlSpeed + ' Mbps) 및 지터(' + baseJitter + 'ms)가 안정적입니다.');
        findings.push('그러나 대상 웹사이트 응답속도는 ' + targetMedian + 'ms로 기준선 대비 ' + Math.round(ratio * 100) + '% 수준으로 지연됩니다.');

        possibleCauses.push('대상 웹 서버 백엔드 어플리케이션 처리 지연 (Slow API/WAS)');
        possibleCauses.push('서버 측 데이터베이스(DB) 복잡 쿼리 락 또는 대기');
        possibleCauses.push('대상 서버의 CPU/메모리 부하 및 동시 접속자 폭증');
        possibleCauses.push('Reverse Proxy (Nginx/Cloudflare)와 오리진 서버 간 통신 병목');

        recommendations.push('사용자 측 네트워크 장비(공유기 등)를 재부팅할 필요는 없습니다.');
        recommendations.push('해당 웹서비스 운영팀에 서버 APM 및 백엔드 트랜잭션 응답 지연을 문의하세요.');
      }
    }

    // Rule 2: Client local network is degraded overall
    if (baseLat >= 120 || baseJitter >= 25 || baseFail >= 5) {
      verdict = 'CLIENT_NETWORK_SUSPECTED';
      verdictTitle = '사용자 측 로컬/인터넷 회선(Client-Side) 품질 저하';
      verdictClass = 'critical';
      confidence = 88;

      findings.push('공용 기준 엔드포인트에 대한 평균 지연시간이 ' + baseLat + 'ms로 매우 높습니다.');
      findings.push('Jitter가 ' + baseJitter + 'ms로 불안정하며 요청 실패율이 ' + baseFail + '%에 달합니다.');

      possibleCauses.push('Wi-Fi 무선 신호 간섭 또는 낮은 RSSI 감도');
      possibleCauses.push('동일 로컬 네트워크 내 타 기기의 대용량 트래픽 점유 (Bufferbloat)');
      possibleCauses.push('VPN 또는 로컬 보안 프록시 프로그램 경유에 따른 지연');
      possibleCauses.push('가입 ISP(통신사) 게이트웨이 또는 지역망 혼잡');

      recommendations.push('Wi-Fi 대신 유선 이더넷(LAN 케이블)을 연결해 보세요.');
      recommendations.push('활성화된 사내/개인 VPN 및 프록시를 일시 해제한 후 재측정하세요.');
      recommendations.push('공유기 재부팅 및 공유기 펌웨어 업데이트를 권장합니다.');
    }

    // Rule 3: Network is generally fast but heavily jittery
    if (baseLat < 60 && baseJitter >= 20 && verdict !== 'CLIENT_NETWORK_SUSPECTED') {
      verdict = 'UNSTABLE_NETWORK';
      verdictTitle = '네트워크 지터(Jitter) 편차 과다로 인한 스트리밍/게임 체감 저하';
      verdictClass = 'warning';
      confidence = 82;

      findings.push('평균 응답속도는 양호하나 연속 요청 간 편차(Jitter)가 ' + baseJitter + 'ms로 큽니다.');
      possibleCauses.push('무선 주파수(2.4GHz) 대역 간섭 또는 패킷 순간 재전송');
      possibleCauses.push('스위치/라우터 버퍼 큐 가변 지연');
      recommendations.push('5GHz 또는 6GHz Wi-Fi 대역으로 접속하거나 채널을 변경하세요.');
    }

    // Rule 4: ResourceTiming Detailed Granular Diagnosis (if TAO permitted)
    if (timing && timing.statusGrade === 'MEASURED') {
      // Check DNS
      if (timing.dns > THRESHOLDS.dns.warning && timing.tcp < 50) {
        findings.push('DNS 질의(Lookup) 시간이 ' + timing.dns + 'ms로 비정상적으로 깁니다.');
        possibleCauses.push('로컬 DNS Resolver(통신사 DNS) 캐시 미스 또는 느린 응답');
        recommendations.push('PC 또는 공유기의 DNS 서버를 1.1.1.1(Cloudflare) 또는 8.8.8.8(Google)로 변경해 보세요.');
      }
      // Check TCP
      if (timing.tcp > THRESHOLDS.tcp.warning) {
        findings.push('TCP Handshake 수립 시간이 ' + timing.tcp + 'ms로 물리적 거리가 멀거나 라우팅이 우회되고 있습니다.');
        possibleCauses.push('물리적으로 해외에 위치한 호스팅 서버 또는 해외망 회선 정체');
      }
      // Check TLS
      if (timing.tls > 100 && (timing.tls > timing.tcp * 2)) {
        findings.push('TLS 암호화 협상 시간이 ' + timing.tls + 'ms로 TCP 시간에 비해 현저히 높습니다.');
        possibleCauses.push('SSL/TLS 인증서 체인 과다, 사내 SSL Inspection 장비 검사 지연');
      }
    } else if (target && target.corsRestricted) {
      findings.push('대상 사이트의 CORS 정책으로 브라우저의 직접 응답 페이로드 분석이 제한되었습니다.');
      findings.push('네트워크 연결성(Reachability) 자체는 확인되었으며 HTTP 트랜잭션 RTT를 기준으로 분석을 완료했습니다.');
    }

    // Default clean outcome
    if (findings.length === 0) {
      findings.push('인터넷 기준선 RTT(' + baseLat + 'ms), Jitter(' + baseJitter + 'ms), 다운로드(' + dlSpeed + ' Mbps) 모두 우수합니다.');
      findings.push('목적지 웹사이트(' + (target ? target.hostname : '미지정') + ')와의 네트워크 통신도 원활합니다.');
      recommendations.push('현재 네트워크 환경 및 대상 서버 품질에 특이사항이 없습니다.');
      confidence = 94;
    }

    return {
      verdict,
      verdictTitle,
      verdictClass,
      confidence,
      findings,
      possibleCauses,
      recommendations
    };
  }

  /**
   * Generates formatted text report suitable for copy-paste or engineering records
   * @param {Object} baseline 
   * @param {Object} download 
   * @param {Object} upload 
   * @param {Object} target 
   * @param {Object} analysis 
   * @param {Object} score 
   * @returns {string} Plain text engineering report
   */
  function generateTextReport(baseline, download, upload, target, analysis, score) {
    const now = new Date().toLocaleString();
    const divider = '======================================================================\n';

    let r = '';
    r += divider;
    r += '           NETWORK QUALITY ANALYZER - ENGINEERING REPORT             \n';
    r += divider;
    r += 'Generated Time: ' + now + '\n';
    r += 'Overall Score : ' + (score ? score.totalScore + ' / 100 (' + score.grade + ')' : 'N/A') + '\n';
    r += 'Verdict       : ' + (analysis ? analysis.verdictTitle + ' [Confidence: ' + analysis.confidence + '%]' : 'N/A') + '\n\n';

    r += '[ 1. GENERAL INTERNET BASELINE ]\n';
    if (baseline && baseline.stats) {
      r += '  - HTTP Latency (RTT) : ' + baseline.stats.median + ' ms (Median) | Min: ' + baseline.stats.min + 'ms | Max: ' + baseline.stats.max + 'ms\n';
      r += '  - Jitter (RFC 3550)  : ' + baseline.jitter + ' ms\n';
      r += '  - HTTP Failure Rate  : ' + baseline.failureRate + ' % (' + baseline.failedCount + '/' + baseline.totalRequests + ' failed)\n';
      r += '  - Standard Deviation : ' + baseline.stats.stdDev + ' ms\n';
      r += '  - Status Grade       : ' + baseline.statusGrade + '\n';
    } else {
      r += '  - No baseline data available.\n';
    }

    r += '\n[ 2. THROUGHPUT PERFORMANCE ]\n';
    if (download) {
      r += '  - Download Throughput: ' + download.mbps + ' Mbps [' + download.statusGrade + ']\n';
    }
    if (upload) {
      r += '  - Upload Throughput  : ' + (upload.statusGrade === 'MEASURED' ? upload.mbps + ' Mbps' : 'UNAVAILABLE (' + upload.reason + ')') + '\n';
    }

    r += '\n[ 3. TARGET WEBSITE DIAGNOSTICS ]\n';
    if (target && target.stats) {
      r += '  - Target URL         : ' + target.url + '\n';
      r += '  - Response Time (RTT): ' + target.stats.median + ' ms (Median) | Avg: ' + target.stats.average + 'ms | P95: ' + target.stats.p95 + 'ms\n';
      r += '  - TTFB (Estimated)   : ' + target.ttfb + ' ms [' + target.ttfbGrade + ']\n';
      r += '  - CORS Status        : ' + (target.corsRestricted ? 'RESTRICTED (no-cors fallback used)' : 'PERMITTED') + '\n';
      r += '  - Timing-Allow-Origin: ' + (target.timingAllowed ? 'PERMITTED (Granular timing measured)' : 'RESTRICTED (Browser masked timing to 0ms)') + '\n';

      if (target.timingData && target.timingData.statusGrade === 'MEASURED') {
        r += '    * DNS Lookup       : ' + target.timingData.dns + ' ms [MEASURED]\n';
        r += '    * TCP Connect      : ' + target.timingData.tcp + ' ms [MEASURED]\n';
        r += '    * TLS Handshake    : ' + target.timingData.tls + ' ms [MEASURED]\n';
        r += '    * TTFB (Pure)      : ' + target.timingData.ttfb + ' ms [MEASURED]\n';
        r += '    * Content Download : ' + target.timingData.download + ' ms [MEASURED]\n';
      }
    } else {
      r += '  - Target website was not tested.\n';
    }

    r += '\n[ 4. ROOT CAUSE & FINDINGS ]\n';
    if (analysis) {
      r += '  Findings:\n';
      analysis.findings.forEach(f => { r += '    * ' + f + '\n'; });
      if (analysis.possibleCauses.length > 0) {
        r += '  Possible Root Causes:\n';
        analysis.possibleCauses.forEach(c => { r += '    * ' + c + '\n'; });
      }
      if (analysis.recommendations.length > 0) {
        r += '  Recommendations:\n';
        analysis.recommendations.forEach(m => { r += '    * ' + m + '\n'; });
      }
    }

    r += '\n[ 5. BROWSER ENVIRONMENT ]\n';
    r += '  - User Agent: ' + navigator.userAgent + '\n';
    r += '  - Execution Mode: ' + window.location.protocol + '\n';
    r += divider;
    return r;
  }

  // Export to Global
  window.NQA_Analyzer = {
    THRESHOLDS,
    evaluateTier,
    calculateScore,
    analyzeNetwork,
    generateTextReport
  };

})(window);
