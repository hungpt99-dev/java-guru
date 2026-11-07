# Migration report — Viblo → java-guru

- Source profile: <https://viblo.asia/u/lowkey_dev> (Hưng Phạm, @lowkey_dev)
- Generated: 2026-11-07T07:03:35.602Z
- Target: `src/content/blog/*.md` + `public/images/articles/*`

## Summary

| Metric | Value |
| --- | --- |
| Articles discovered | 26 |
| Articles migrated | 26 |
| Articles failed | 0 |
| Body text identical to source | 26/26 |
| Images stored locally | 33 |
| Missing images | 0 |
| Incomplete articles | 0 |
| Duplicates | 0 |
| Characters of original prose | 317,681 |

**Validation status: PASS** — every migrated body is byte-identical to the retrieved original once local image paths are mapped back to their source URLs.

## Articles

| # | Title | Published | Category | Tags | Chars | Images | Body identical |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [AI không cướp việc của bạn – chính sự lạc hậu của bạn đang khiến bạn mất việc!](https://viblo.asia/p/ai-khong-cuop-viec-cua-ban-chinh-su-lac-hau-cua-ban-dang-khien-ban-mat-viec-0gdJzR1EJz5) | 2025-06-09 | Engineering Practices | @AI, Career, layoff, VibeCoding | 5013 | 2 | yes |
| 2 | [AI-Native Security: Xây dựng hệ thống phòng thủ chủ động trong kỷ nguyên AI](https://viblo.asia/p/ai-native-security-xay-dung-he-thong-phong-thu-chu-dong-trong-ky-nguyen-ai-XP4WEZpxL7G) | 2026-10-24 | Security | AISecurity, CyberSecurity, DevSecOps, AINativeSecurity, SecureSDLC | 34643 | 1 | yes |
| 3 | [AI-Native Software Development: Tái thiết kế Software Development Workflow với AI](https://viblo.asia/p/ai-native-software-development-tai-thiet-ke-software-development-workflow-voi-ai-K9Vy82lALQR) | 2026-09-25 | AI & AI Agents | AI | 12246 | 1 | yes |
| 4 | [Cả trăm đơn hàng bốc hơi chỉ trong 3 phút – tất cả vì một dòng config bị quên](https://viblo.asia/p/ca-tram-don-hang-boc-hoi-chi-trong-3-phut-tat-ca-vi-mot-dong-config-bi-quen-oK9VygxdJQR) | 2025-06-18 | Backend Engineering | graceful shutdown, microservice, DevOps, springboot, case study | 4560 | 2 | yes |
| 5 | [Cẩn thận khi retry – đừng tự DDoS chính hệ thống của mình](https://viblo.asia/p/can-than-khi-retry-dung-tu-ddos-chinh-he-thong-cua-minh-yZjJYnKlLOE) | 2025-06-22 | Distributed Systems | microservice, distributed architecture, scalability, Fault Tolerance, best practice | 5645 | 2 | yes |
| 6 | [Consistency vs. Performance: Bài toán truy vấn ít được thiết kế đúng trong Microservices](https://viblo.asia/p/consistency-vs-performance-bai-toan-truy-van-it-duoc-thiet-ke-dung-trong-microservices-1j4lQ1WWJwl) | 2026-10-24 | Microservices | Consistency, microservices, Performance, systemdesign, BackendDevelopment | 17293 | 1 | yes |
| 7 | [Đừng quản lý cấu hình AI Agent một cách thủ công nữa: Tập trung hóa với Rulesync và Git](https://viblo.asia/p/dung-quan-ly-cau-hinh-ai-agent-mot-cach-thu-cong-nua-tap-trung-hoa-voi-rulesync-va-git-bNVQGpn0JvR) | 2026-11-07 | AI & AI Agents | AI, AI Agent | 10429 | 1 | yes |
| 8 | [GraalVM – Tương lai của Java trong kỷ nguyên Cloud-native](https://viblo.asia/p/graalvm-tuong-lai-cua-java-trong-ky-nguyen-cloud-native-gdJzvbgGJz5) | 2025-09-13 | Java & JVM | Java | 6174 | 2 | yes |
| 9 | [Hiểu Saga Pattern trong 5 phút](https://viblo.asia/p/hieu-saga-pattern-trong-5-phut-XRJ8RlG8VGq) | 2025-09-02 | Microservices | saga pattern, System Design | 7900 | 1 | yes |
| 10 | [Hiểu Zero Trust trong 5 phút](https://viblo.asia/p/hieu-zero-trust-trong-5-phut-Nj4vg2x0J6r) | 2025-09-03 | Security | zero trust, micrservices | 5339 | 1 | yes |
| 11 | [How to Set Up an AI Agent](https://viblo.asia/p/how-to-set-up-an-ai-agent-pPLkNb5GJRZ) | 2026-10-01 | AI & AI Agents | AI, AI Agent | 14367 | 1 | yes |
| 12 | [Java Threads và Concurrency: Từ CPU, Thread Pool đến Virtual Threads](https://viblo.asia/p/java-threads-va-concurrency-tu-cpu-thread-pool-den-virtual-threads-Nj4vgaOqJ6r) | 2026-08-10 | Java & JVM | Java, programming language, thread, concurrency | 28614 | 1 | yes |
| 13 | [Kafka: Những bài học chỉ Production mới dạy bạn](https://viblo.asia/p/kafka-nhung-bai-hoc-chi-production-moi-day-ban-oKLnqZyWJQO) | 2026-01-24 | Distributed Systems | apache kafka, microservices, System Design | 17826 | 1 | yes |
| 14 | [Khi AI Agent Trở Thành Lỗ Hổng Bảo Mật](https://viblo.asia/p/khi-ai-agent-tro-thanh-lo-hong-bao-mat-K9Vy82aqLQR) | 2026-09-24 | Security | AI Agent, AI Security | 14389 | 1 | yes |
| 15 | [Kiro: Từ AI Coding Agent đến Spec-Driven Development](https://viblo.asia/p/kiro-tu-ai-coding-agent-den-spec-driven-development-y0VGwg30VPA) | 2026-10-02 | AI & AI Agents | AI, AI Agent | 12125 | 2 | yes |
| 16 | [Knowledge Base: Đừng Để Knowledge Của Team “Thất Lạc”](https://viblo.asia/p/knowledge-base-dung-de-knowledge-cua-team-that-lac-XRJ8Rd1ZVGq) | 2026-09-24 | Engineering Practices | AI Agent, Knowleage Base | 32590 | 1 | yes |
| 17 | [Laya – Một lựa chọn thay thế Jev cho AI Decision Making](https://viblo.asia/p/laya-mot-lua-chon-thay-the-jev-cho-ai-decision-making-oKLnqr5WJQO) | 2026-10-01 | AI & AI Agents | AI, OpenSource, Machine Learning, LLM | 12882 | 1 | yes |
| 18 | [Những lưu ý về bảo mật khi tham gia phát triển dự án phần mềm](https://viblo.asia/p/nhung-luu-y-ve-bao-mat-khi-tham-gia-phat-trien-du-an-phan-mem-Nj4vggZdJ6r) | 2025-11-09 | Security | Security, CyberSecurity, Software development | 15480 | 1 | yes |
| 19 | [Project Loom: Cuộc cách mạng xử lý đồng thời trong Java](https://viblo.asia/p/project-loom-cuoc-cach-mang-xu-ly-dong-thoi-trong-java-oKLnqBoQJQO) | 2025-09-13 | Java & JVM | Java | 6783 | 1 | yes |
| 20 | [Ralph Loop: Biến AI Agent Thành Long-Running Agent](https://viblo.asia/p/ralph-loop-bien-ai-agent-thanh-long-running-agent-y0VGwgq0VPA) | 2026-10-01 | AI & AI Agents | AI, AI Agent | 11707 | 1 | yes |
| 21 | [Saga Pattern: Khi Lý Thuyết Va Chạm Thực Tế](https://viblo.asia/p/saga-pattern-khi-ly-thuyet-va-cham-thuc-te-37LdeNDgVov) | 2025-09-02 | Microservices | saga pattern, microservice, System Design | 6924 | 2 | yes |
| 22 | [Thiết Kế Hệ Thống Chịu Tải Cao: Tổng Hợp Giải Pháp Từ Front-end Đến Back-end](https://viblo.asia/p/thiet-ke-he-thong-chiu-tai-cao-tong-hop-giai-phap-tu-front-end-den-back-end-oKLnqqBgJQO) | 2025-09-21 | System Design | System Design, microservices | 10588 | 1 | yes |
| 23 | [Tôi không thích microservices, và đây là lý do](https://viblo.asia/p/toi-khong-thich-microservices-va-day-la-ly-do-Yym40GNmV91) | 2025-06-01 | Microservices | Backend, Build System, microservice | 5862 | 2 | yes |
| 24 | [Tomcat, Jetty hay Undertow? Hướng dẫn chọn Java Web Server hiệu năng cao](https://viblo.asia/p/tomcat-jetty-hay-undertow-huong-dan-chon-java-web-server-hieu-nang-cao-bA468xvlLKv) | 2025-09-13 | Java & JVM | Java | 4681 | 1 | yes |
| 25 | [Tự xây dựng Homelab trên Ubuntu VPS – Góc nhỏ để self-host và khám phá công nghệ](https://viblo.asia/p/tu-xay-dung-homelab-tren-ubuntu-vps-goc-nho-de-self-host-va-kham-pha-cong-nghe-AY4qQO0r4Pw) | 2026-11-07 | DevOps & Infrastructure | homelab, SelfHosting | 6757 | 1 | yes |
| 26 | [Vì sao Twilio Segment nói lời chia tay Microservices và quay về Monolith](https://viblo.asia/p/vi-sao-twilio-segment-noi-loi-chia-tay-microservices-va-quay-ve-monolith-ym4000gA491) | 2025-09-20 | Microservices | microservices, System Design | 6864 | 1 | yes |

## Discovered source URLs

- https://viblo.asia/p/tu-xay-dung-homelab-tren-ubuntu-vps-goc-nho-de-self-host-va-kham-pha-cong-nghe-AY4qQO0r4Pw
- https://viblo.asia/p/dung-quan-ly-cau-hinh-ai-agent-mot-cach-thu-cong-nua-tap-trung-hoa-voi-rulesync-va-git-bNVQGpn0JvR
- https://viblo.asia/p/ai-native-security-xay-dung-he-thong-phong-thu-chu-dong-trong-ky-nguyen-ai-XP4WEZpxL7G
- https://viblo.asia/p/consistency-vs-performance-bai-toan-truy-van-it-duoc-thiet-ke-dung-trong-microservices-1j4lQ1WWJwl
- https://viblo.asia/p/kiro-tu-ai-coding-agent-den-spec-driven-development-y0VGwg30VPA
- https://viblo.asia/p/ralph-loop-bien-ai-agent-thanh-long-running-agent-y0VGwgq0VPA
- https://viblo.asia/p/how-to-set-up-an-ai-agent-pPLkNb5GJRZ
- https://viblo.asia/p/laya-mot-lua-chon-thay-the-jev-cho-ai-decision-making-oKLnqr5WJQO
- https://viblo.asia/p/ai-native-software-development-tai-thiet-ke-software-development-workflow-voi-ai-K9Vy82lALQR
- https://viblo.asia/p/knowledge-base-dung-de-knowledge-cua-team-that-lac-XRJ8Rd1ZVGq
- https://viblo.asia/p/khi-ai-agent-tro-thanh-lo-hong-bao-mat-K9Vy82aqLQR
- https://viblo.asia/p/java-threads-va-concurrency-tu-cpu-thread-pool-den-virtual-threads-Nj4vgaOqJ6r
- https://viblo.asia/p/kafka-nhung-bai-hoc-chi-production-moi-day-ban-oKLnqZyWJQO
- https://viblo.asia/p/nhung-luu-y-ve-bao-mat-khi-tham-gia-phat-trien-du-an-phan-mem-Nj4vggZdJ6r
- https://viblo.asia/p/thiet-ke-he-thong-chiu-tai-cao-tong-hop-giai-phap-tu-front-end-den-back-end-oKLnqqBgJQO
- https://viblo.asia/p/vi-sao-twilio-segment-noi-loi-chia-tay-microservices-va-quay-ve-monolith-ym4000gA491
- https://viblo.asia/p/tomcat-jetty-hay-undertow-huong-dan-chon-java-web-server-hieu-nang-cao-bA468xvlLKv
- https://viblo.asia/p/project-loom-cuoc-cach-mang-xu-ly-dong-thoi-trong-java-oKLnqBoQJQO
- https://viblo.asia/p/graalvm-tuong-lai-cua-java-trong-ky-nguyen-cloud-native-gdJzvbgGJz5
- https://viblo.asia/p/hieu-zero-trust-trong-5-phut-Nj4vg2x0J6r
- https://viblo.asia/p/hieu-saga-pattern-trong-5-phut-XRJ8RlG8VGq
- https://viblo.asia/p/saga-pattern-khi-ly-thuyet-va-cham-thuc-te-37LdeNDgVov
- https://viblo.asia/p/can-than-khi-retry-dung-tu-ddos-chinh-he-thong-cua-minh-yZjJYnKlLOE
- https://viblo.asia/p/ca-tram-don-hang-boc-hoi-chi-trong-3-phut-tat-ca-vi-mot-dong-config-bi-quen-oK9VygxdJQR
- https://viblo.asia/p/ai-khong-cuop-viec-cua-ban-chinh-su-lac-hau-cua-ban-dang-khien-ban-mat-viec-0gdJzR1EJz5
- https://viblo.asia/p/toi-khong-thich-microservices-va-day-la-ly-do-Yym40GNmV91

## Not migrated

None — every article published on the profile is present in the repository.

## Duplicates

None detected (unique titles and slugs).

## How this was produced

```bash
node scripts/migration/fetch.mjs     # public Viblo JSON API -> scripts/migration/source/
node scripts/migration/migrate.mjs   # snapshot -> src/content/blog/*.md + images
node scripts/migration/validate.mjs  # integrity proof -> migration-report/
```

- Discovery used the profile's own paginated JSON feed (`/api/users/lowkey_dev/posts?limit=100`), so no page was skipped by pagination.
- Article bodies came from `/api/posts/<slug>`, the same payload the public article page renders — no HTML scraping and no anti-bot bypassing.
- The API payloads are committed under `scripts/migration/source/` as the audit trail; `validation.json` holds per-article checks and content hashes.

## Notes on fidelity

- Bodies are stored as returned by Viblo's public JSON API; no rewriting, summarising, translating, reflowing or grammatical edits were performed.
- The single transformation is image URL rewriting: every inline image and cover was downloaded to `public/images/articles/<slug>/` and the reference updated to the local path.
- `modDatetime` is set to `null` on purpose: Viblo re-saved every post in Nov 2026 (platform-wide `updated_at` bump with `edited_at: null`), which is not an author edit. The raw values are kept as `sourceUpdatedAt`.
- `description` is a verbatim excerpt of the article's first paragraph, used only for cards and meta tags — the body itself is untouched.
- `category` is assigned from the article's dominant topic (Viblo has no category field for personal posts); original tags are kept unchanged.
