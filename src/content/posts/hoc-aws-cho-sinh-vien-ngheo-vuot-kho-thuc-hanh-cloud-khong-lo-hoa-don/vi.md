---
title: "Học AWS cho sinh viên nghèo vượt khó: Thực hành Cloud không lo hóa đơn!"
description: "Bạn muốn học AWS, muốn thử nghiệm S3, Lambda, DynamoDB, SQS hay xây dựng một hệ thống Serverless hoàn chỉnh, nhưng nhìn đến hóa đơn Cloud là bắt đầu thấy áp lực?"
slug: "hoc-aws-cho-sinh-vien-ngheo-vuot-kho-thuc-hanh-cloud-khong-lo-hoa-don"
locale: "vi"
translationKey: "hoc-aws-cho-sinh-vien-ngheo-vuot-kho-thuc-hanh-cloud-khong-lo-hoa-don"
pubDate: 2026-11-23T14:22:21+07:00
category: "DevOps & Infrastructure"
tags: ["AWS"]
featured: false
draft: false
readingTime: 22
series: null
coverImage: "./cover.png"
---

Bạn muốn học AWS, muốn thử nghiệm S3, Lambda, DynamoDB, SQS hay xây dựng một hệ thống Serverless hoàn chỉnh, nhưng nhìn đến hóa đơn Cloud là bắt đầu thấy áp lực?

Việc học và thực hành AWS đôi khi đi kèm với một nỗi lo khá quen thuộc: chi phí Cloud.

Bạn muốn tạo một vài resources để kiểm tra cách chúng hoạt động, thử nghiệm một kiến trúc mới hoặc xây dựng một bài lab nhỏ. Nhưng mỗi lần sử dụng AWS thật, bạn lại phải quan tâm đến billing, thời gian sử dụng, giới hạn Free Tier và việc cleanup tài nguyên sau khi thử nghiệm.

Đôi khi, thứ khiến developer ngần ngại không phải là độ khó của AWS mà chính là chi phí để được tự tay trải nghiệm nó.

Vậy có cách nào để học AWS, phát triển ứng dụng và thử nghiệm các dịch vụ Cloud mà không phải liên tục lo lắng về hóa đơn?

Một sự kết hợp khá thú vị vừa xuất hiện: **AWS Emulator chính thức của AWS và StackPort – một dự án open-source cung cấp giao diện đồ họa để tương tác với môi trường AWS Emulator.**

Đây là một giải pháp đáng chú ý cho những ai muốn xây dựng môi trường AWS local, thực hành các AWS APIs và giảm chi phí trong quá trình development.

![image.png](/images/articles/hoc-aws-cho-sinh-vien-ngheo-vuot-kho-thuc-hanh-cloud-khong-lo-hoa-don/figure-1.png)

---

## 1. AWS Emulator – Khi AWS có thể chạy ngay trên local

Ngày 11/11/2026, AWS chính thức giới thiệu AWS Emulator – một công cụ cho phép developer chạy môi trường mô phỏng AWS APIs ngay trên máy local.

Đây là một bước tiến thú vị đối với hệ sinh thái AWS local development.

Trước đây, khi muốn phát triển một ứng dụng sử dụng AWS, developer thường phải lựa chọn giữa việc kết nối trực tiếp đến AWS thật hoặc sử dụng những giải pháp giả lập từ bên thứ ba.

AWS Emulator mang đến một lựa chọn khác: một emulator do chính AWS phát triển, sử dụng các AWS APIs tương tự môi trường cloud.

Thay vì gửi request lên AWS thật, bạn có thể trỏ AWS CLI hoặc AWS SDK đến một local endpoint và thực hiện các thao tác trên tài nguyên được mô phỏng.

Ví dụ, thay vì phải tạo S3 bucket trên AWS thật:

```bash
aws s3 mb s3://my-test-bucket \
  --endpoint-url https://127.0.0.1:9297
```

Bạn có thể thực hiện thao tác tương tự ngay trên môi trường local.

Một số khả năng đáng chú ý:

