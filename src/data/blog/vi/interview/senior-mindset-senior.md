---
title: "Phỏng vấn Senior Java: Tư duy và Behavioral"
description: "Phỏng vấn senior test tư duy và giao tiếp ngang với code. Cách trình bày trade-off, thừa nhận không chắc chắn, và kể chuyện chứng tỏ ownership cấp cao."
pubDatetime: 2026-08-10T10:35:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - career
  - behavioral
---

Bar senior không chỉ kỹ thuật. Phỏng vấn viên tuyển người sở hữu sự mơ hồ, giao tiếp trade-off, và nâng tầm team. Nhưng đây là thứ mọi cẩm nang đều nói thiếu: chính vòng behavioral là nơi họ quyết định người vừa "chọi" xong vòng kỹ thuật có an toàn để chỉ tay vào production lúc 2h sáng hay không. Junior phỏng vấn để chứng minh mình _làm được_ việc. Senior phỏng vấn để chứng minh mình _quyết đúng dưới áp lực và khiến những người xung quanh tốt hơn_ — code chỉ là bằng chứng.

Hãy nghĩ tới khác biệt giữa một đầu bếp line cook làm theo công thức và một bếp trưởng có thể nói cho bạn biết _tại sao_ sốt bị tách, nếm rồi sửa, và chỉ huy cả hàng bếp đi qua thay đổi đó mà không bắt lửa. Mọi thứ dưới đây là cơ bắp "nếm và sửa" đó, trong hình hài của một cuộc phỏng vấn.

> Tư duy: đọc thuộc một framework thì bạn chỉ ở tầm mid-level. Đi qua một trade-off bằng số thật, một failure mode trong production, và một câu "tôi sẽ đo trước khi chốt" trung thực — thì bạn chạm nốt "senior". Mỗi phần dưới đây đều kết bằng bài drill mà phỏng vấn viên thực sự chạy.

## 1. Narrate trade-off — hình dạng của một câu trả lời senior

Senior không trả lời "cái nào hơn?" bằng một cái tên. Họ nói: _"tùy thuộc — đây là trade-off, và với X tôi chọn Y vì…"_ Câu đó là cả buổi phỏng vấn được cô đặc lại. Phỏng vấn viên không chấm lựa chọn của bạn; họ chấm _hình dạng_: bạn có biết mỗi phương án phải trả giá gì, và có gắn lựa chọn vào một ràng buộc cụ thể không?

Failure mode của ứng viên mạnh-nhưng-mid là trả lời "cái nào hơn?" bằng một lựa chọn tự tin kèm một dòng giải thích. Nước đi senior là trả lời trong ba nhịp:

1. **Gọi tên phổ lựa chọn.** Hai (hoặc ba) phương án thực sự là gì và mỗi cái đánh đổi gì?
2. **Gắn một con số hoặc cơ chế vào cái giá.** "Exactly-once _processing_ không tồn tại nếu không có idempotency key hay transaction boundary, và cái đó tốn X" — không phải "nó chậm hơn".
3. **Neo vào một ràng buộc.** "Với ngân sách retry của chúng tôi và việc trừ tiền hai lần là một ticket hỗ trợ, tôi chọn at-least-once + idempotent consumer."

### Câu hỏi delivery semantics, trả lời đúng cách

"Anh dùng at-least-once, at-most-once hay exactly-once?" là câu mở màn phổ biến nhất. Câu trả lời naive là "exactly-once". Câu trả lời senior là: exactly-once _như một thuộc tính của broker_ phần lớn là marketing — đảm bảo thật được lắp ráp ở phía consumer, và việc lắp ráp đó có giá.

```java
// WRONG: "broker tự dedupe cho tôi" — một lần gửi lại là trừ tiền khách hai lần
@KafkaListener(topics = "order-events")
void handle(OrderEvent e) {
    accountService.debit(e.customerId, e.amount);   // retry sẽ chạy lại đoạn này
}

// RIGHT: at-least-once delivery + áp dụng effect một cách idempotent
@KafkaListener(topics = "order-events")
@Transactional
void handle(OrderEvent e) {
    if (eventStore.exists(e.eventId)) return;        // dedupe theo event id
    accountService.debit(e.customerId, e.amount);
    eventStore.insert(e.eventId);                    // dựa trên UNIQUE(event_id)
}
```

Hai cơ chế phải có sẵn khi họ dồn:

