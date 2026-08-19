---
title: "Concurrency trong Java: Thread Pool và Virtual Thread"
description: "Hướng dẫn thực tế về concurrency trong Java: shared state, thread pool, backpressure, tác vụ CPU và I/O, cùng những thay đổi thực sự của Virtual Thread."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

## Giới thiệu

Xét **một kịch bản minh họa**: một service nhận 10.000 request cùng lúc. Một
số request cần parse JSON, hash dữ liệu hoặc nén response. Các request khác
phải chờ query đến database hoặc một external HTTP API mất 300 ms để trả lời.

Service có nên tạo 10.000 thread không? Nếu không, lý do là gì? Và nếu Java
Virtual Thread giúp biểu diễn một số lượng rất lớn task đồng thời, tại sao
điều đó không làm cho ứng dụng có concurrency vô hạn?

Bài viết trả lời các câu hỏi này bằng cách đi qua những lớp quyết định
concurrency có ích ở đâu và không có ích ở đâu:

```text
Application code
       ↓
Java thread
       ↓
JVM
       ↓
Operating-system scheduler
       ↓
CPU core
       ↓
External resource (database, API, file)
```

> **[ANALYSIS]** Câu hỏi trung tâm rất đơn giản: **bottleneck thực sự nằm ở đâu?** Đó có thể
là CPU, số database connection, rate limit của external API, năng lực mạng,
memory, lock contention, thread pool hoặc queue capacity. Tăng concurrency chỉ
có ích khi nó xử lý đúng giới hạn đó. Nếu không, bottleneck chỉ chuyển sang
nơi khác hoặc phát sinh thêm overhead.

Bài viết tập trung vào bốn câu hỏi:

- Vì sao tăng số thread có thể làm ứng dụng chậm hơn?
- Vì sao thread pool có hàng trăm thread không nhất thiết cải thiện CPU
  utilization?
- Vì sao Virtual Thread có thể hỗ trợ concurrency rất lớn nhưng không làm code
  CPU-bound chạy nhanh hơn?
- Vì sao bug về concurrency thường chỉ xuất hiện trong điều kiện production?

Repository `java-lab` đi kèm với bài viết:
[`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/thread). Đây là
một Maven project đơn giản, gồm 31 ví dụ độc lập, sử dụng các concurrency API
của JDK và không phụ thuộc framework. Mỗi phần liên hệ một khái niệm với một
class, lệnh chạy và hành vi cần quan sát.

> **[SOURCE FACT]** Các ví dụ dùng Java 21 trở lên. `pom.xml` của repository
> đặt `maven.compiler.release` là `21`, và Virtual Thread yêu cầu Java 21.

> **[SOURCE FACT]** Các measurement được ghi lại trong những ví dụ gốc chạy
> trên máy 12-core với JDK 21. Đây là số liệu quan sát mẫu, không phải
> benchmark có thể áp dụng cho mọi môi trường.

Hãy bắt đầu mỗi phần từ problem, kiểm tra code, rồi so sánh kết quả chạy với
output đã ghi lại. Điều quan trọng không phải timing chính xác, mà là hiểu
resource nào đang giới hạn progress.

## 1. Problem thực tế: Nhiều request ở các trạng thái khác nhau

Một chương trình tuần tự xử lý từng operation sau khi operation trước hoàn tất:

```text
Task A
  ↓
Task B
  ↓
Task C
```

Một backend thường có các request ở nhiều trạng thái khác nhau cùng lúc:

```text
Request A ───── waiting for database
Request B ───── calculating
Request C ───── waiting for HTTP API
Request D ───── processing file
```

Trong lúc Request A chờ database, chương trình có thể dùng CPU để xử lý
Request B. Thiết kế tuần tự không làm được điều đó trước khi A hoàn tất, nên
phần thời gian CPU có thể sử dụng bị bỏ trống trong khi ứng dụng chờ external
resource.

**[ANALYSIS]** Đó là lý do cơ bản concurrency hữu ích. Một thread có thể block trên operation
chậm trong khi task khác tiếp tục progress. Cách này không làm database,
HTTP service hay file system nhanh hơn; nó thay đổi việc ứng dụng sử dụng thời
gian chờ như thế nào.

Thread cũng có cost và failure mode. Việc tạo và scheduling platform thread
tiêu tốn resource. Các thread chia sẻ memory của process, nên shared state
không được bảo vệ có thể bị hỏng hoặc tạo ra kết quả không nhất quán. Thread
không cung cấp thêm CPU core. Vì vậy, thiết kế concurrency là sự cân bằng giữa
việc cho phép các task overlap, giới hạn resource và overhead phối hợp.

## 2. Concurrency và Parallelism

Hai thuật ngữ này mô tả hai thuộc tính khác nhau và không nên dùng thay thế
cho nhau.

### 2.1. Cấu trúc và thực thi

- **Concurrency** nghĩa là nhiều task có thể progress trong các khoảng thời
  gian chồng lấn, kể cả khi được interleave trên một CPU. Đây là cách cấu trúc
  chương trình có hoạt động chờ.
- **Parallelism** nghĩa là nhiều task thực thi tại cùng một thời điểm trên các
  CPU core khác nhau. Nó phụ thuộc vào execution resource hiện có.

Một phép so sánh hữu ích, nếu hiểu đúng giới hạn của nó: một đầu bếp có thể
chuyển qua lại giữa nhiều món trong lúc từng món chờ trên bếp; đó là
concurrency. Nhiều đầu bếp nấu đồng thời trên các bếp riêng là parallelism.

```text
Concurrency (interleaved trên 1 core):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (đồng thời trên 2 core):
  Core 1:    |------A1------|------A2------|
  Core 2:    |------B1------|------B2------|
```

**[ANALYSIS]** Concurrency thường phù hợp với workload dành nhiều thời gian chờ.
Parallelism là cơ chế sử dụng nhiều core cho computation. Một task CPU-bound
liên tục không tự chạy nhanh hơn chỉ vì được biểu diễn bằng nhiều thread đồng
thời; số core hiện có vẫn là giới hạn.

Concurrency không yêu cầu nhiều core. Parallel execution thì có. Trong
**giả định minh họa** sau đây, máy có 4 core và process có 1.000 thread. Tại
một thời điểm nhiều nhất 4 task có thể chạy trên các core đó; 996 task còn lại
phải chờ, sleep hoặc được scheduler chuyển đổi. **Tạo thread không tạo thêm
core.**

### 2.2. Loại workload quyết định giới hạn hữu ích

Với mỗi task, hãy hỏi phần lớn thời gian của nó được dùng vào đâu:

- **CPU-bound**: task dành thời gian để tính toán, chẳng hạn parsing, hashing,
  cryptography hoặc compression. Throughput chủ yếu bị giới hạn bởi năng lực
  CPU, không phải bởi việc tùy ý tăng số thread.
- **I/O-bound**: task dành phần lớn thời gian chờ database, HTTP response hoặc
  file operation. Throughput hữu ích bị giới hạn bởi latency và capacity của
  các resource đó, cùng với các giới hạn concurrency của ứng dụng.

Phân biệt này không nhằm kết luận “thread tốt” hay “thread xấu”. Nó giúp xác
định nên giới hạn điều gì, đặt backpressure ở đâu (`backpressure` là cơ chế
làm producer chậm lại khi consumer hoặc resource đã đầy), và thread pool hay
Virtual Thread có phải execution model phù hợp hay không.
