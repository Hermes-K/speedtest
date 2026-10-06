# Network Quality Analyzer (v2.5 PRO)

> **네트워크 엔지니어 및 웹 성능 분석가를 위한 고신뢰도 클라이언트 사이드 Network Quality & Root-Cause Analyzer WebApp**

---

## 1. 개요 및 목적
단순히 "빠름/느림" 같은 주관적인 판단이 아니라, 네트워크 엔지니어가 장애 분석 및 회선 진단에 즉시 활용할 수 있도록 **측정값, 신뢰도 등급(MEASURED, ESTIMATED, INFERRED, UNAVAILABLE), 기준선 대비 편차 분석, 상세 원인 추론(Server-side vs Client-side)**을 브라우저 100% 로컬 연산으로 제공하는 전문 웹 도구입니다.

---

## 2. 주요 기능 및 진단 매트릭스

| 지표 (Metric) | 측정 방식 (Method) | 신뢰도 등급 | 브라우저 한계 및 엔지니어링 고려사항 |
| :--- | :--- | :--- | :--- |
| **HTTP Latency (Ping)** | `performance.now()` 기반 HTTP RTT (Cache-busting 적용) | `MEASURED` | 브라우저 Sandbox 규정상 ICMP Raw Socket 전송 불가. 어플리케이션 레이어 왕복 지연을 정확히 반영. |
| **Jitter (지터)** | RFC 3550 연속 RTT 지연 편차 통계 | `MEASURED` | 화상회의(Zoom), VoIP, 클라우드 게이밍 품질에 직접적 영향을 주는 편차 산출. |
| **Download Throughput** | 실제 Anycast CDN 바이너리 페이로드 스트림 수신 대역폭 ($Mbps$) | `MEASURED` | 가짜 속도나 단순 휴리스틱 연산 배제. `no-store` 캐시 방지 적용. |
| **Upload Speed** | 인메모리 생성 바이너리 페이로드 POST 스트림 | `UNAVAILABLE` *(수신 서버 미지정 시)* | 수신 엔드포인트가 없는 상태에서 거짓 숫자를 만들지 않고 정직하게 UNAVAILABLE로 표기. |
| **Resource Timing Waterfall** | `PerformanceResourceTiming` (DNS, TCP, TLS, TTFB, Content) | `MEASURED` / `LIMITED` | 서버 측 `Timing-Allow-Origin (TAO)` 헤더 미제공 시 0ms로 왜곡하지 않고 `LIMITED`로 안내. |
| **Client vs Server 판정** | Rule-Based Diagnostic Engine (기준선 RTT 대비 타겟 편차 추론) | `INFERRED` | 회선 자체의 문제인지, 타겟 웹서버 백엔드(WAS/DB) 병목인지 80~95% 신뢰도 기반 진단. |

---

## 3. 실행 환경 및 방법

### A. Finder에서 더블클릭 실행 (`file://`)
- 로컬 웹서버(`node`, `python`, `npx` 등)를 구동할 필요가 전혀 없습니다.
- macOS Finder에서 [index.html](file:///Users/hermes/개인공부/바이브코딩/속도체크/index.html) 또는 [index_portable.html](file:///Users/hermes/개인공부/바이브코딩/속도체크/index_portable.html)을 더블클릭하여 바로 실행할 수 있습니다.
- `file://` 프로토콜에서는 브라우저 보안 규정상 Cross-Origin 요청 제약이 발생할 수 있으며, 이 경우 상단 안내 배너가 안전하게 표시됩니다.

### B. 단일 파일 실행 (Portable Single File)
- [index_portable.html](file:///Users/hermes/개인공부/바이브코딩/속도체크/index_portable.html) 파일 하나에 HTML5, CSS3, ES6+ JavaScript가 완벽히 내장되어 있어 USB 복사, 이메일 첨부, 단일 파일 전송에 최적화되어 있습니다.

### C. GitHub Pages 배포
1. 본 저장소의 모든 파일을 GitHub Repository에 Push합니다.
2. 저장소 설정: `Settings` → `Pages` → `Branch: main`, `Folder: / (root)` 선택 후 Save.
3. `https://<username>.github.io/<repo>/` 주소로 접속하면 전체 CDN 통신 및 실측 기능이 활성화됩니다.

---

## 4. 왜 ICMP Ping이 아닌 HTTP Latency인가?
웹 브라우저는 OS의 커널 Raw Socket 및 ICMP(Internet Control Message Protocol) 패킷을 직접 생성할 수 있는 권한을 제공하지 않습니다. 만약 브라우저 웹앱이 ICMP Ping 또는 Packet Loss라고 단정한다면 이는 기술적 거짓입니다.
본 WebApp은 이를 솔직하게 밝히고 **실제 사용자가 웹 브라우징 중 체감하는 Application Layer (HTTP/HTTPS) Round-Trip Time(RTT)**과 **HTTP 요청 실패율(Failure Rate)**을 정밀하게 측정합니다.

---

## 5. Timing-Allow-Origin (TAO) 안내
외부 Cross-Origin 웹사이트를 검사할 때 브라우저 보안 규정(Timing Attack 방지)에 의해 DNS, TCP, TLS 세부 수치가 `0`으로 마스킹됩니다.
본 시스템은 이 경우 0ms로 오판하지 않고 **"측정 제한 (Timing-Allow-Origin 헤더 미제공)"** 상태로 명확히 표시하여 오진을 방지합니다.

---

## 6. 개인정보 및 보안 준수 정책
- **100% Client-Side 연산**: 측정값, IP, URL 기록 등 일체의 정보를 수집하거나 외부 서버/DB로 전송하지 않습니다.
- **안전한 DOM 렌더링**: XSS 취약점을 방지하기 위해 사용자 URL 및 입력값을 `innerHTML`에 삽입하지 않고 정규화 및 `textContent`로 안전하게 바인딩합니다.
- `javascript:`, `data:`, `file:` 등 위험 스킴 입력을 자동 차단합니다.