- **Idempotency key + unique constraint.** Effect được khóa bởi `event_id`, nên một retry phát lại message sẽ thấy key đã được áp dụng và no-op. `eventStore` là một bảng có `UNIQUE(event_id)`; cái `INSERT` chính là thứ khiến nó an toàn trước hai delivery song song — nếu cả hai tới cùng lúc, chỉ một cái `INSERT` thành công, cái còn lại đập vào unique index và bị nuốt.
- **Outbox pattern.** Ghi event trong _cùng_ một local transaction với business write, để một relay publish nó, và để consumer dedupe. Giờ bạn có at-least-once mà không cần distributed transaction — bạn đổi một broker nằm trong transaction lấy một relay poll một bảng.

Trade-off bạn nói to: idempotency key và outbox table là hạ tầng bạn phải xây và giữ trung thực; at-most-once (câu trả lời "tôi chỉ check một lần") né được việc nhưng âm thầm _rơi_ event khi consumer chết giữa chừng — tệ hơn, vì mất dữ liệu là thứ vô hình. Với domain thanh toán, tôi chấp nhận cái giá idempotency mọi lần.

### Module vs microservice — nơi "tùy thuộc" thật sự kiếm được điểm

"Anh có tách cái này thành microservice không?" là câu hỏi trade-off đội lốt câu hỏi nhị phân. Câu trả lời senior từ chối nhị phân và định giá đường nối:

- Gọi method trong process: **~1 μs**. Cùng JVM, không serialization.
- localhost gRPC: **~50–100 μs**.
- Gọi mạng cùng region: **~0.5–2 ms** — chậm hơn ba bậc độ lớn so với call trong JVM, _trước cả_ serialization, retry và timeout.

Đó là khoản thuế thô. Rồi cộng các chi phí thường trực mà một service boundary không ngừng thu: một deployment pipeline, một schema và cách version nó, một client contract với nghi lễ breaking-change, distributed tracing bạn phải nối, một on-call rotation, một runbook, một alert threshold. Vận hành team 3 người với 12 service là bạn đã đốt phần lớn năng lực vào việc hàn các đường nối, không phải ship sản phẩm.

Nên bài test senior không phải "nó có thể là service không?" — thứ gì cũng có thể. Bài test là **sự độc lập mua được gì cho bạn**, và việc mua đó có vượt qua khoản thuế không:

- **Nhịp deploy độc lập.** Một team ship hai lần/tuần, team kia hai lần/ngày — cái coupling của một lần deploy chung chính là thứ việc tách thật sự gỡ bỏ.
- **Scale độc lập.** Một component cần 40 pod lúc campaign, component kia chỉ cần 3. Monolith autoscale cả cục.
- **Blast radius độc lập.** Một bug ở module billing không được kéo sập catalog reads.

"Tôi giữ nó là module trong service cho tới khi hai trong ba điều đó thành sự thật" đánh bại "tách đi, microservices là tương lai" vì nó có cơ chế và điều kiện kích hoạt. Nếu họ hỏi "làm sao test rằng đó có phải seam tốt?" câu trả lời là: _một lỗi mạng duy nhất giữa hai component này có làm mất một business invariant không? Nếu có, đó là một service boundary đáng trả thuế; nếu không, đó là một function call dài dòng hơn._

## 2. Thừa nhận không chắc chắn trung thực — calibration là kỹ năng, không phải cái bọc

"Tôi sẽ đo trước khi chốt RF=5; 3 thường là đủ" đánh bại một con số sai tự tin. Seniority là calibration, không phải bravado. Nhưng nước đi sâu hơn mà phỏng vấn viên thật sự câu: không phải việc bạn hedge, mà là sự không chắc chắn của bạn được **định chiều** — bạn nói được đại khái bao nhiêu, vì sao, và điều gì sẽ làm bạn đổi ý.

Bài drill kinh điển: "Cái X nhanh cỡ nào?" Họ không check số học; họ check xem mô hình tinh thần của bạn có đúng _bậc độ lớn_ không, vì một người mà mô hình lệch hệ số mười sẽ đưa ra quyết định lệch hệ số mười. Calibrate tới khi phản xạ:

```
call trong JVM              ~1 μs
JSON serialize/deserialize  ~1–10 μs
localhost TCP/gRPC          ~50–100 μs
call mạng cùng region       ~0.5–2 ms
Postgres point query (warm) ~1–5 ms
cross-AZ / external API     ~50–500 ms
```

