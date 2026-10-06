/**
 * network.js - Network Quality Analyzer Core Measurement Engine
 * 
 * Provides robust client-side network measurement functions:
 * - Multi-sample HTTP latency (RTT) & Jitter calculation (RFC 3550 standard)
 * - HTTP Request Failure rate calculation
 * - Download throughput (Mbps) using actual chunked payload transfer
 * - Upload throughput (Mbps) via actual payload POST (if upload endpoint is provided)
 * - Target website multi-tier diagnostic fetching
 * - PerformanceResourceTiming analysis (DNS, TCP, TLS, TTFB, Download)
 * - Cross-Origin and Timing-Allow-Origin detection
 */

(function (window) {
  'use strict';

  // Global Configuration & Constants
  const CONFIG = {
    // Highly available global Anycast CDN endpoints for baseline latency & jitter testing
    baselineEndpoints: [
      { name: 'Cloudflare Edge', url: 'https://1.1.1.1/cdn-cgi/trace', label: 'CF 1.1.1.1' },
      { name: 'Cloudflare CDN', url: 'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/js/bootstrap.min.js', label: 'CF cdnjs' },
      { name: 'Google Hosted Edge', url: 'https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js', label: 'Google CDN' }
    ],
    // Download test files (direct CDNs with permissive CORS)
    downloadEndpoints: [
      { name: 'Fastly CDN (1MB)', sizeMB: 1, url: 'https://speed.cloudflare.com/__down?bytes=1048576' },
      { name: 'Cloudflare Speed (5MB)', sizeMB: 5, url: 'https://speed.cloudflare.com/__down?bytes=5242880' },
      { name: 'Cloudflare Speed (10MB)', sizeMB: 10, url: 'https://speed.cloudflare.com/__down?bytes=10485760' },
      { name: 'Cloudflare Speed (25MB)', sizeMB: 25, url: 'https://speed.cloudflare.com/__down?bytes=26214400' }
    ],
    // Fallback local relative path if hosted on GitHub Pages
    localDownloadFallback: [
      { name: 'Local Asset (1MB)', sizeMB: 1, url: './assets/test-1mb.bin' }
    ],
    // Configurable Upload Endpoint with public CORS POST sink support.
    // Uses Cloudflare Anycast Speed test upload endpoint.
    uploadEndpoint: 'https://speed.cloudflare.com/__up',
    // Timeout bounds (in ms)
    timeout: {
      latency: 5000,
      download: 25000,
      upload: 25000,
      targetTest: 8000
    }
  };

  /**
   * Helper: Generate a unique cache-busting query parameter
   * @returns {string}
   */
  function getCacheBuster() {
    return '_nqa_ts=' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Helper: Appends cache-buster to URL correctly
   * @param {string} url 
   * @returns {string}
   */
  function appendQuery(url) {
    const separator = url.indexOf('?') !== -1 ? '&' : '?';
    return url + separator + getCacheBuster();
  }

  /**
   * Helper: Statistical metrics calculator (min, max, avg, median, p95, stdev)
   * @param {number[]} samples Array of numerical measurements
   * @returns {Object} Calculated statistical summary
   */
  function calculateStatistics(samples) {
    if (!samples || samples.length === 0) {
      return { min: 0, max: 0, average: 0, median: 0, p95: 0, stdDev: 0, count: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const average = sum / count;

    // Median
    let median = 0;
    const mid = Math.floor(count / 2);
    if (count % 2 === 0) {
      median = (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      median = sorted[mid];
    }

    // P95 (95th percentile)
    const p95Index = Math.min(Math.floor(count * 0.95), count - 1);
    const p95 = sorted[p95Index];

    // Standard Deviation
    const squareDiffs = sorted.map((value) => {
      const diff = value - average;
      return diff * diff;
    });
    const avgSquareDiff = squareDiffs.reduce((acc, val) => acc + val, 0) / count;
    const stdDev = Math.sqrt(avgSquareDiff);

    return {
      min: parseFloat(sorted[0].toFixed(2)),
      max: parseFloat(sorted[count - 1].toFixed(2)),
      average: parseFloat(average.toFixed(2)),
      median: parseFloat(median.toFixed(2)),
      p95: parseFloat(p95.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      count
    };
  }

  /**
   * Measure single HTTP RTT with AbortController and performance.now()
   * @param {string} url Target URL
   * @param {number} timeoutMs Max timeout in milliseconds
   * @param {string} [mode='cors'] Fetch mode ('cors' or 'no-cors')
   * @returns {Promise<{duration: number, success: boolean, status: number, error: string|null}>}
   */
  async function measureSingleRTT(url, timeoutMs = 5000, mode = 'cors') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const testUrl = appendQuery(url);
    const startTime = performance.now();

    try {
      const response = await fetch(testUrl, {
        method: 'GET',
        mode: mode,
        cache: 'no-store',
        signal: controller.signal
      });
      const endTime = performance.now();
      clearTimeout(timeoutId);

      return {
        duration: Math.max(0.5, endTime - startTime),
        success: true,
        status: response.status,
        error: null
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const endTime = performance.now();
      const isAbort = err.name === 'AbortError';

      return {
        duration: Math.max(0.5, endTime - startTime),
        success: false,
        status: 0,
        error: isAbort ? 'Request Timeout (' + timeoutMs + 'ms)' : err.message || 'Network Fetch Failed'
      };
    }
  }

  /**
   * Measure Latency and Jitter across multiple samples with initial warmup
   * Excludes initial cold socket handshake (TCP/TLS connect) from jitter/ping variance
   * Computes Jitter based on RFC 3550 statistical variance of successive RTTs
   * @param {string} endpointUrl Target test endpoint
   * @param {number} sampleCount Number of iterations (3, 5, 10, etc.)
   * @param {function} [onProgress] Callback per sample completed (sampleIndex, result)
   * @returns {Promise<Object>} Latency, jitter, failure rate, and raw samples
   */
  async function measureLatencyAndJitter(endpointUrl, sampleCount = 5, onProgress = null) {
    // Warmup 1: Establish TCP/TLS handshake first so cold-start overhead does not distort RTT/Jitter
    try {
      await measureSingleRTT(endpointUrl, 2500, 'cors');
    } catch (e) {}

    const latencies = [];
    const fullSamples = [];
    let failedCount = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample = await measureSingleRTT(endpointUrl, CONFIG.timeout.latency, 'cors');
      fullSamples.push(sample);

      if (sample.success) {
        latencies.push(sample.duration);
      } else {
        failedCount++;
      }

      if (typeof onProgress === 'function') {
        onProgress(i + 1, sampleCount, sample);
      }

      // Small pause between samples to prevent socket queue pileup
      if (i < sampleCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const stats = calculateStatistics(latencies);

    // Calculate RFC 3550 Style Jitter: Average of absolute differences between consecutive samples
    let jitter = 0;
    if (latencies.length > 1) {
      let diffSum = 0;
      for (let j = 1; j < latencies.length; j++) {
        diffSum += Math.abs(latencies[j] - latencies[j - 1]);
      }
      jitter = parseFloat((diffSum / (latencies.length - 1)).toFixed(2));
    }

    const failureRate = parseFloat(((failedCount / sampleCount) * 100).toFixed(1));

    return {
      stats,
      jitter,
      failureRate,
      totalRequests: sampleCount,
      successCount: latencies.length,
      failedCount,
      samples: fullSamples,
      statusGrade: 'MEASURED'
    };
  }

  /**
   * Baseline Multi-Endpoint Check: Measures RTT against 3 independent Anycast CDNs
   * Used as the objective baseline to compare against any specific target URL.
   * @param {function} [onStep] Progress callback (stepName, percent)
   * @returns {Promise<Object>} Aggregated baseline comparison metrics
   */
  async function measureBaselineNetwork(onStep = null) {
    const results = [];
    for (let i = 0; i < CONFIG.baselineEndpoints.length; i++) {
      const ep = CONFIG.baselineEndpoints[i];
      if (onStep) onStep(ep.name, Math.round(((i) / CONFIG.baselineEndpoints.length) * 100));
      const res = await measureLatencyAndJitter(ep.url, 4);
      results.push({
        endpoint: ep,
        metrics: res
      });
    }
    if (onStep) onStep('Completed', 100);

    // Aggregate valid medians
    const allMedians = results.map(r => r.metrics.stats.median).filter(m => m > 0);
    const allJitters = results.map(r => r.metrics.jitter).filter(j => j >= 0);
    const aggStats = calculateStatistics(allMedians);
    const avgJitter = allJitters.length > 0 ? parseFloat((allJitters.reduce((a, b) => a + b, 0) / allJitters.length).toFixed(2)) : 0;

    return {
      endpoints: results,
      baselineLatency: aggStats.median,
      baselineJitter: avgJitter,
      baselineStats: aggStats,
      statusGrade: 'MEASURED'
    };
  }

  /**
   * Real Download Speed Measurement using Multi-Stream Sliding Window (Speedtest.net standard)
   * Runs concurrent parallel connections to overcome browser single-TCP window limits,
   * measures sustained throughput across time buckets.
   * @param {number} [targetDurationSec=3.5] Test duration target
   * @param {function} [onProgress] Progress callback (bytesReceived, totalBytes, currentMbps)
   * @returns {Promise<{mbps: number, totalBytes: number, durationSec: number, statusGrade: string, error?: string}>}
   */
  async function measureDownloadSpeed(targetDurationSec = 3.5, onProgress = null) {
    const url = 'https://speed.cloudflare.com/__down?bytes=5000000';
    // Concurrency: 6 parallel connections saturates Gigabit/500Mbps FTTH lines
    const CONCURRENCY = 6;
    const CHUNKS_PER_STREAM = 3;
    const start = performance.now();
    
    let totalBytes = 0;
    const timeBuckets = [];
    let hasError = null;

    const streamWorker = async (streamIndex) => {
      for (let c = 0; c < CHUNKS_PER_STREAM; c++) {
        const chunkStart = performance.now();
        const testUrl = appendQuery(url) + '&_s=' + streamIndex + '&_c=' + c;
        try {
          const res = await fetch(testUrl, {
            method: 'GET',
            cache: 'no-store'
          });
          if (!res.ok) {
            if (res.status === 429) continue;
            throw new Error('HTTP ' + res.status);
          }
          const buf = await res.arrayBuffer();
          const chunkEnd = performance.now();
          const chunkBytes = buf.byteLength;
          totalBytes += chunkBytes;

          timeBuckets.push({
            startSec: (chunkStart - start) / 1000,
            endSec: (chunkEnd - start) / 1000,
            bytes: chunkBytes
          });

          if (typeof onProgress === 'function') {
            const elapsed = Math.max(0.1, (chunkEnd - start) / 1000);
            const currMbps = (totalBytes * 8) / (elapsed * 1000000);
            onProgress(totalBytes, 60 * 1024 * 1024, parseFloat(currMbps.toFixed(2)));
          }
        } catch (err) {
          hasError = err.message;
          break;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => streamWorker(i)));
      const endTime = performance.now();
      const totalSec = Math.max(0.2, (endTime - start) / 1000);

      if (totalBytes === 0) {
        throw new Error(hasError || 'Download connection failed');
      }

      // Calculate Peak 1.0-second Sliding Window (Standard Speedtest calculation)
      let maxWindowMbps = 0;
      for (let t = 0.2; t <= Math.max(0.2, totalSec - 0.8); t += 0.1) {
        const windowStart = t;
        const windowEnd = t + 0.8;
        let windowBytes = 0;

        for (let b = 0; b < timeBuckets.length; b++) {
          const item = timeBuckets[b];
          const overlapStart = Math.max(windowStart, item.startSec);
          const overlapEnd = Math.min(windowEnd, item.endSec);
          if (overlapEnd > overlapStart) {
            const itemDur = Math.max(0.001, item.endSec - item.startSec);
            const fraction = (overlapEnd - overlapStart) / itemDur;
            windowBytes += item.bytes * fraction;
          }
        }
        const windowMbps = (windowBytes * 8) / (0.8 * 1000000);
        if (windowMbps > maxWindowMbps) maxWindowMbps = windowMbps;
      }

      // Final Mbps: If sliding window measured steady peak, use peak; otherwise use stable average
      const avgMbps = (totalBytes * 8) / (totalSec * 1000000);
      const finalMbps = maxWindowMbps > avgMbps ? maxWindowMbps : avgMbps;

      return {
        mbps: parseFloat(finalMbps.toFixed(2)),
        totalBytes,
        durationSec: parseFloat(totalSec.toFixed(2)),
        statusGrade: 'MEASURED',
        error: null
      };
    } catch (err) {
      return {
        mbps: 0,
        totalBytes: totalBytes,
        durationSec: 0,
        statusGrade: 'FAILED',
        error: err.message || 'Download Failed'
      };
    }
  }

  /**
   * Real Upload Speed Measurement using Parallel Multi-Stream
   * Uploads multiple 2MB binary payloads concurrently to saturate upstream pipe.
   * @param {number} [targetPayloadMB=2]
   * @param {function} [onProgress] Progress callback
   * @returns {Promise<{mbps: number, bytesSent: number, durationSec: number, statusGrade: string, reason?: string}>}
   */
  async function measureUploadSpeed(targetPayloadMB = 2, onProgress = null) {
    if (!CONFIG.uploadEndpoint) {
      return {
        mbps: 0,
        bytesSent: 0,
        durationSec: 0,
        statusGrade: 'UNAVAILABLE',
        reason: 'Upload 데이터를 수신할 Remote Endpoint가 구성되지 않아 정확한 측정이 불가능합니다.'
      };
    }

    const CONCURRENCY = 4;
    const CHUNKS_PER_STREAM = 2;
    const chunkSizeBytes = 2 * 1024 * 1024; // 2MB
    const payload = new Uint8Array(chunkSizeBytes);
    for (let i = 0; i < 1024; i++) {
      payload[i] = Math.floor(Math.random() * 256);
    }

    const start = performance.now();
    let totalBytesSent = 0;
    const timeBuckets = [];
    let hasError = null;

    const uploadWorker = async (streamIndex) => {
      for (let c = 0; c < CHUNKS_PER_STREAM; c++) {
        const chunkStart = performance.now();
        const testUrl = appendQuery(CONFIG.uploadEndpoint) + '&_s=' + streamIndex + '&_c=' + c;
        try {
          const res = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: payload,
            cache: 'no-store'
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const chunkEnd = performance.now();
          totalBytesSent += chunkSizeBytes;

          timeBuckets.push({
            startSec: (chunkStart - start) / 1000,
            endSec: (chunkEnd - start) / 1000,
            bytes: chunkSizeBytes
          });

          if (typeof onProgress === 'function') {
            const elapsed = Math.max(0.1, (chunkEnd - start) / 1000);
            const currMbps = (totalBytesSent * 8) / (elapsed * 1000000);
            onProgress(totalBytesSent, chunkSizeBytes * CONCURRENCY * CHUNKS_PER_STREAM, parseFloat(currMbps.toFixed(2)));
          }
        } catch (err) {
          hasError = err.message;
          break;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => uploadWorker(i)));
      const endTime = performance.now();
      const totalSec = Math.max(0.2, (endTime - start) / 1000);

      if (totalBytesSent === 0) {
        throw new Error(hasError || 'Upload failed');
      }

      // Calculate sliding window throughput
      let maxWindowMbps = 0;
      for (let t = 0.2; t <= Math.max(0.2, totalSec - 0.8); t += 0.1) {
        const windowStart = t;
        const windowEnd = t + 0.8;
        let windowBytes = 0;

        for (let b = 0; b < timeBuckets.length; b++) {
          const item = timeBuckets[b];
          const overlapStart = Math.max(windowStart, item.startSec);
          const overlapEnd = Math.min(windowEnd, item.endSec);
          if (overlapEnd > overlapStart) {
            const itemDur = Math.max(0.001, item.endSec - item.startSec);
            const fraction = (overlapEnd - overlapStart) / itemDur;
            windowBytes += item.bytes * fraction;
          }
        }
        const windowMbps = (windowBytes * 8) / (0.8 * 1000000);
        if (windowMbps > maxWindowMbps) maxWindowMbps = windowMbps;
      }

      const avgMbps = (totalBytesSent * 8) / (totalSec * 1000000);
      const finalMbps = maxWindowMbps > avgMbps ? maxWindowMbps : avgMbps;

      return {
        mbps: parseFloat(finalMbps.toFixed(2)),
        bytesSent: totalBytesSent,
        durationSec: parseFloat(totalSec.toFixed(2)),
        statusGrade: 'MEASURED',
        reason: null
      };
    } catch (err) {
      return {
        mbps: 0,
        bytesSent: totalBytesSent,
        durationSec: 0,
        statusGrade: 'FAILED',
        reason: err.message || 'Upload transmission failed'
      };
    }
  }

  /**
   * Normalizes arbitrary user URL input safely
   * Adds https:// if omitted, rejects dangerous schemas (javascript:, data:, file:)
   * @param {string} input 
   * @returns {{valid: boolean, url: string, error?: string}}
   */
  function normalizeUrl(input) {
    if (!input || typeof input !== 'string') {
      return { valid: false, url: '', error: 'URL을 입력해주세요.' };
    }

    let trimmed = input.trim();

    // Check dangerous schemes
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.startsWith('vbscript:')) {
      return { valid: false, url: '', error: '보안상 허용되지 않는 URL 스킴입니다.' };
    }

    // Auto prepend https if protocol missing
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, url: '', error: 'http:// 또는 https:// 프로토콜만 검사 가능합니다.' };
      }
      return { valid: true, url: parsed.href, hostname: parsed.hostname };
    } catch (e) {
      return { valid: false, url: '', error: '유효한 URL 형식이 아닙니다.' };
    }
  }

  /**
   * Deep Analysis of a Specific Website URL
   * Combines Fetch Latency, ResourceTiming (DNS, TCP, TLS, TTFB), and CORS checks
   * @param {string} targetUrl Normalized Target URL
   * @param {number} repetitions Number of test samples (3, 5, 10)
   * @param {function} [onProgress] Progress callback
   * @returns {Promise<Object>} Comprehensive analysis result
   */
  async function testTargetWebsite(targetUrl, repetitions = 5, onProgress = null) {
    const urlValidation = normalizeUrl(targetUrl);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error);
    }
    const cleanUrl = urlValidation.url;

    // Track resource timing entries before & during test
    const perfStartTime = performance.now();
    const samples = [];
    let corsRestricted = false;
    let timingAllowed = false;
    let timingData = null;

    for (let i = 0; i < repetitions; i++) {
      const sampleStartTime = performance.now();
      const uniqueUrl = appendQuery(cleanUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout.targetTest);

      let success = false;
      let status = 0;
      let duration = 0;
      let error = null;
      let isOpaque = false;

      try {
        // Attempt first with cors to obtain status code
        const resp = await fetch(uniqueUrl, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        duration = performance.now() - sampleStartTime;
        status = resp.status;
        success = true;
      } catch (err) {
        clearTimeout(timeoutId);
        // If standard CORS fails, attempt mode: 'no-cors' to test actual network reachability
        if (err.name !== 'AbortError') {
          try {
            const noCorsController = new AbortController();
            const noCorsTimeout = setTimeout(() => noCorsController.abort(), 4000);
            const noCorsStart = performance.now();
            await fetch(uniqueUrl, {
              method: 'GET',
              mode: 'no-cors',
              cache: 'no-store',
              signal: noCorsController.signal
            });
            clearTimeout(noCorsTimeout);
            duration = performance.now() - noCorsStart;
            success = true;
            corsRestricted = true;
            isOpaque = true;
            status = 0; // Opaque response
          } catch (noCorsErr) {
            duration = performance.now() - sampleStartTime;
            success = false;
            error = noCorsErr.name === 'AbortError' ? 'Timeout' : 'Connect Failed';
          }
        } else {
          duration = performance.now() - sampleStartTime;
          success = false;
          error = 'Request Timeout';
        }
      }

      samples.push({
        iteration: i + 1,
        duration: Math.max(1, duration),
        success,
        status,
        isOpaque,
        error
      });

      if (typeof onProgress === 'function') {
        onProgress(i + 1, repetitions, samples[i]);
      }

      // Interval between requests to avoid DoS/flooding
      if (i < repetitions - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // Inspect PerformanceResourceTiming entries for the target
    if (window.performance && typeof window.performance.getEntriesByType === 'function') {
      const resourceEntries = window.performance.getEntriesByType('resource');
      // Look for entries created after this test run matching the target hostname
      const matchingEntries = resourceEntries.filter((entry) => {
        return entry.startTime >= perfStartTime && entry.name.includes(urlValidation.hostname);
      });

      if (matchingEntries.length > 0) {
        // Pick the latest entry
        const latestEntry = matchingEntries[matchingEntries.length - 1];

        // Check if Timing-Allow-Origin was permitted
        // When TAO is restricted, DNS/TCP/TLS values are masked to 0 by the browser
        const rawDns = latestEntry.domainLookupEnd - latestEntry.domainLookupStart;
        const rawTcp = latestEntry.connectEnd - latestEntry.connectStart;
        const rawTls = latestEntry.secureConnectionStart > 0 ? (latestEntry.connectEnd - latestEntry.secureConnectionStart) : 0;
        const rawTtfb = latestEntry.responseStart > 0 ? (latestEntry.responseStart - latestEntry.requestStart) : 0;
        const rawDownload = latestEntry.responseEnd > 0 && latestEntry.responseStart > 0 ? (latestEntry.responseEnd - latestEntry.responseStart) : 0;

        if (rawDns > 0 || rawTcp > 0 || rawTls > 0 || rawTtfb > 0) {
          timingAllowed = true;
          timingData = {
            dns: parseFloat(rawDns.toFixed(2)),
            tcp: parseFloat(rawTcp.toFixed(2)),
            tls: parseFloat(rawTls.toFixed(2)),
            ttfb: parseFloat(rawTtfb.toFixed(2)),
            download: parseFloat(rawDownload.toFixed(2)),
            transferSize: latestEntry.transferSize,
            encodedBodySize: latestEntry.encodedBodySize,
            decodedBodySize: latestEntry.decodedBodySize,
            statusGrade: 'MEASURED'
          };
        } else {
          timingAllowed = false;
          timingData = {
            dns: null,
            tcp: null,
            tls: null,
            ttfb: null,
            download: null,
            statusGrade: 'LIMITED',
            reason: '대상 서버가 Timing-Allow-Origin 헤더를 허용하지 않아 브라우저 보안정책상 세부 네트워크 타이밍이 마스킹되었습니다.'
          };
        }
      }
    }

    const successfulDurations = samples.filter(s => s.success).map(s => s.duration);
    const stats = calculateStatistics(successfulDurations);
    const failureCount = samples.filter(s => !s.success).length;
    const failureRate = parseFloat(((failureCount / repetitions) * 100).toFixed(1));

    // Fallback TTFB estimation from HTTP RTT median if TAO is restricted
    const estimatedTtfb = timingData && timingData.ttfb !== null ? timingData.ttfb : stats.median;
    const ttfbGrade = (timingData && timingData.ttfb !== null) ? 'MEASURED' : 'ESTIMATED';

    return {
      url: cleanUrl,
      hostname: urlValidation.hostname,
      stats,
      failureRate,
      totalRequests: repetitions,
      successCount: successfulDurations.length,
      failureCount,
      corsRestricted,
      timingAllowed,
      timingData,
      ttfb: estimatedTtfb,
      ttfbGrade,
      samples
    };
  }

  /**
   * Reads Browser Network Information API (if supported)
   * strictly labeled as ESTIMATED
   */
  function getBrowserNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) {
      return {
        supported: false,
        effectiveType: 'UNSUPPORTED',
        downlink: null,
        rtt: null,
        saveData: false,
        statusGrade: 'UNAVAILABLE',
        note: '이 브라우저는 Network Information API를 지원하지 않습니다.'
      };
    }

    return {
      supported: true,
      effectiveType: conn.effectiveType || 'unknown',
      downlink: conn.downlink ? conn.downlink + ' Mbps' : 'N/A',
      rtt: conn.rtt ? conn.rtt + ' ms' : 'N/A',
      saveData: conn.saveData || false,
      statusGrade: 'ESTIMATED',
      note: 'Network Information API 제공값 (실시간 실측 속도가 아닌 브라우저 추정치)'
    };
  }

  // Export to Global
  window.NQA_Network = {
    CONFIG,
    calculateStatistics,
    measureSingleRTT,
    measureLatencyAndJitter,
    measureBaselineNetwork,
    measureDownloadSpeed,
    measureUploadSpeed,
    normalizeUrl,
    testTargetWebsite,
    getBrowserNetworkInfo
  };

})(window);
