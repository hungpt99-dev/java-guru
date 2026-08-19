---
title: "Giám sát Hệ thống Phân tán: Bốn Tín hiệu Vàng của Google SRE"
description: "Hướng dẫn dựa trên nguồn về latency, traffic, errors, saturation và cách biến bằng chứng SLO thành cảnh báo có thể hành động."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Giám sát một dịch vụ phân tán là việc thu thập, xử lý, tổng hợp và hiển thị dữ liệu định lượng theo thời gian thực, chẳng hạn số lượng và loại truy vấn, số lượng và loại lỗi, thời gian xử lý và vòng đời máy chủ. Bài toán kỹ thuật không phải là thu thập mọi tín hiệu có thể có; đó là xác định điều gì đang hỏng, hỗ trợ giải thích nguyên nhân, và chỉ làm gián đoạn con người khi hành động là khẩn cấp và có thể nhìn thấy từ phía người dùng. [Nguồn: Google, “Monitoring Distributed Systems,” https://sre.google/sre-book/monitoring-distributed-systems/]

[SOURCE FACT] Một page có chi phí cao: page thường xuyên khiến con người đọc lướt hoặc bỏ qua cảnh báo, và nhiễu có thể che khuất sự cố thật. Vì vậy, nguồn mô tả hệ thống cảnh báo hiệu quả là hệ thống có tín hiệu cao, nhiễu rất thấp, đồng thời nói rằng mỗi page phải có thể hành động được. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Hệ thống phân tán làm bài toán khó hơn vì symptom ở frontend có thể là cause ở backend, trong khi retry có thể che giấu lỗi tại một tầng. Thiết kế giám sát phải bảo toàn cả trải nghiệm người dùng lẫn bằng chứng nội bộ đủ để gỡ lỗi chuỗi dependency, nhưng không được khiến đường đi của page phụ thuộc vào một mô hình nhân quả mong manh.

## 2. What the Original System Did

[SOURCE FACT] Bài viết mô tả các nguyên tắc giám sát của Google SRE, không mô tả một kiến trúc production hoàn chỉnh có tên riêng. Bài viết phân biệt white-box monitoring, dựa trên nội bộ như log và HTTP endpoint có instrument, với black-box monitoring, kiểm tra hành vi bên ngoài mà người dùng nhìn thấy. Google SRE sử dụng nhiều white-box monitoring và một lượng black-box monitoring vừa phải nhưng then chốt. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[SOURCE FACT] Bốn tín hiệu vàng là latency, traffic, errors và saturation. Nếu chỉ có thể đo bốn metric cho một hệ thống hướng người dùng, nguồn khuyến nghị tập trung vào bốn tín hiệu này. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

- [SOURCE FACT] **Latency** là thời gian phục vụ request. Cần phân biệt latency của request thành công và thất bại; HTTP 500 nhanh vẫn là thất bại, còn một lỗi chậm tệ hơn lỗi nhanh.
- [SOURCE FACT] **Traffic** đo nhu cầu bằng metric cấp cao phù hợp với hệ thống, như request mỗi giây, phiên đồng thời hoặc transaction mỗi giây.
- [SOURCE FACT] **Errors** bao gồm lỗi tường minh, kết quả sai dù giao thức báo thành công, và lỗi theo policy như vượt quá mục tiêu thời gian phản hồi đã cam kết.
- [SOURCE FACT] **Saturation** đo mức độ đầy của dịch vụ, tập trung vào resource bị giới hạn nhất. Hệ thống có thể suy giảm trước khi utilization đạt 100%, nên cần có utilization target.

[SOURCE FACT] Nguồn khuyến nghị dùng histogram hoặc bucket latency thay vì chỉ dựa vào mean. Nguồn cũng khuyến nghị các rule page đơn giản, dễ dự đoán và bền vững, trong khi dashboard và phân tích hậu kiểm hỗ trợ chẩn đoán. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Thiết kế có thể áp dụng rộng rãi là tách các mối quan tâm: symptom hướng tới người dùng quyết định page; cause từ white-box làm giàu điều tra; dashboard hiển thị điều kiện chưa nghiêm trọng; dữ liệu dài hạn hỗ trợ capacity planning.

## 3. Architecture Diagram

[ANALYSIS] Sơ đồ tách các khái niệm được nguồn hỗ trợ khỏi implementation được đề xuất cho phỏng vấn hoặc dịch vụ mới. Nguồn không khẳng định Google sử dụng đúng topology thành phần này.

```mermaid
flowchart LR
    U[Users] --> S[Distributed service]
    S --> B[Black-box probes\n[Source-backed component]]
    S --> W[White-box instrumentation\n[Source-backed component]]
    B --> C[Metric collection and aggregation\n[Source-backed component]]
    W --> C
    C --> H[Latency histogram + golden-signal series\n[Proposed component]]
    H --> D[Dashboards and retrospective analysis\n[Source-backed component]]
    H --> R[Simple alert rules\n[Source-backed component]]
    R --> P[Pager / ticket / email\n[Source-backed component]]
    H --> E[SLO/error-budget evaluator\n[Proposed component]]
    E --> R
    W --> X[Logs and dependency evidence\n[Source-backed component]]
    X --> D
```

[SOURCE FACT] Nguồn định nghĩa dashboard là góc nhìn tóm tắt các metric cốt lõi của dịch vụ và phân loại thông báo cho con người thành page, ticket hoặc email alert. Nguồn cũng nói collection, aggregation, alerting và dashboard cơ bản hoạt động tốt như một hệ thống tương đối độc lập. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] SLO/error-budget evaluator được thể hiện như một thành phần riêng để tính nhất quán availability hướng người dùng và lỗi theo policy. Đây là phần mở rộng từ thảo luận về alerting theo SLO của nguồn, không phải tuyên bố về binary nội bộ của Google.