Một khi bậc độ lớn đã đúng, cùng calibration ấy áp cho các con số bạn _phát biểu như ý kiến_:

```
GC young-gen pause (G1)      ~1–50 ms    (-XX:MaxGCPauseMillis=200 là mục tiêu, không phải lời hứa)
GC old-gen / full pause      giây        (chính là incident "p99 nhảy lên 3s mỗi 10 phút")
Availability 99.9%           43 phút downtime/tháng  (8.7 h/năm)
Availability 99.99%          4.4 phút/tháng
Availability 99.999%         26 s/tháng
```

Phép toán đằng sau bảng availability đáng nhớ luôn: **downtime tháng ≈ 43800 phút × (1 − availability)**. 99.9% → ~44 phút; 99.99% → ~4.4 phút; 99.999% → ~26 giây. Nếu bạn nói "chúng tôi cần 99.99%" mà không biết 4.4 phút nghĩa là gì trong budget của mình, bạn vừa phát biểu một con số bạn không calibrate.

Hai cách _dùng_ bảng trong phỏng vấn:

**Câu trả lời về GC.** "Vì sao p99 của tôi nhảy lên 3 giây mỗi 10 phút?" Câu trả lời tự-tin-sai là "thêm heap". Câu trả lời calibrated: "Trước hết tôi phải xem nó có phải pause stop-the-world không — kéo GC logs, tìm old-gen collection và safepoint stall time — vì một pause STW 2 giây và một slow query 2 giây có hướng sửa _ngược nhau_. Nếu là full-GC emergency, hướng sửa thường là object churn và sự promote lên old-gen, không phải heap to hơn; heap to hơn làm pause _dài hơn_, không ngắn hơn — bạn đang trì hoãn một cơn đau để nó quay lại nặng hơn." Phỏng vấn viên nghe được câu đó sẽ biết bạn từng sống với nó.

**Câu trả lời p99 vs p999.** "p99 của anh là 50ms mà anh vẫn bị paging." Calibrated: "p99 là request chậm thứ 999 trong 1000; ở 100 rps nghĩa là cứ 10 giây có một request 3 giây, và nếu request đó fan-out 100 dependencies, nó nhân lên thành một vấn đề availability. Tôi sẽ nhìn p999, rồi xem có dependency nào mà p95 của nó là cái đuôi tôi không kiểm soát được không." Điểm tinh tế: p99 chỉ cho bạn _vị trí_ của percentile, không cho bạn _bậc_ của đuôi — hai hệ thống cùng p99 50ms, một cái có đuôi 200ms, một cái có đuôi 3 giây, là hai profile vận hành hoàn toàn khác.

Và nước đi trung thực ghi điểm nhất: **nêu rõ độ tin cậy và điều kiện đổi ý.** "RF=3 cho tôi độ bền trước một broker lỗi trong cluster 3 node; RF=5 là đai-chống-đai trước hai lỗi đồng thời nhưng gần như gấp đôi băng thông replication và thêm latency trên ack. Tôi ship RF=3 và đặt alert trên under-replicated partition — còn nếu compliance team nói 'hai rack lỗi đồng thời', tôi chuyển RF=5 và trả băng thông." Câu trả lời đó _scalable_: nó đưa một khuyến nghị, một cơ chế, một cái giá, và một trigger để đổi ý. Đó là diện mạo thật của "thừa nhận không chắc chắn trung thực" ở cấp senior — không phải "tôi không biết", mà là "đây là ranh giới của điều tôi biết và điều tôi sẽ check trước tiên."

## 3. Kể chuyện chứng tỏ ownership — STAR là khung xương, không phải câu chuyện

"Trên prod chúng tôi từng thấy rebalance storm khi…" đánh bại đọc thuộc lòng. Dùng hình dáng STAR (Situation, Task, Action, Result) mà đừng như kịch bản. Nhưng filter senior thật còn chính xác hơn cái acronym: phỏng vấn viên lắng nghe **năm tín hiệu cụ thể**, theo thứ tự, và phần lớn ứng viên dừng sau hai tín hiệu đầu.

