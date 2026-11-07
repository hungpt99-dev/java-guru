---
title: "Tự xây dựng Homelab trên Ubuntu VPS – Góc nhỏ để self-host và khám phá công nghệ"
description: "Dạo gần đây mình bắt đầu dành thời gian xây dựng một Homelab trên VPS cá nhân."
pubDatetime: 2026-11-07T12:43:57+07:00
modDatetime: null
category: "DevOps & Infrastructure"
tags: ["homelab", "SelfHosting"]
lang: "vi"
featured: false
draft: false
readingTime: 8
coverImage: "../../assets/articles/tu-xay-dung-homelab-tren-ubuntu-vps-goc-nho-de-self-host-va-kham-pha-cong-nghe/cover.png"
series: null
sourceUrl: "https://viblo.asia/p/tu-xay-dung-homelab-tren-ubuntu-vps-goc-nho-de-self-host-va-kham-pha-cong-nghe-AY4qQO0r4Pw"
sourceReleasedAt: "2026-11-07T05:43:57.000000Z"
sourceUpdatedAt: "2026-11-07T06:09:03.000000Z"
sourceTags: ["homelab", "SelfHosting"]
---

Dạo gần đây mình bắt đầu dành thời gian xây dựng một Homelab trên VPS cá nhân.

Không phải để chạy một hệ thống production hay xây dựng một infrastructure quá phức tạp. Đơn giản là muốn có một môi trường riêng để self-host các service, thử nghiệm công nghệ mới, tìm hiểu Linux, networking, security và infrastructure.

Thay vì mỗi lần cần sử dụng một công cụ lại phải tìm một dịch vụ bên ngoài, mình muốn tự quản lý một phần hạ tầng của mình.

Đây cũng là một cách khá thú vị để học hỏi thêm về DevOps và System Administration.

Toàn bộ cấu hình và quá trình setup được mình lưu lại tại repository:

**GitHub:** https://github.com/hungpt99-dev/vps-harden

## 1. Tổng quan Homelab

Môi trường của mình sử dụng Ubuntu Server trên VPS.

Một số thành phần chính:

| Thành phần | Công nghệ |
|---|---|
| Operating System | Ubuntu Server |
| Infrastructure Automation | Ansible |
| Container Runtime | Docker |
| Container Management | Docker Compose |
| Private Networking | Tailscale |
| Firewall | UFW |
| Intrusion Prevention | Fail2ban, CrowdSec |
| AI Agent | Hermes Agent |
| Monitoring | Prometheus, Grafana |
| Logging | Grafana Alloy, Loki |
| Backup | Restic |
| Source Control | Git |

Không phải tất cả đều cần thiết ngay từ đầu. Mình lựa chọn từng thành phần dựa trên nhu cầu và khả năng mở rộng sau này.

## 2. Infrastructure Management với Ansible

Một trong những điều mình muốn làm ngay từ đầu là quản lý cấu hình server bằng Infrastructure as Code.

Mình lựa chọn Ansible để quản lý:

- Linux system configuration.
- SSH hardening.
- Firewall rules.
- Security services.
- Docker installation.
- Monitoring setup.
- Backup configuration.

Thay vì ghi nhớ và chạy lại hàng loạt command mỗi khi setup server, mình có thể định nghĩa các cấu hình thành Ansible Playbook và Role.

Điểm mình thích ở cách tiếp cận này là cấu hình được lưu trong Git, dễ theo dõi thay đổi và có thể tái sử dụng.

## 3. Containerization với Docker

Docker là một trong những thành phần quan trọng nhất của Homelab.

Mình sử dụng Docker Compose để quản lý các service thay vì cài đặt trực tiếp mọi thứ lên Ubuntu.

Một số lợi ích:

- Tách biệt môi trường giữa các ứng dụng.
- Quản lý vòng đời service dễ dàng.
- Dễ dàng nâng cấp hoặc thay thế.
- Quản lý persistent volumes.
- Dễ dàng backup và restore dữ liệu.

Mỗi nhóm service được tổ chức thành những Compose project riêng để dễ quản lý.

## 4. Private Networking với Tailscale

Một vấn đề khi self-host service trên VPS là làm sao truy cập chúng từ bên ngoài mà không cần mở quá nhiều port public.

Mình lựa chọn Tailscale cho mục đích này.

Tailscale xây dựng private network dựa trên WireGuard, cho phép các thiết bị đã được xác thực kết nối với nhau.

Một số service quản trị có thể chỉ truy cập thông qua private network:

- SSH.
- Grafana.
- Hermes Agent.
- Các internal service khác.

Nhờ đó, mình không cần expose toàn bộ management interface ra Internet.

## 5. Security – Không chỉ đơn giản là mở firewall