## 4. System Design Analysis

[SOURCE FACT] Hệ thống giám sát phải trả lời hai câu hỏi: “điều gì đang hỏng?” và “tại sao?”. Nguồn gọi câu đầu là symptom, câu sau là cause. Nguồn cảnh báo rằng các dependency-based alerting hierarchy khó bảo trì trong những hệ thống được refactor liên tục. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Một pipeline thực tế nên có hai đường đi:

- Đường symptom ít phức tạp để page: thành công của probe end-to-end, latency request và tỷ lệ error nhìn thấy từ người dùng.
- Đường chẩn đoán giàu thông tin cho dashboard: latency dependency, số retry, queue depth, resource utilization, log, và dấu mốc deploy.

[SOURCE FACT] Black-box monitoring hữu ích cho symptom đang ảnh hưởng người dùng nhưng yếu trong việc phát hiện vấn đề sắp xảy ra; white-box monitoring có thể phát hiện failure sắp xảy ra và failure bị retry che giấu. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] Gắn service, route, status-class và region ổn định vào mỗi metric, nhưng kiểm soát cardinality. Đưa request ID và ngữ cảnh payload chi tiết vào log hoặc trace thay vì metric label. Page phải nêu service và symptom bị ảnh hưởng, dẫn tới dashboard liên quan, và chỉ ra hành động an toàn đầu tiên.

[PROPOSED DESIGN] Định nghĩa SLI là chỉ báo được đo, chẳng hạn tỷ lệ request đủ điều kiện hoàn tất thành công trong giới hạn latency. Định nghĩa SLO là target trong một cửa sổ thời gian cụ thể. Giữ cách tính SLI có thể tái lập từ cùng một quy tắc phân loại request được dashboard và alert sử dụng; nếu không, báo cáo SLO có thể mâu thuẫn với page đã khởi động cuộc điều tra.

## 5. Data Model

[PROPOSED DESIGN] Có thể biểu diễn record time-series tối thiểu như sau:

```sql
CREATE TABLE metric_sample (
  observed_at TIMESTAMP NOT NULL,
  service TEXT NOT NULL,
  signal TEXT NOT NULL,          -- latency, traffic, errors, saturation
  metric TEXT NOT NULL,
  value DOUBLE PRECISION,
  bucket_le_ms INTEGER,
  region TEXT,
  route TEXT,
  status_class TEXT
);
```