1. **Giả thuyết ban đầu.** Không phải chẩn đoán cuối — mà là dự đoán _đầu tiên_. Nếu câu chuyện của bạn không bao giờ có một dự đoán sai, bạn đang cắt phim.
2. **Cách bạn test nó.** Một metric hay trace duy nhất xác nhận hoặc giết giả thuyết. "Tôi check count `active` của connection pool và nó kẹt ở max trong khi CPU của DB chỉ 8% — nên là pool, không phải database."
3. **Cái đòn bẩy chính xác đã sửa nó.** Thay đổi, và làm sao bạn biết nó hiệu quả (metric di chuyển từ X sang Y).
4. **Blast radius và rollback.** Điều gì có thể hỏng, và bạn giữ bản sửa reversible như thế nào.
5. **Thay đổi hệ thống, không phải lời xin lỗi.** Điều gì thay đổi để nó không tái diễn: một runbook, một merge gate load-test, một alert, một checklist code review.

Đây là một câu chuyện làm sẵn xây trên khung đó — mượn hình dáng, thay chi tiết:

> **Situation.** Tỷ lệ lỗi checkout của chúng tôi vượt 5% lúc ~00:14, SLO là 0.5%. Payment timeouts bắt đầu xuất hiện trong log.
> **Task.** Tôi trực on-call. Khôi phục dịch vụ, rồi tìm _vì sao_, không đoán mò trước một nhóm đang paging.
> **Action.** Câu hỏi đầu tiên cho cả phòng: _deploy gần nhất đã thay đổi gì?_ — vì incident production tương quan với change nhiều hơn hẳn việc chúng là tai nạn ngẫu nhiên của vũ trụ. Có một call tới payment-provider mới trong release vừa rồi. Thứ hai: tôi check p99 của provider qua tracing — 1.8s, trước đó 120ms. Điều đó xác nhận vấn đề nằm ở _call_, không phải code của chúng tôi. Thứ ba: tôi chạy Little's law — `pool_size = rps × hold_time = 800 rps × 300ms ≈ 240`, mà pool của chúng tôi là 100 — requests đang xếp hàng tại `connectionTimeout`, đó là lý do mọi lỗi trông như "DB chết" trong khi DB vẫn ổn. Fix: rollback về build trước, rồi cap timeout của provider để một vendor chậm không giữ checkout thread làm con tin.
> **Result.** p99 về dưới 100ms trong ~20 phút, tỷ lệ lỗi về 0.1%. Postmortem: root cause là một _trùng hợp load × change_ — call tới provider đã chậm nhiều ngày nhưng chúng tôi chưa bao giờ chạm trần concurrency trước spike lưu lượng. Hành động: một load test với worst-case latency của dependency mới được nhồi vào, một alert trên pool queue depth (không chỉ DB CPU), và cái timeout cap được đưa vào checklist code review.

Little's law là phép toán mà phỏng vấn viên thích câu: **số kết nối cần thiết = throughput (rps) × thời gian giữ kết nối trung bình (hold time)**. Ở trên: 800 rps × 0.3s ≈ 240 — pool 100 chỉ đủ cho ~333 rps ở hold time đó, nên bất kỳ chậm trễ nào của provider cũng biến thành queue. Pool to hơn che giấu vấn đề; pool đúng cỡ _chứng minh_ bạn hiểu cơ chế. Kèm nghịch lý: pool quá to (2000 connection) còn tệ hơn pool thiếu, vì mỗi connection tốn memory + slot Postgres và việc context-switch nhiều kết nối đồng thời làm hỏng cache locality — "thêm connection" là câu trả lời của người chưa từng nhìn `pg_stat_activity` lúc cao điểm.

Câu chuyện đó qua cả năm probe. Một câu chuyện kết ở "và tôi đã sửa xong" chỉ qua hai. Bài drill dồn của phỏng vấn viên tàn bạo: họ sẽ tua ngược về giữa và hỏi "**vì sao anh rollback thay vì chỉ tăng timeout?**" — câu trả lời họ muốn là "vì phép toán pool nói chúng tôi sẽ hết connection lần nữa trong vòng vài phút, và rollback là nước đi xác suất-cao-nhất, blast-radius-thấp-nhất lúc 2h sáng; bạn tối ưu bản sửa _mà bạn chứng minh được_, không phải bản sửa _mà bạn tranh luận được_." Nếu câu chuyện của bạn không sống sót qua cú tua đó, hãy chọn câu chuyện khác hoặc sửa chi tiết cho tới khi nó sống sót.

