---
title: "Project Loom: Cuộc cách mạng xử lý đồng thời trong Java"
description: "Tìm hiểu Project Loom và Virtual Threads trong Java: cách hoạt động, lợi ích, so sánh với reactive programming và tương lai của Java."
pubDatetime: 2025-09-13T02:59:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Trong suốt nhiều thập kỷ, Java đã nổi tiếng với khả năng đa luồng (multithreading). Tuy nhiên, khi hệ thống ngày càng phức tạp, lượng kết nối đồng thời tăng cao, mô hình luồng truyền thống của Java dần bộc lộ hạn chế.

Để giải quyết vấn đề này, Oracle giới thiệu Project Loom – một nỗ lực tái định hình cách Java xử lý đồng thời.

## 1. Vấn đề của luồng truyền thống

- Chi phí bộ nhớ lớn: Mỗi thread cần stack riêng (thường 1MB), nên nếu tạo 100k thread sẽ tốn hàng trăm GB RAM
- Overhead khi context switching: Hệ điều hành phải liên tục chuyển đổi giữa các thread
- Lập trình bất tiện: Để tránh tốn thread, lập trình viên buộc phải dùng callback, reactive programming

## 2. Project Loom là gì?

Project Loom bổ sung Virtual Threads (luồng ảo) vào Java. Đây là một lớp abstraction nhẹ hơn nhiều so với thread truyền thống, được quản lý bởi JVM thay vì hệ điều hành.

- Virtual Thread gần giống goroutine trong Go: có thể tạo ra hàng triệu luồng
- Mỗi virtual thread được lập lịch trên một pool nhỏ các luồng OS (carrier threads)
- Khi một virtual thread bị block, JVM sẽ tự động "park" nó và giải phóng carrier thread

## 3. Virtual Threads hoạt động như thế nào?

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 100_000).forEach(i ->
        executor.submit(() -> {
            Thread.sleep(1000);
            System.out.println("Task " + i);
            return i;
        })
    );
}
```

Trong code trên: Ta tạo 100.000 virtual thread chỉ bằng vài dòng. Mỗi thread vẫn dùng Thread.sleep quen thuộc. JVM sẽ tối ưu để không chiếm 100.000 OS thread.

## 4. Lợi ích

- Đơn giản hóa lập trình đồng thời: Không cần reactive framework phức tạp
- Khả năng mở rộng cực lớn: Có thể tạo hàng triệu virtual thread
- Tương thích ngược: Code cũ sử dụng Thread có thể chạy trực tiếp trên virtual thread
- Hiệu năng cao: Giảm chi phí context switching, giảm memory footprint

## 5. So sánh với các mô hình khác

| Công nghệ              | Độ phức tạp lập trình | Khả năng mở rộng |
| ---------------------- | --------------------- | ---------------- |
| Thread truyền thống    | Đơn giản              | Hạn chế          |
| Reactive (WebFlux)     | Khó                   | Rất cao          |
| Loom (Virtual Threads) | Đơn giản như thread   | Rất cao          |

## 6. Kết luận

Project Loom là một bước ngoặt của Java. Nó giải quyết bài toán đồng thời bằng cách bổ sung Virtual Threads – nhẹ, dễ lập trình, hiệu quả cao. Với Loom, lập trình viên Java có thể viết code blocking quen thuộc mà vẫn đạt hiệu năng ngang ngửa reactive.