[PROPOSED DESIGN] Với latency, lưu histogram bucket tích lũy cùng request count và sum. Cách này hỗ trợ quantile và phân biệt latency của request thành công với thất bại. Với traffic và errors, lưu counter hoặc rate. Với saturation, lưu utilization của resource bị giới hạn và target; lưu riêng các quan sát dự báo để dự báo ổ đĩa đầy trong bốn giờ không bị nhầm với fullness hiện tại.

[SOURCE FACT] Ví dụ của nguồn về internal sampling ghi CPU utilization mỗi giây, tăng bucket với granularity 5%, rồi tổng hợp các giá trị mỗi phút. Nguồn trình bày đây là cách quan sát hotspot ngắn mà giảm chi phí collection và retention. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Retention nên phù hợp với mục đích: dữ liệu độ phân giải cao cho chẩn đoán sự cố, dữ liệu downsample cho xu hướng, và aggregate SLO bền vững cho báo cáo và review. Các khoảng retention cụ thể phụ thuộc dịch vụ và không được nguồn quy định.

## 6. API Design

[PROPOSED DESIGN] Expose một read API nhỏ và giữ việc ghi ở collector nội bộ:

```http
GET /v1/services/{service}/signals?start=...&end=...&region=...
GET /v1/services/{service}/slo?window=...
GET /v1/services/{service}/alerts?state=firing
```

[PROPOSED DESIGN] Response trả về các time bucket đã căn chỉnh, histogram boundary, count và metadata của alert. Bắt buộc caller chỉ định time range và filter label có giới hạn. API nên cung cấp contract summary ổn định, còn log, profiling và debug chi tiết vẫn là các hệ thống riêng.

[SOURCE FACT] Nguồn khuyến nghị giữ monitoring cơ bản tách khỏi profiling, debug một process, load testing, phân tích log và traffic inspection, với các điểm tích hợp rõ ràng, liên kết lỏng như web API cho dữ liệu summary. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

## 7. Scaling Strategy

[SOURCE FACT] Nguồn nói một Google SRE team 10–12 người thường có một, đôi khi hai, người chủ yếu phụ trách monitoring; nguồn cũng nói hạ tầng dùng chung đã dần được tập trung hóa theo thời gian. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] Scale hệ thống đề xuất theo các chiều sau:

- Partition collector theo service và region, sau đó aggregate theo time bucket cố định.
- Aggregate histogram và counter tại chỗ trước khi truyền đi.
- Giới hạn label cardinality và từ chối dimension chưa được phê duyệt ở ingestion.
- Tách dữ liệu gần đây cần truy cập nhanh khỏi storage lịch sử rẻ hơn.
- Làm alert evaluation có thể scale ngang, nhưng giữ mỗi rule deterministic và giải thích độc lập.
- Replicate alert path để sự cố telemetry storage không âm thầm loại bỏ toàn bộ page; đưa health của collector thành một signal riêng.

[SOURCE FACT] Bài viết nói measurement mỗi giây có thể tốn kém và khuyến nghị sampling nội bộ kết hợp aggregation khi cần độ phân giải cao nhưng không cần latency phát hiện cực thấp. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Aggregation giảm chi phí nhưng có thể che giấu spike ngắn nếu thiết kế bucket hoặc histogram kém. Cần giữ đủ thông tin phân phối cho tail latency và kiểm thử hành vi cảnh báo với traffic bursty, không chỉ tải trơn.

## 8. Failure Scenarios

[PROPOSED DESIGN] **Fast failure:** Dependency outage trả về 500 ngay lập tức. Đếm error tách khỏi latency để latency trung bình thấp không khiến dịch vụ trông khỏe mạnh.

[PROPOSED DESIGN] **Slow failure:** Queue tăng làm tail latency tăng trước khi hệ thống hỏng hoàn toàn. Alert trên latency nhìn thấy từ người dùng; dùng queue, CPU hoặc I/O telemetry để chẩn đoán.