## 4. Phản biện nhẹ nhàng — bất đồng bằng bằng chứng, và cam kết

Nếu một design là microservices sớm quá, hãy nói ra và giải thích cái giá. Bất đồng có bằng chứng là tín hiệu senior; đồng ý để né xung đột thì không. Nhưng "push back" là câu trả lời hay bị _diễn sai_ nhất trong vòng behavioral, nên hãy chính xác về hình dạng.

**WRONG:**

> "Ý kiến đó tồi. Microservices là anti-pattern ở đây."

Đó là một phán quyết không cơ chế. Nó đọc như cái tôi, và nó không cho người quyết định một con đường phía trước.

**RIGHT:**

> "Tôi hiểu anh về nhịp deploy độc lập — điều đó thật. Nhưng cái giá ở đây là khoản thuế: một build pipeline, một contract, tracing, một on-call rotation cho một module 200 dòng, và chậm hơn ba bậc độ lớn trên đường nối. Team này 3 người và module đang greenfield. Sự độc lập mua cho chúng ta cái gì lúc này? Tôi giữ nó là module, làm seam _testable_ để ngày mai tách được, và ghi trigger 'khi nào tách' — khi nhịp deploy hoặc scale phân kỳ. Nếu anh vẫn muốn tách, tôi ủng hộ; hãy ghi decision record kèm trade-off để nó là một lựa chọn, không phải một cảm giác."

Câu trả lời đó có bốn thành phần phỏng vấn viên chấm:

1. **Thừa nhận hạt sự thật trước.** Nhu cầu độc lập thường chính đáng; hãy bác bỏ _cái giá cụ thể_, không phải con người.
2. **Định giá phương án bằng một cơ chế.** Thuế thật, con số thật (delta latency, quy mô team).
3. **Đề xuất một con đường giữa reversible.** "Làm seam testable ngay, tách sau" biến cánh cửa một chiều thành hai chiều.
4. **Kết bằng disagree-and-commit.** "Nếu anh vẫn muốn, được — đây là decision record." Team senior không tan rã vì chuyện này; họ viết nó ra.

Cái bẫy liên quan họ dò: _"senior của anh phản biện design CỦA ANH — anh phản ứng sao?"_ Câu trả lời senior đảo ngược câu chuyện: bạn xin lý do, tìm ra cơ chế mà họ đúng, cập nhật kế hoạch, và nói điều đó công khai. "Tôi đổi ý khi họ cho tôi thấy con số" là một tín hiệu senior _mạnh hơn_ "tôi bảo vệ design của mình." Phỏng vấn viên nghe cả hai câu trong mọi vòng; một trong hai là người họ muốn trong một buổi design review lúc 5h chiều thứ Sáu.

## 5. Giao tiếp cho team — artifact, không phải tính từ

Mọi rubric behavioral đều ghi "giao tiếp". Phỏng vấn senior test nó bằng _artifact_. Hãy sẵn sàng tạo ra, ngay tại chỗ, ba thứ cụ thể:

### Design doc một trang

Không phải PRD 14 trang. Design doc senior mà junior theo được có khung cố định:

1. **Context & problem** — ràng buộc business trong một đoạn.
2. **Options** — 2–3 phương án, kèm trade-off và con số mỗi phương án thay đổi (latency, chi phí, gánh nặng ops).
3. **Decision** — một câu, cộng decision _record_ (ai, khi nào, chúng ta bác bỏ gì và vì sao).
4. **Failure modes & rollback** — những gì có thể hỏng và kế hoạch cho từng cái.
5. **Open questions** — ba điều bạn vẫn chưa biết, và ai sở hữu chúng.

Hãy tập tạo ra khung này từ một chủ đề phỏng vấn viên nêu. Dấu hiệu họ chấm: phần "decision" của bạn có chứa một phương án bị bác bỏ kèm lý do — một doc chỉ có một phương án thì chưa bao giờ là một quyết định.

### Incident update, không đổ lỗi

Khi họ hỏi "anh giao tiếp thế nào trong một incident?", câu trả lời senior là một _khuôn mẫu_, không phải thái độ:

```
00:14 [SEV-1] checkout error rate >5% (SLO 0.5%) — đang điều tra. Impact: checkout đã tắt.
00:20 Update: trace cho thấy payment-provider p99 ở 1.8s. Đang rollback release R-214.
00:28 Update: rollback xong, error rate 0.1%, p99 < 100ms. Theo dõi.
00:40 Resolved. Postmortem trong 24h. Root cause: call provider mới + spike lưu lượng vượt pool.
```