- Chạy AWS API endpoint ngay trên local.
- Sử dụng AWS CLI và AWS SDK quen thuộc.
- Tạo và thao tác với các tài nguyên được emulator hỗ trợ.
- Phát triển và kiểm thử ứng dụng mà không cần gửi request lên AWS thật.
- Tạo nhiều môi trường emulator độc lập cho các bài test.
- Tích hợp vào local development và CI workflows.

Điều đặc biệt là AWS Emulator không yêu cầu bạn phải có AWS account để chạy.

Theo công bố của AWS, emulator không có phí dịch vụ bổ sung. Bạn chỉ phải trả phí cho tài nguyên AWS khi thực sự triển khai lên AWS cloud.

Điều này rất hữu ích khi bạn muốn thử nghiệm một ý tưởng, phát triển ứng dụng hoặc chạy các bài kiểm thử mà chưa cần triển khai hạ tầng thật.

**Một điểm quan trọng:** AWS Emulator không phải bản sao hoàn chỉnh của AWS production. Mức độ tương thích phụ thuộc vào từng service và feature. Ví dụ, emulator hiện chưa đánh giá IAM policies giống AWS thật và chưa hỗ trợ đầy đủ hành vi cross-account hoặc cross-Region.

Tài liệu chính thức:

https://docs.aws.amazon.com/emulator/latest/userguide/

GitHub:

https://github.com/awslabs/aws-emulator

---

## 2. Nhưng AWS Emulator có một vấn đề: Không có giao diện đồ họa!

Đây là điều khá thú vị.

AWS Emulator cung cấp API endpoint, cho phép bạn tương tác thông qua AWS CLI hoặc SDK. Tuy nhiên, bản thân emulator không đi kèm một giao diện đồ họa như AWS Management Console.

Điều đó có nghĩa là nếu muốn kiểm tra các resources, bạn thường phải sử dụng terminal.

Ví dụ:

Muốn liệt kê S3 buckets:

```bash
aws s3api list-buckets \
  --endpoint-url https://127.0.0.1:9297
```

Muốn xem DynamoDB tables:

```bash
aws dynamodb list-tables \
  --endpoint-url https://127.0.0.1:9297
```

Muốn kiểm tra SQS queues:

```bash
aws sqs list-queues \
  --endpoint-url https://127.0.0.1:9297
```

Không có gì sai với CLI. Đây vẫn là cách làm việc rất quen thuộc của nhiều backend developer và DevOps engineer.

Tuy nhiên, khi làm việc với nhiều services cùng lúc, việc phải liên tục ghi nhớ commands, kiểm tra JSON responses và chuyển đổi giữa terminal với documentation có thể khiến trải nghiệm không thực sự trực quan.

Đặc biệt khi bạn muốn khám phá một service mới, một giao diện đồ họa sẽ giúp việc tìm hiểu và thao tác dễ dàng hơn.

Và đây chính là khoảng trống mà StackPort giải quyết.

---

## 3. StackPort – Giao diện Web cho AWS Emulator chính thức