[PROPOSED DESIGN] **Masked failure:** Retry biến lỗi backend thành thành công cuối cùng nhưng tiêu thụ capacity. Giữ metric retry và dependency trong white-box telemetry; không page chỉ vì error backend đầu tiên nếu nó chưa độc lập gây ảnh hưởng cho người dùng.

[PROPOSED DESIGN] **Telemetry failure:** Collector hoặc evaluator ngừng báo cáo. Xem dữ liệu monitoring bị thiếu là một điều kiện riêng về health của monitoring và cung cấp đường probe dự phòng.

[SOURCE FACT] Nguồn nói latency tăng có thể là chỉ báo sớm của saturation, và 99th-percentile response time trong một cửa sổ ngắn có thể cung cấp tín hiệu saturation sớm. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[SOURCE FACT] Các câu hỏi review alert của nguồn gồm: điều kiện có khẩn cấp, có thể hành động và nhìn thấy từ người dùng không; có thể vô hại không; người dùng có thực sự bị ảnh hưởng không; và alert khác có bao phủ cùng vấn đề không. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

## 9. Capacity Estimation

[SOURCE FACT] Bài viết đưa ví dụ minh họa một dịch vụ có 1,000 request mỗi giây và latency trung bình 100 ms, trong đó 1% request có thể mất 5 giây. Ví dụ này cho thấy mean che giấu tail như thế nào. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Ví dụ đó hàm ý arrival rate trung bình 1,000 request mỗi giây, nhưng không nêu kích thước event, số series, layout storage hay capacity collector. Không được trình bày các giá trị này như capacity production của Google.

[PROPOSED DESIGN] **Illustrative assumption:** với dịch vụ mới, giả định 2,000 request mỗi giây, 20 series route-region-status được phê duyệt và aggregation 60 giây tại central store. Như vậy có 40,000 quan sát series mỗi phút trước khi mở rộng histogram bucket. Đây là input để lập kế hoạch, không phải source fact. Cần kiểm chứng bằng load test và phân bố label thực tế.

[PROPOSED DESIGN] **Illustrative assumption:** nếu mỗi series phát 20 histogram bucket cộng count và sum, một phút aggregation tạo khoảng 22 value mỗi series mỗi phút. Ước tính storage sau đó phải tính encoding, index, replication và retention; nguồn không quy định các hệ số này.

[SOURCE FACT] Với dịch vụ đặt mục tiêu uptime hằng năm 99.9%, nguồn nói probe status thành công thường xuyên hơn một hoặc hai lần mỗi phút có lẽ là không cần thiết, và kiểm tra disk fullness thường xuyên hơn mỗi 1–2 phút có lẽ cũng không cần thiết. Nguồn cũng nói resolution phù hợp phụ thuộc mục tiêu monitoring. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

## 10. Trade-offs

[ANALYSIS] **Symptom và cause:** Page theo symptom dễ suy luận và gắn trực tiếp hơn với người dùng, nhưng có thể làm chẩn đoán chậm. Metric cause tăng tốc debug, nhưng dependency graph tạo logic alert mong manh.

[ANALYSIS] **Mean và tail:** Mean gọn và rẻ nhưng che giấu latency không đều và shard quá tải. Histogram tốn hơn và cần chọn bucket, nhưng phơi bày tail mà người dùng trải nghiệm.

[ANALYSIS] **Resolution và cost:** Sample chi tiết bắt được spike và làm tăng chi phí storage, network, query. Aggregation giảm chi phí nhưng có nguy cơ xóa mất sự cố ngắn.

[SOURCE FACT] Nguồn ưu tiên monitoring đơn giản, nhanh và phân tích hậu kiểm tốt hơn các hệ thống “magic” tự học threshold hoặc tự động phát hiện causality. Nguồn nói rule page cho con người phải đơn giản và bền vững. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] Bắt đầu với bốn dashboard signal và một page policy nhỏ. Chỉ thêm diagnostic metric khi nó trả lời một câu hỏi sự cố lặp lại hoặc hỗ trợ một hành động đã ghi rõ; loại bỏ dữ liệu không được expose hay sử dụng.