Luật nằm trong khuôn đó: timestamp trên mỗi dòng, một dòng status nói rõ thứ gì đang _bị tắt/bị impact_, cập nhật theo nhịp đều (để không ai phải poll bạn), và **không đổ lỗi** — "R-214 giới thiệu một timeout regression" chứ không phải "thay đổi của Dave làm sập prod." Khung không-đổ-lỗi không phải phép lịch sự; nó là cách bạn có được báo cáo trung thực, và báo cáo trung thực là cách postmortem tìm root cause thật thay vì một con dê tế thần.

### Bản dịch business ↔ technical

"Translate between business goals and technical constraints" là cụm từ trong rubric. Câu drill thường là: _"Marketing muốn một flash sale tháng tới. Điều đó nghĩa là gì?"_ Câu trả lời mid-level là "thêm capacity". Câu trả lời senior dịch _cả chuỗi_:

- Business: "flash sale" → một spike lưu lượng cỡ ~N× hiện tại, chưa biết nhưng có giới hạn.
- Technical: phép toán capacity — p95 latency hiện tại dưới load, headroom autoscaling, tỷ lệ read/write của DB dưới spike, cache hit ratio, độ sâu queue xử lý đơn hàng.
- Ràng buộc bạn nói to: **nút thắt hiếm khi là compute — nó là shared state.** Một spike nhân 100 lưu lượng không cần 100× CPU; nó cần các write của DB, độ sâu queue, và idempotency sống sót qua các transaction giống hệt nhau đập vào trong một cụm ngắn. Câu đó là thứ cho họ biết bạn thiết kế cho load, không chỉ tinh chỉnh cho nó.

Kèm một con số sát topic: một point query trên bảng tỷ row là **3–4 page fetch B-tree** (root + 1–2 internal + leaf) — không phải phép màu, mà là logarit của fanout ~500 key/page. Nhưng một index tỷ row mà nguội là 3–4 lần chạm SSD ~0.1–0.5ms mỗi lần; giữ working set nóng trong buffer pool mới là thứ biến lookup đó thành ~100ns. "Thêm index" là câu của người mới; "giữ index nóng và tính phép toán queue" là câu của senior.

## 6. Câu hỏi behavioral hay gặp — và mỗi câu thật sự đang dò gì

Mỗi câu dưới đây là một _diễn viên đóng thế_ cho một mối quan tâm thật. Gọi tên mối quan tâm ra, bạn đã trả lời xong một nửa.

- **"Kể về lúc anh quyết định sai."** Đang dò: anh có đỡ được cú đấm mà không né không? Câu trả lời senior nhận lỗi, gọi tên suy luận sai (không chỉ kết cục), và đưa thay đổi _hệ thống_ ngăn nó tái diễn — không phải "tôi học cách cẩn thận hơn". "Tôi ship một thay đổi không load test với worst-case latency của dependency mới; postmortem biến load testing thành merge gate" giá trị hơn mọi lời xin lỗi.
- **"Anh xử lý sev-1 lúc 2h sáng thế nào?"** Đang dò: anh có một _chuỗi_, hay anh sẽ đứng hình? Câu trả lời là bốn động từ: **triage** (cái gì thật sự hỏng, impact là gì), **communicate** (khuôn ở mục 5 — dòng đầu ngay lập tức, cập nhật theo nhịp), **mitigate** (rollback hoặc bản sửa reversible xác-suất-cao — luật 2h sáng là _khôi phục dịch vụ trước, điều tra sau_), và **postmortem** (đặt một ngày _trong lúc_ incident, không phải sau).
- **"Anh mentor junior thế nào?"** Đang dò: anh có _giao việc_, hay anh chỉ giải thích vào mặt người ta? Một câu trả lời senior cụ thể: "Tôi giao cho junior cả câu chuyện từ đầu tới cuối nhưng để họ cầm lái — một task thật với blast radius tôi kiểm soát được, một vòng review, và feedback gắn vào _artifact_ ('PR này có ba nhánh không dùng; lần sau hãy extract seam') chứ không gắn vào con người." Từ họ đang lắng nghe là **stretch-with-safety**, không phải "tôi hay giúp đỡ".
- **"Vì sao anh tìm việc?"** Đang dò: anh có phải rủi ro bỏ chạy và có đang cay cú không? Câu trả lời senior trung thực, nhìn về phía trước, và không bao giờ nêu tên một người. "Tôi đã vượt quá scope của công việc — các project nhỏ hơn các vấn đề tôi muốn sở hữu" đánh bại "manager tôi không thăng chức tôi". Một phiên bản báo hiệu một người sẽ lớn lên cùng role; phiên bản kia báo hiệu một vấn đề đang bước qua cửa.
- **"Anh sẽ làm khác điều gì ở đây?"** Đang dò: độ chín retrospect trên _chính buổi phỏng vấn này_, _chính design này_. Câu trả lời senior nêu một ngã rẽ cụ thể: "Tôi sẽ đòi một decision record cho trade-off vừa thảo luận thay vì để nó là một thỏa thuận bằng lời." Mọi buổi phỏng vấn senior đều kết bằng cách bắt bạn tự đánh giá trong thời gian thực; hãy xử nó như một hệ thống, không phải một cảm giác.