<escape>[StackPort](https://github.com/DaviReisVieira/stackport)</escape> là một dự án open-source xây dựng giao diện web để khám phá, quản lý và tương tác với các AWS resources.

Điểm đáng chú ý là StackPort đã tích hợp trực tiếp với **AWS Emulator chính thức của AWS**.

Trước đó, thị trường đã có nhiều công cụ cung cấp GUI cho các môi trường AWS local như LocalStack Web Application hay những dashboard độc lập khác.

StackPort không phải công cụ đầu tiên giải quyết bài toán này.

Điểm đáng chú ý của StackPort là nó hỗ trợ nhiều emulator khác nhau, trong đó có AWS Emulator vừa được AWS giới thiệu.

Thay vì chỉ làm việc với CLI, bạn có thể mở trình duyệt và quản lý môi trường AWS local thông qua một giao diện tập trung.

<https://stackport.cloud/>

### 3.1. AWS Dashboard – Quan sát toàn bộ môi trường

<https://stackport.cloud/docs/introduction/>

StackPort cung cấp dashboard để khám phá 51 AWS services.

Thay vì phải nhớ service nào đang có resource nào, bạn có thể xem tổng quan các dịch vụ từ một giao diện.

Một số thông tin có thể quan sát:

- Service availability.
- Resource counts.
- Resource status.
- Service health.
- Các tài nguyên đang tồn tại trong môi trường.

Dashboard cũng hỗ trợ cập nhật trạng thái theo thời gian thực thông qua WebSocket.

Điểm hữu ích là các services không được emulator hỗ trợ sẽ được đánh dấu rõ ràng, thay vì hiển thị như thể chúng đang hoạt động bình thường.

### 3.2. S3 Browser – Quản lý Object Storage trực quan

<https://stackport.cloud/docs/service-browsers/s3/>

Thay vì sử dụng AWS CLI cho mọi thao tác với S3, bạn có thể sử dụng giao diện browser.

Các chức năng đáng chú ý:

- Xem danh sách buckets.
- Duyệt objects.
- Upload và download files.
- Điều hướng thư mục.
- Xem thông tin object.
- Quản lý tags.
- Xóa objects.

Đây là một trải nghiệm khá quen thuộc nếu bạn từng sử dụng AWS S3 Console.

### 3.3. DynamoDB Browser – Làm việc với NoSQL Database

<https://stackport.cloud/docs/service-browsers/dynamodb/>

Bạn có thể khám phá DynamoDB tables và thao tác với dữ liệu thông qua giao diện.

Một số chức năng:

- Xem danh sách tables.
- Kiểm tra table configuration.
- Xem và chỉnh sửa items.
- Query dữ liệu.
- Kiểm tra partition key và các thuộc tính.

Đặc biệt, việc xem dữ liệu trực tiếp trên giao diện sẽ thuận tiện hơn nhiều so với việc liên tục gọi CLI và đọc JSON output.

### 3.4. Lambda Browser – Quản lý Serverless Functions

<https://stackport.cloud/docs/service-browsers/lambda/>

Lambda Browser giúp developer khám phá các functions và một số thông tin liên quan:

- Function configuration.
- Environment variables.
- Versions và aliases.
- Event sources.
- Invocation panel.

Bạn cũng có thể invoke Lambda từ giao diện và kiểm tra kết quả thực thi khi môi trường hỗ trợ operation tương ứng.

### 3.5. SQS Browser – Quan sát Message Queue

<https://stackport.cloud/docs/service-browsers/sqs/>

Với SQS, StackPort cung cấp các thao tác trực quan như:

- Xem danh sách queues.
- Kiểm tra queue attributes.
- Gửi messages.
- Nhận messages.
- Xóa messages.

Đây là một công cụ hữu ích khi bạn đang phát triển hệ thống asynchronous processing hoặc event-driven architecture.

### 3.6. API Explorer – Khám phá AWS APIs

Đây là một trong những tính năng mình đánh giá cao.

AWS có hàng nghìn API operations trên nhiều services khác nhau. Không phải service nào cũng có một giao diện quản lý chuyên biệt.

StackPort cung cấp API Explorer, cho phép developer gọi các operations mà boto3 biết thông qua giao diện được tạo dựa trên API model.

Bạn có thể:

- Chọn AWS service.
- Chọn API operation.
- Nhập parameters.
- Gửi request.
- Xem response.
- Copy request dưới dạng AWS CLI command hoặc boto3 code.

Điều này rất hữu ích khi bạn muốn khám phá AWS APIs mà không cần tự viết code cho từng thử nghiệm.

Lưu ý: API Explorer có thể hiển thị nhiều operations, nhưng việc thực thi thành công còn phụ thuộc vào khả năng hỗ trợ của emulator.

---

## 4. StackPort hoạt động như thế nào với AWS Emulator?

Điểm mình thích ở cách StackPort tích hợp là nó không cần cài đặt một plugin riêng vào bên trong AWS Emulator.

StackPort giao tiếp với emulator thông qua AWS API tiêu chuẩn, tương tự cách AWS CLI và AWS SDK tương tác.

Có thể hình dung kiến trúc như sau:

```text
             Developer
                 |
                 v
          +--------------+
          |  StackPort   |
          |   Web UI     |
          +--------------+
                 |
                 v
          +--------------+
          |  StackPort   |
          |   Backend    |
          +--------------+
                 |
                 v
          +--------------+
          | AWS API /    |
          | boto3        |
          +--------------+
                 |
                 v
          +--------------+
          | AWS Emulator |
          | Official     |
          +--------------+
                 |
                 v
          +--------------+
          | Local AWS    |
          | Resources    |
          +--------------+
```

Về công nghệ, StackPort sử dụng:

- Python FastAPI cho backend.
- React và TypeScript cho frontend.
- AWS Cloudscape Design System cho giao diện.
- boto3 để giao tiếp với AWS APIs.
- WebSocket để cập nhật dữ liệu theo thời gian thực.

Cloudscape cũng chính là design system được AWS sử dụng trong nhiều trải nghiệm giao diện của mình.

Một điểm quan trọng nữa: StackPort là dự án độc lập, không phải sản phẩm chính thức của Amazon và không được AWS bảo trợ.

GitHub repository:

https://github.com/DaviReisVieira/stackport

---

## 5. Hướng dẫn cài đặt AWS Emulator và StackPort

Nếu muốn trải nghiệm sự kết hợp này, bạn có thể bắt đầu với Docker Compose.

### Bước 1: Chuẩn bị môi trường

Bạn cần:

- Docker.
- Docker Compose.
- Git hoặc curl.

AWS Emulator có hướng dẫn cài đặt riêng cho Linux, macOS và Windows.

Tài liệu:

https://docs.aws.amazon.com/emulator/latest/userguide/getting-started.html

### Bước 2: Tải Docker Compose configuration

Điểm tiện lợi là repository StackPort đã cung cấp sẵn Docker Compose configuration dành riêng cho AWS Emulator.

```bash
curl -O https://raw.githubusercontent.com/DaviReisVieira/stackport/main/examples/docker-compose.aws-emulator.yml
```

### Bước 3: Khởi chạy môi trường

```bash
docker compose \
  -f docker-compose.aws-emulator.yml \
  up -d
```

Docker Compose sẽ khởi chạy các thành phần cần thiết:

- AWS Emulator.
- StackPort.
- Seed container để tạo một số resources mẫu.

Lần đầu chạy, quá trình build AWS Emulator image có thể mất thêm thời gian.

### Bước 4: Truy cập StackPort

Mở trình duyệt:

```text
http://localhost:8080
```

Bạn sẽ thấy dashboard hiển thị các AWS services và resources đang tồn tại trong môi trường local.

Nếu dashboard chưa có dữ liệu, hãy kiểm tra seed container:

```bash
docker compose \
  -f docker-compose.aws-emulator.yml \
  logs seed
```

### Bước 5: Bắt đầu khám phá

Thử tạo một S3 bucket, thêm một DynamoDB table hoặc gửi thử một message vào SQS.

Tất cả những thao tác được xử lý trong môi trường emulator sẽ không tạo AWS resources trên tài khoản cloud thật.

Bạn có thể tham khảo hướng dẫn tích hợp chính thức của StackPort tại:

https://stackport.cloud/docs/guides/aws-emulator/

---

## 6. Những bài thực hành AWS có thể xây dựng với StackPort

Có một môi trường local là bước đầu. Điều quan trọng hơn là tận dụng nó để thực hành những tình huống gần với công việc thực tế.

Dưới đây là một số bài lab mình nghĩ developer nên thử.

### Lab 1: Xây dựng hệ thống lưu trữ file với S3

**Mục tiêu:** Làm quen với Object Storage và AWS S3 APIs.

Các bước thực hiện:

1. Tạo một S3 bucket.
2. Upload một file.
3. Liệt kê các objects.
4. Download file.
5. Kiểm tra metadata.
6. Xóa object và bucket.

Bạn có thể thực hiện các thao tác này qua StackPort UI và đối chiếu kết quả với AWS CLI.

Qua bài tập này, bạn sẽ hiểu cách ứng dụng backend tương tác với S3 thay vì chỉ đọc documentation.

### Lab 2: Xây dựng ứng dụng CRUD với DynamoDB

**Mục tiêu:** Hiểu cách hoạt động của NoSQL database trên AWS.

Các bước:

1. Tạo một DynamoDB table.
2. Thiết lập partition key.
3. Thêm một số records.
4. Query dữ liệu.
5. Update một item.
6. Thử conditional writes.

Một bài tập thú vị là xây dựng một ứng dụng Todo sử dụng DynamoDB làm database.

Bạn có thể phát triển backend bằng Java Spring Boot hoặc Node.js và cấu hình AWS SDK để kết nối với local endpoint.

### Lab 3: Xây dựng hệ thống xử lý background jobs với SQS

**Mục tiêu:** Hiểu asynchronous processing.

Kiến trúc:

```text
       API Application
              |
              v
         Send Message
              |
              v
           SQS Queue
              |
              v
        Background Worker
              |
              v
         Process Job
```

Thực hành:

- Tạo queue.
- Gửi message.
- Nhận message.
- Kiểm tra message attributes.
- Thử visibility timeout.
- Xóa message sau khi xử lý.

Đây là kiến thức rất hữu ích khi xây dựng backend systems có workload lớn.

### Lab 4: Thực hành AWS Lambda

**Mục tiêu:** Làm quen với Serverless Computing.

Các bước:

1. Tạo Lambda function.
2. Cấu hình runtime.
3. Thiết lập environment variables.
4. Invoke function.
5. Kiểm tra execution result.
6. Quan sát logs nếu service hỗ trợ.

Bạn có thể viết Lambda bằng Python, Java hoặc Node.js và sử dụng AWS SDK để tương tác với các services khác.

### Lab 5: Xây dựng Event-Driven Architecture

**Mục tiêu:** Hiểu cách các AWS services phối hợp với nhau.

Một kiến trúc tham khảo:

```text
       File Upload
            |
            v
           S3
            |
            v
      Event Processing
            |
            v
           SQS
            |
            v
          Lambda
            |
            v
        DynamoDB
```

Ví dụ: Khi một file được upload, hệ thống sẽ tạo một công việc xử lý. Worker sẽ nhận message, xử lý dữ liệu và lưu kết quả vào DynamoDB.

Bạn có thể xây dựng từng thành phần và kiểm tra API operations qua StackPort.

Lưu ý rằng để chạy tự động toàn bộ luồng, emulator phải hỗ trợ các event integrations tương ứng. Nếu chưa hỗ trợ, bạn vẫn có thể thực hành từng bước bằng cách gửi message và invoke function thủ công.

---

## 7. AWS Emulator và StackPort khác gì LocalStack?

Đây là câu hỏi khá thú vị vì LocalStack đã tồn tại từ lâu và được sử dụng rộng rãi trong cộng đồng AWS developers.

Thực tế, chúng không hoàn toàn là những sản phẩm cạnh tranh trực tiếp ở cùng một lớp.

| Tiêu chí | AWS Emulator | LocalStack | StackPort |
|---|---|---|---|
| Vai trò | AWS API emulator | AWS API emulator | Web console |
| Nhà phát triển | AWS | LocalStack | Dự án độc lập |
| CLI / SDK | Có | Có | API Explorer và CLI riêng |
| GUI quản lý | Không | Có các trải nghiệm GUI riêng | Có |
| Mục đích | Local testing | Local development/testing | Quản lý và khám phá resources |
| Chi phí | Không có phí emulator | Có các lựa chọn theo gói | MIT open-source |

Điểm quan trọng là StackPort có thể kết nối với nhiều emulator, bao gồm:

- AWS Emulator.
- LocalStack.
- MiniStack.
- Floci.
- Moto.

Bạn không nhất thiết phải chọn một emulator duy nhất chỉ vì muốn sử dụng StackPort.

Nếu bạn đang sử dụng AWS Emulator chính thức của AWS, StackPort có thể đóng vai trò giao diện quản lý cho môi trường đó.

Nếu đang sử dụng LocalStack, bạn cũng có thể kết nối StackPort với LocalStack thông qua endpoint tương ứng.

Đây là một điểm cộng đáng kể cho những developer thường xuyên thay đổi môi trường development.

---

## 8. Những giới hạn cần biết trước khi sử dụng

Mặc dù AWS Emulator và StackPort là một sự kết hợp đáng chú ý, vẫn có một số điểm cần hiểu rõ.

**Thứ nhất: Không phải toàn bộ AWS services đều được hỗ trợ đầy đủ.**

AWS Emulator có service coverage và fidelity khác nhau. Một API xuất hiện trong SDK hoặc API Explorer không có nghĩa là emulator đã thực hiện đầy đủ hành vi tương ứng.

**Thứ hai: Không thay thế hoàn toàn AWS production.**

Một số hành vi như IAM policy evaluation, networking, cross-account, cross-Region và service quotas có thể khác với AWS thật.

**Thứ ba: GUI không quyết định độ chính xác của emulator.**

StackPort là lớp giao diện và quản lý. Engine thực thi vẫn là AWS Emulator.

**Thứ tư: Local không đồng nghĩa với không có bất kỳ chi phí nào.**

AWS Emulator không có phí dịch vụ bổ sung và StackPort được phát hành theo MIT License. Tuy nhiên, bạn vẫn cần máy tính, bộ nhớ, CPU và dung lượng lưu trữ để chạy các containers.

Đối với môi trường production, vẫn nên kiểm thử trực tiếp trên AWS thật trước khi triển khai.

---

## 9. Tại sao đây là một lựa chọn đáng thử cho developer?

Mình nghĩ giá trị lớn nhất của sự kết hợp này không chỉ là tiết kiệm chi phí.

Nó còn giúp thay đổi cách developer tiếp cận việc học và phát triển ứng dụng Cloud.

Thay vì phải tạo một tài khoản AWS, cấu hình billing, tạo resources, kiểm tra permissions và cleanup sau mỗi lần thử nghiệm, bạn có thể bắt đầu với một môi trường local.

Bạn có thể:

- Thử nghiệm nhanh một AWS API.
- Xây dựng prototype sử dụng nhiều AWS services.
- Viết integration tests.
- Kiểm tra cách backend tương tác với AWS SDK.
- Khám phá resource configurations.
- Tạo môi trường local phục vụ CI.
- Thử nghiệm nhiều kiến trúc mà không phải deploy liên tục.

Đặc biệt, nếu bạn là Java backend developer, bạn hoàn toàn có thể xây dựng một ứng dụng Spring Boot sử dụng S3, DynamoDB hoặc SQS thông qua AWS SDK, sau đó kết nối ứng dụng đến AWS Emulator.

Đây là một workflow rất hữu ích để phát triển và kiểm thử ứng dụng trước khi triển khai lên AWS thật.

---

## Kết luận

AWS Emulator và StackPort là một sự kết hợp đáng chú ý trong hệ sinh thái AWS local development.

AWS mang đến một emulator chính thức để developer có thể thực hành AWS APIs ngay trên local.

StackPort bổ sung phần trải nghiệm còn thiếu: một giao diện web trực quan để khám phá, quản lý và tương tác với các resources.

Điểm mình đánh giá cao là StackPort không cố gắng xây dựng lại một AWS emulator khác. Thay vào đó, dự án tận dụng các AWS APIs tiêu chuẩn để hỗ trợ nhiều emulator, trong đó có AWS Emulator chính thức của AWS.

Nếu bạn đang học AWS, chuẩn bị AWS Certification hoặc phát triển một ứng dụng sử dụng AWS services, đây là một bộ công cụ rất đáng để đưa vào danh sách thử nghiệm.

Không phải lúc nào bạn cũng cần một tài khoản AWS thật để bắt đầu học Cloud.

Đôi khi, bạn chỉ cần một môi trường local tốt, một vài ý tưởng để thử nghiệm và đủ kiên nhẫn để debug những lỗi đầu tiên.

**Học AWS không cần ví dày. Quan trọng là chịu khó thực hành! :))**

---

## Useful Resources

| Resource | Link |
|---|---|
| AWS Emulator | https://github.com/awslabs/aws-emulator |
| AWS Emulator Documentation | https://docs.aws.amazon.com/emulator/latest/userguide/ |
| StackPort GitHub | https://github.com/DaviReisVieira/stackport |
| StackPort Website | https://stackport.cloud/ |
| StackPort AWS Emulator Guide | https://stackport.cloud/docs/guides/aws-emulator/ |
| AWS