## 11. What We Can Learn From This Architecture

- [SOURCE FACT] Đo latency, traffic, errors và saturation trước tiên cho dịch vụ hướng người dùng. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]
- [SOURCE FACT] Xem SLO là mục tiêu hướng người dùng và biểu diễn failure theo policy, như vượt thời gian phản hồi đã cam kết, dưới dạng error khi phù hợp. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]
- [SOURCE FACT] Giữ page khẩn cấp, có thể hành động và ít nhiễu; dùng dashboard cho điều kiện chưa nghiêm trọng. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]
- [ANALYSIS] Instrument distribution, không chỉ average, vì fan-out phân tán biến tail latency của backend thành trải nghiệm frontend.
- [ANALYSIS] Tách detection khỏi diagnosis. Page có thể đơn giản trong khi dashboard được liên kết thì chi tiết.
- [PROPOSED DESIGN] Quản lý cấu hình monitoring có thể review như code: mỗi page rule cần owner, lý do user impact, hành động trong runbook và test cho các điều kiện vô hại.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] **Bài toán:** thiết kế monitoring platform cho API đa region, phát hiện sự cố nhìn thấy từ phía người dùng, hỗ trợ báo cáo SLO, và giúp kỹ sư tìm cause mà không page cho mọi bất thường nội bộ.

[PROPOSED DESIGN] **Yêu cầu:** ingest bốn signal; tách latency thành công và thất bại; giữ phân phối tail; hỗ trợ black-box probe và white-box metric; đánh giá SLO; cung cấp dashboard; chỉ page cho điều kiện khẩn cấp có thể hành động; chịu được mất telemetry một phần.

[PROPOSED DESIGN] **Write path:** instrumentation của service phát counter, histogram và resource gauge tới regional collector. Collector kiểm tra label, aggregate tại chỗ và chuyển batch tới durable regional buffer. Central aggregator tạo time series có thể query và các cửa sổ SLO. Evaluator riêng đọc cùng series đã chuẩn hóa và phát alert event đã deduplicate.

[PROPOSED DESIGN] **Read path:** Dashboard query aggregate gần đây và lịch sử. Alert dẫn tới một view cố định gồm latency distribution, traffic, error classification, saturation, deploy marker, probe result và dependency evidence. Log và trace được query riêng bằng request hoặc incident identifier.

[PROPOSED DESIGN] **Alert policy:** page khi có symptom khẩn cấp, có thể hành động, nhìn thấy từ người dùng và trước đó chưa được phát hiện. Ticket hoặc chỉ hiển thị trên dashboard phù hợp với xu hướng capacity chưa khẩn cấp và cause dùng để chẩn đoán. Chỉ suppress với context rõ ràng như traffic đã drain, đồng thời giữ audit trail cho việc suppress.

[PROPOSED DESIGN] **Xử lý failure:** buffer khi central store gặp sự cố, đánh dấu data freshness, deduplicate page theo region và duy trì black-box path ít dependency. Nếu automation thực hiện mitigation lặp lại, ghi nhận đó là automation debt và yêu cầu owner dài hạn thay vì để workaround trở nên vô hình.

[ANALYSIS] Thiết kế này cố ý ít “thông minh” hơn một causal inference engine. Bài học cốt lõi của nguồn là bài học vận hành: monitoring hữu ích khi critical path của nó vẫn đơn giản và dễ hiểu trong lúc xảy ra sự cố. [Nguồn: https://sre.google/sre-book/monitoring-distributed-systems/]

## Original Sources

- Company: Google
- Exact Article Title: Monitoring Distributed Systems
- URL: https://sre.google/sre-book/monitoring-distributed-systems/
- What information from the source was used: Định nghĩa monitoring, white-box và black-box monitoring, lý do cần monitoring, bốn tín hiệu vàng, histogram tail latency, resolution đo lường, nguyên tắc SLO và alerting, cùng yêu cầu page đơn giản, có thể hành động và ít nhiễu.