## 7. Tự kiểm tra

- [ ] Hai câu chuyện có impact đo đếm được (latency giảm, incident được xử lý, hệ thống được ship) — và mỗi cái qua _năm probe_: giả thuyết ban đầu, metric xác nhận, đòn bẩy chính xác, rollback/blast radius, thay đổi hệ thống.
- [ ] Một câu chuyện quyết định sai nơi bạn gọi tên _suy luận sai_, không chỉ kết cục, cùng thay đổi hệ thống ngăn tái diễn.
- [ ] Một lần bạn bất đồng với senior và kết quả — đóng khung disagree-and-commit, không phải "tôi thắng cuộc tranh luận".
- [ ] Một câu trả lời calibrated cho: GC pause times, availability 99.9% vs 99.99%, khác biệt p99 vs p999, và pool sizing từ `rps × hold_time`.
- [ ] Câu trả lời at-least-once + idempotency key, kể cả outbox, sẵn sàng để nói.
- [ ] Khung design-doc một trang và khuôn incident update — bạn tạo được cả hai từ một chủ đề ngẫu nhiên tại chỗ.
- [ ] Câu trả lời rõ cho "anh sẽ làm khác điều gì ở đây?" cho design bạn vừa đi qua.
- [ ] Câu trả lời rõ cho "vì sao anh tìm việc?" nhìn về phía trước và không nêu tên ai.

## 8. Interviewer follow-ups

Khi câu trả lời đầu của bạn vừa rơi xuống, họ bắt đầu dồn. Hãy sẵn sàng cho những câu này:

- "Anh nói at-least-once + idempotency. Đi qua retry — dedupe key nằm ở đâu, và chuyện gì xảy ra với hai delivery song song?"
- "Khi nào việc tách module thành service trở thành _ép buộc_? Đưa tôi điều kiện trigger anh sẽ ghi vào design doc."
- "p99 của anh ổn mà anh vẫn bị paging. Metric nào anh nhìn đầu tiên, và phép toán đuôi nào khiến p99 50ms trở nên nguy hiểm?"
- "Làm sao anh phân biệt một spike latency 2 giây là GC pause hay slow query — không đoán mò?"
- "Câu hỏi duy nhất anh hỏi cả phòng trước khi rollback trong một incident là gì?"
- "Senior của anh phản biện design của anh. Anh chắc chắn mình đúng. Anh thật sự nói _gì_ trong cuộc họp đó?"
- "Soạn khuôn incident update cho một sự cố thanh toán ngay bây giờ. Dòng đầu tiên là gì?"
- "Marketing muốn flash sale. Câu _kỹ thuật_ nào dịch request đó — và nút thắt anh nêu là gì?"
- "Đưa tôi một decision record cho trade-off chúng ta vừa thảo luận. Mỗi phần chứa gì?"
- "Anh sẽ làm khác điều gì trong buổi phỏng vấn này, nếu chúng ta chạy lại ngay bây giờ?"

Đó là bar tư duy senior — và thường là khác biệt giữa offer và trượt. Vòng code chứng minh bạn _biết_; vòng này chứng minh bạn _quyết_. Đến với các con số, các artifact, và những câu chuyện sống sót qua cú tua — và bạn không trả lời câu hỏi nữa; bạn đang trình diễn công việc.