Đây là phần mình muốn chú trọng khi xây dựng Homelab.

Dù chỉ là VPS cá nhân, server vẫn có thể trở thành mục tiêu của những cuộc scan tự động, brute-force SSH hoặc các hành vi khai thác lỗ hổng phổ biến trên Internet.

Một số công cụ mình sử dụng:

**UFW**

Quản lý firewall và kiểm soát các kết nối đến server. Mặc định hạn chế inbound traffic và chỉ mở những port thực sự cần thiết.

**Fail2ban**

Theo dõi log và tự động ban các IP có hành vi đăng nhập thất bại quá nhiều lần.

**CrowdSec**

Phân tích log để phát hiện những hành vi đáng ngờ và hỗ trợ remediation thông qua các thành phần phù hợp.

**SSH Hardening**

- Sử dụng SSH key authentication.
- Disable root login.
- Hạn chế password authentication sau khi xác minh SSH key hoạt động.
- Chỉ cấp quyền cần thiết cho từng user.

Một điều cần lưu ý là Docker có cơ chế quản lý network và firewall riêng. Vì vậy, chỉ bật UFW không có nghĩa là tất cả container đã được bảo vệ đúng cách.

## 6. Hermes Agent

Trong Homelab, mình cũng cài đặt Hermes Agent để thử nghiệm khả năng tương tác với server thông qua AI.

Một số tác vụ mình muốn thử nghiệm:

- Kiểm tra trạng thái VPS.
- Đọc và phân tích system logs.
- Kiểm tra Docker containers.
- Hỗ trợ troubleshooting.
- Chạy các automation đã được định nghĩa.
- Hỗ trợ kiểm tra security configuration.

Mình xem đây là một công cụ bổ trợ cho việc vận hành, không phải thứ thay thế hoàn toàn các công cụ quản trị hệ thống truyền thống.

## 7. Monitoring và Logging

Một hệ thống chạy ổn định không có nghĩa là mình biết nó đang hoạt động tốt.

Vì vậy, mình chuẩn bị thêm một số công cụ monitoring:

- **Prometheus:** Thu thập metrics.
- **Node Exporter:** Cung cấp thông tin tài nguyên Linux.
- **Grafana:** Trực quan hóa metrics và dashboard.
- **Grafana Alloy:** Thu thập logs.
- **Loki:** Tập trung lưu trữ và truy vấn logs.

Những thông tin mình quan tâm bao gồm:

- CPU usage.
- Memory usage.
- Disk usage.
- Network traffic.
- Container health.
- Service availability.
- Security events.

Với một VPS có tài nguyên hạn chế, monitoring stack cũng cần được cấu hình hợp lý để tránh chính nó trở thành nguyên nhân gây tiêu tốn tài nguyên.

## 8. Backup và Recovery

Một phần không nên bỏ qua khi self-host là backup.

Mình lựa chọn Restic để tìm hiểu và triển khai backup cho những dữ liệu quan trọng.

Các thành phần cần backup:

- Infrastructure configuration.
- Docker Compose files.
- Application data.
- Database backups.
- Hermes Agent configuration.
- Các dữ liệu quan trọng khác.

Backup nên được mã hóa, có retention policy và lưu ở một nơi độc lập với VPS.

Đặc biệt, backup chỉ thực sự có ý nghĩa khi đã thử restore thành công.

## 9. Quản lý cấu hình trong Git

Mình gom các cấu hình và automation vào một repository duy nhất để dễ quản lý.

Mục tiêu là có thể nhìn vào repository và hiểu được VPS đang được cấu hình như thế nào.

Repository được tổ chức theo hướng modular, chia các thành phần thành những Ansible Role và Playbook riêng biệt để dễ bảo trì, mở rộng và tái sử dụng.

**Repository:** https://github.com/hungpt99-dev/vps-harden

Mọi người có thể tham khảo source code, cấu trúc Ansible và các cấu hình tại đây.

## 10. Kết luận

Với mình, Homelab không nhất thiết phải có server vật lý, Kubernetes cluster hay một hệ thống infrastructure đồ sộ.

Một VPS nhỏ chạy Ubuntu cũng đủ để bắt đầu khám phá rất nhiều thứ: Linux, networking, security, Docker, monitoring, automation và self-hosted services.

Điều thú vị nhất không chỉ là có thêm một nơi để chạy ứng dụng, mà còn là hiểu rõ hơn những gì đang diễn ra bên dưới hệ thống mình sử dụng mỗi ngày.

Đây sẽ là một môi trường để tiếp tục thử nghiệm những công nghệ mới, tự xây dựng các service và học hỏi thêm về cách vận hành infrastructure.

Mọi người có góp ý hay đề xuất công cụ nào thú vị cho Homelab này không? 😄
