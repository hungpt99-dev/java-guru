---
title: "AWS Emulator – Kiểm thử AWS Services mà không cần kết nối AWS thật"
description: "Khi phát triển một ứng dụng sử dụng AWS, việc viết code đôi khi không phải là phần mất nhiều thời gian nhất. Thách thức thường nằm ở quá trình kiểm thử và tích hợp với các dịch vụ bên ngoài."
slug: "aws-emulator-kiem-thu-aws-services-ma-khong-can-ket-noi-aws-that"
locale: "vi"
translationKey: "aws-emulator-kiem-thu-aws-services-ma-khong-can-ket-noi-aws-that"
pubDate: 2026-11-12T10:34:12+07:00
category: "DevOps & Infrastructure"
tags: ["AWS", "Cloud Computing", "Testing"]
featured: false
draft: false
readingTime: 40
series: null
coverImage: "./cover.png"
---

## 1. Mở đầu – Kiểm thử AWS Services mà không cần kết nối AWS thật

Khi phát triển một ứng dụng sử dụng AWS, việc viết code đôi khi không phải là phần mất nhiều thời gian nhất. Thách thức thường nằm ở quá trình kiểm thử và tích hợp với các dịch vụ bên ngoài.

Chẳng hạn, một ứng dụng Spring Boot có thể sử dụng Amazon S3 để lưu trữ file, Amazon SQS để xử lý message bất đồng bộ, DynamoDB để lưu dữ liệu, SNS để gửi notification hoặc EventBridge để điều phối các sự kiện giữa những thành phần trong hệ thống.

Ở môi trường production, những dịch vụ này hoạt động trên AWS Cloud. Nhưng trong quá trình phát triển, developer vẫn cần một cách để kiểm tra logic tích hợp trước khi deploy ứng dụng lên môi trường thật.

Thông thường, chúng ta có một số lựa chọn:

- Sử dụng AWS account riêng cho Development.
- Tạo tài nguyên trên AWS rồi thực hiện kiểm thử trực tiếp.
- Mock AWS SDK trong Unit Test.
- Sử dụng các công cụ giả lập AWS Services chạy trên máy local.

Mỗi cách đều có ưu và nhược điểm riêng. Việc sử dụng AWS thật mang lại độ tin cậy cao hơn về môi trường, nhưng lại cần quản lý credentials, tài nguyên, chi phí và quá trình cleanup. Trong khi đó, Mocking giúp test nhanh nhưng không đảm bảo hành vi giống AWS thực tế.

Đặc biệt, với những hệ thống sử dụng nhiều AWS Services, việc kiểm thử một luồng nghiệp vụ có thể kéo theo khá nhiều bước chuẩn bị.

Ví dụ, một luồng xử lý đơn hàng có thể cần:

1. Upload file lên S3.
2. Gửi message vào SQS.
3. Worker nhận message và xử lý.
4. Lưu trạng thái vào DynamoDB.
5. Publish sự kiện qua SNS hoặc EventBridge.

Nếu mỗi lần thay đổi logic đều phải deploy hoặc tạo tài nguyên trên AWS để kiểm tra, vòng lặp phát triển sẽ trở nên chậm hơn.

Vậy có cách nào để phát triển và kiểm thử những phần tích hợp AWS ngay trên máy cá nhân, mà không cần liên tục tạo tài nguyên trên AWS thật?

Đây chính là bài toán mà **AWS Emulator** hướng đến.

## 2. AWS Emulator là gì?

Ngày 11/11/2026, AWS giới thiệu AWS Emulator – một công cụ cho phép chạy môi trường mô phỏng AWS API ngay trên máy local hoặc trong môi trường CI.

Hiểu đơn giản, AWS Emulator tạo ra một endpoint local để ứng dụng có thể gửi request thông qua AWS SDK hoặc AWS CLI giống như khi giao tiếp với AWS thật.

Thay vì gửi request lên AWS Cloud, request được chuyển đến AWS Emulator đang chạy trên máy developer.

Điểm đáng chú ý là developer không cần viết lại logic tích hợp hoặc thay đổi cách sử dụng AWS SDK. Ứng dụng vẫn sử dụng các API quen thuộc, nhưng đích đến của request được chuyển sang môi trường local.

AWS Emulator có một số đặc điểm:

- Không yêu cầu AWS account để sử dụng.
- Không cần triển khai tài nguyên lên AWS Cloud.
- Không tính thêm phí dịch vụ emulator.
- Hỗ trợ AWS SDK và AWS CLI.
- Có thể chạy trên máy developer hoặc trong CI/CD.
- Các tài nguyên được tạo nằm trong môi trường emulator, không phải AWS thật.

Điều này giúp developer có thể kiểm thử những phần tích hợp AWS ngay trong quá trình phát triển, thay vì phải chờ đến khi triển khai lên Cloud.

## 3. AWS Emulator hoạt động như thế nào?

Để hiểu rõ hơn, hãy nhìn vào cách một ứng dụng thông thường giao tiếp với AWS.

### 3.1. Luồng giao tiếp với AWS thật

Trong môi trường production, luồng xử lý thường như sau:

**Application → AWS SDK → AWS API → AWS Service**

Ví dụ, khi ứng dụng cần upload một file lên Amazon S3:

1. Application gọi phương thức upload thông qua AWS SDK.
2. SDK tạo HTTP request theo cấu trúc API của S3.
3. SDK ký request bằng AWS Signature Version 4.
4. Request được gửi đến AWS API.
5. S3 xử lý request và trả về response.

Developer không cần trực tiếp xây dựng HTTP request hay xử lý toàn bộ giao thức giao tiếp với AWS. Những công việc này được AWS SDK đảm nhiệm.

### 3.2. Luồng giao tiếp với AWS Emulator

Khi sử dụng AWS Emulator, luồng giao tiếp được thay đổi:

**Application → AWS SDK → AWS Emulator → Local Resource State**

Thay vì gửi request đến AWS Cloud, SDK gửi request đến endpoint local của emulator.

AWS Emulator tiếp nhận request, xử lý API tương ứng và trả về response cho ứng dụng.

Về phía application, cách sử dụng SDK gần như không thay đổi. Điểm khác biệt chủ yếu nằm ở endpoint mà SDK kết nối đến.

Theo tài liệu AWS, emulator sử dụng HTTPS endpoint mặc định tại `https://127.0.0.1:9297`.

Khi khởi động, emulator tự tạo credentials, configuration và certificate riêng. Các request gửi đến emulator được ký bằng credentials do chính emulator cung cấp.

Điều này giúp tách biệt môi trường local với AWS account thật.

### 3.3. Resource State được quản lý như thế nào?

Một điểm quan trọng của emulator là khả năng duy trì trạng thái tài nguyên.

Hãy tưởng tượng developer thực hiện các thao tác sau:

- Tạo một S3 bucket.
- Upload một file vào bucket.
- Gửi request lấy danh sách object.
- Download lại file vừa upload.

Nếu emulator chỉ trả về response giả lập mà không duy trì trạng thái, các thao tác sau sẽ không thể phản ánh đúng kết quả của thao tác trước đó.

AWS Emulator quản lý trạng thái tài nguyên trong bộ nhớ của tiến trình.

Ví dụ, khi tạo một queue, gửi message rồi nhận message từ queue đó, emulator có thể duy trì trạng thái để các thao tác tiếp theo nhìn thấy kết quả đã được tạo trước đó.

Tuy nhiên, trạng thái này không mặc định tồn tại sau khi emulator dừng. Khi cần một môi trường kiểm thử sạch, developer có thể khởi tạo instance mới.

### 3.4. Cách ly các môi trường kiểm thử

Một điểm đáng chú ý khác là mỗi instance AWS Emulator có port, credentials và trạng thái riêng.

Điều này có ý nghĩa khi nhiều test suite hoặc nhiều CI job cần chạy song song.

Ví dụ:

- Test suite A tạo S3 bucket `test-a`.
- Test suite B tạo S3 bucket `test-b`.
- Hai test suite chạy trên hai instance emulator khác nhau.

Như vậy, dữ liệu của hai môi trường không bị trộn lẫn hoặc ghi đè lên nhau.

Đây là một lợi thế đáng quan tâm khi thiết kế Integration Test chạy song song trong CI/CD.

## 4. AWS Emulator và AWS API Models

Một điểm khá thú vị trong thiết kế của AWS Emulator là cách nó xây dựng khả năng tương thích với AWS.

AWS Emulator sử dụng các API Models do AWS công bố. Những mô hình này cũng là nền tảng được sử dụng trong quá trình xây dựng AWS SDK.

Cụ thể, AWS API Models mô tả hợp đồng giao tiếp của các service, bao gồm:

- Những operation mà một service hỗ trợ.
- Cấu trúc request và response.
- Các kiểu dữ liệu.
- Những trường bắt buộc.
- Quy tắc validation.
- Các lỗi có thể xảy ra.

AWS sử dụng Smithy để mô hình hóa API. Có thể hiểu đây là cách mô tả cấu trúc và hành vi giao tiếp của service dưới dạng model có quy tắc rõ ràng.

Ví dụ, một API có thể quy định request cần có những trường nào, kiểu dữ liệu của từng trường và response được trả về theo cấu trúc nào.

AWS SDK sử dụng các API model này để xây dựng cách giao tiếp với AWS. AWS Emulator cũng dựa trên những model tương tự để triển khai khả năng xử lý API local.

### 4.1. API Model không đồng nghĩa với việc mô phỏng hoàn chỉnh AWS

Đây là điểm cần phân biệt.

Một API Model có thể mô tả chính xác cấu trúc request và response, nhưng điều đó không có nghĩa emulator tự động mô phỏng được toàn bộ hành vi của service.

Ví dụ, một API có thể được mô tả đầy đủ về mặt cấu trúc, nhưng phần xử lý nghiệp vụ phía sau vẫn cần được triển khai.

Do đó, cần phân biệt hai khái niệm:

- **API Compatibility:** Khả năng tương thích về giao thức và cấu trúc API.
- **Behavioral Fidelity:** Mức độ mô phỏng chính xác hành vi thực tế của AWS.

Một emulator có thể nhận request đúng cấu trúc nhưng vẫn chưa xử lý đầy đủ những quy tắc nghiệp vụ phức tạp của service.

Đây cũng là lý do AWS Emulator có cơ chế đo lường Fidelity thay vì chỉ công bố rằng một API đã được hỗ trợ.

## 5. AWS Emulator Fidelity – Đo lường mức độ tương thích với AWS

Một trong những điểm đáng chú ý nhất của AWS Emulator là cách AWS đo lường mức độ tương thích với AWS thật.

AWS gọi khái niệm này là **Fidelity**.

Thay vì chỉ kiểm tra emulator có nhận được request hay không, AWS xây dựng các bài kiểm thử để so sánh kết quả giữa emulator và AWS thực tế.

### 5.1. Fidelity Test là gì?

Một Fidelity Test thường là một chương trình ngắn sử dụng AWS SDK để thực hiện một workflow cụ thể.

Ví dụ, với Amazon S3, một bài kiểm thử có thể thực hiện:

1. Tạo bucket.
2. Upload object.
3. Lấy thông tin object.
4. Download object.
5. Xóa object.
6. Xóa bucket.

Sau đó, kết quả được so sánh giữa AWS thật và AWS Emulator.

Việc so sánh không chỉ dựa trên việc request thành công hay thất bại, mà còn xem xét:

- HTTP status code.
- Response body.
- Error code.
- Error message.
- Trạng thái tài nguyên.
- Dữ liệu được tạo ra sau khi thực hiện workflow.

Một test chỉ được xem là đạt khi các kết quả quan trọng khớp với hành vi của AWS trong phạm vi được kiểm tra.

### 5.2. Fidelity Report có ý nghĩa gì?

AWS công bố kết quả Fidelity theo từng service và từng release.

Ví dụ, nếu một service có 50 bài kiểm thử và 40 bài đạt, kết quả có thể được biểu diễn là 40/50.

Con số này giúp developer có cái nhìn rõ hơn về mức độ hỗ trợ của emulator đối với service mình đang sử dụng.

Tuy nhiên, không nên hiểu rằng Fidelity 80% đồng nghĩa với việc 80% mọi chức năng của service đã hoạt động hoàn chỉnh.

Fidelity Score phản ánh tỷ lệ bài kiểm thử trong bộ đánh giá đã vượt qua, không phải tỷ lệ coverage tuyệt đối của toàn bộ AWS API.

Một service có thể có nhiều API được hỗ trợ nhưng vẫn có những trường hợp biên chưa được kiểm thử.

Ngoài ra, bộ Fidelity Test có thể được bổ sung theo từng release. Vì vậy, điểm số có thể thay đổi khi số lượng test tăng lên.

### 5.3. Vì sao Fidelity quan trọng?

Với các emulator thông thường, developer thường phải tự kiểm tra xem hành vi của công cụ có giống AWS thật hay không.

Điều này có thể tạo ra một vấn đề: test pass trên local nhưng lại fail khi chạy trên AWS.

Ví dụ:

- Local trả về thành công nhưng AWS thật từ chối request.
- Local không kiểm tra một trường bắt buộc nhưng AWS yêu cầu.
- Local xử lý lỗi khác với AWS.
- Local duy trì trạng thái tài nguyên không giống hành vi thực tế.

Fidelity Test giúp thu hẹp khoảng cách này.

Thay vì chỉ dựa vào tài liệu hoặc kỳ vọng của developer, AWS có một bộ kiểm thử công khai để đo lường sự khác biệt giữa hai môi trường.

Đây là một hướng tiếp cận đáng chú ý, đặc biệt với những hệ thống phụ thuộc nhiều vào hành vi cụ thể của AWS API.

## 6. AWS Emulator khác gì so với Mocking?

Đây là điểm quan trọng để hiểu giá trị thực tế của AWS Emulator.

Trong quá trình viết Unit Test, developer thường sử dụng Mock để giả lập hành vi của AWS SDK.

Ví dụ, khi kiểm thử chức năng upload file, chúng ta có thể mock phương thức upload và cấu hình để nó luôn trả về kết quả thành công.

Cách làm này rất hữu ích cho Unit Test, nhưng có một hạn chế: Mock chỉ phản ánh những gì developer định nghĩa.

Nó không nhất thiết phản ánh cách AWS API thực sự hoạt động.

Hãy tưởng tượng ứng dụng gửi một request có cấu trúc không hợp lệ đến S3. Nếu mock được cấu hình trả về thành công, test vẫn pass dù khi chạy trên AWS thật, request đó có thể thất bại.

AWS Emulator tiếp cận vấn đề theo hướng khác.

Thay vì giả lập riêng từng phương thức của SDK, emulator cung cấp một môi trường xử lý AWS API. Request được gửi đến emulator và được xử lý theo logic của API mà nó hỗ trợ.

| Tiêu chí | Mocking | AWS Emulator |
| --- | --- | --- |
| Mục đích | Giả lập dependency | Mô phỏng AWS API |
| Xử lý request | Theo cấu hình của test | Theo API được hỗ trợ |
| Validation | Do developer định nghĩa | Có xử lý validation tương ứng |
| Trạng thái tài nguyên | Thường phải tự quản lý | Emulator quản lý trạng thái local |
| Mô phỏng lỗi | Linh hoạt theo cấu hình | Theo hành vi được triển khai |
| Phát hiện lỗi tích hợp API | Hạn chế | Có thể phát hiện nhiều lỗi hơn |
| Tốc độ và tính cô lập | Rất phù hợp cho Unit Test | Phù hợp cho Integration Test |

Điều này không có nghĩa AWS Emulator thay thế hoàn toàn Mocking.

Mock vẫn rất phù hợp cho Unit Test, đặc biệt khi cần kiểm soát chính xác một tình huống hoặc mô phỏng lỗi khó tái tạo.

AWS Emulator phù hợp hơn khi cần kiểm thử quá trình tương tác giữa ứng dụng và AWS API.

Hai cách tiếp cận có thể bổ sung cho nhau trong cùng một chiến lược kiểm thử.

## 7. AWS Emulator vs LocalStack – Hai hướng tiếp cận AWS local

Trước khi AWS Emulator xuất hiện, LocalStack đã là một trong những lựa chọn phổ biến khi developer muốn chạy AWS Services trên máy local.

Vì vậy, việc AWS phát triển một công cụ có cùng mục tiêu khiến LocalStack trở thành đối tượng so sánh tự nhiên.

Tuy nhiên, không nên xem hai công cụ chỉ khác nhau ở tên gọi. Chúng có những điểm khác biệt trong cách tiếp cận, phạm vi tính năng và hệ sinh thái.

### 7.1. LocalStack là gì?

<escape>LocalStack</escape> là một nền tảng mô phỏng Cloud Services, cho phép developer chạy nhiều dịch vụ AWS ngay trên máy cá nhân hoặc trong môi trường CI.

Thay vì phải tạo tài nguyên trên AWS thật, developer có thể khởi chạy LocalStack và sử dụng AWS SDK, AWS CLI hoặc các công cụ Infrastructure as Code để tương tác với những service được hỗ trợ.

Một số dịch vụ thường được sử dụng với LocalStack:

- Amazon S3.
- Amazon SQS.
- Amazon SNS.
- Amazon DynamoDB.
- AWS Lambda.
- Amazon API Gateway.
- Amazon EventBridge.
- AWS Step Functions.

LocalStack thường được triển khai thông qua Docker, phù hợp với các workflow phát triển local và Integration Test.

Ngoài việc giả lập API, LocalStack còn phát triển thêm nhiều tính năng phục vụ quá trình phát triển và kiểm thử như quản lý trạng thái, Cloud Pods, tích hợp IaC, IAM policy enforcement, sandbox và các công cụ hỗ trợ CI/CD.

### 7.2. So sánh tổng quan

| Tiêu chí | AWS Emulator | LocalStack |
| --- | --- | --- |
| Nhà phát triển | AWS | LocalStack |
| Mục tiêu chính | Mô phỏng AWS API với độ tương thích được đo lường | Cung cấp môi trường Cloud local với hệ sinh thái tính năng rộng |
| Cách triển khai | Package trên Linux, Docker trên macOS/Windows và embedded mode cho một số trường hợp | Chủ yếu thông qua Docker, CLI và các phương thức triển khai được hỗ trợ |
| AWS SDK / CLI | Hỗ trợ | Hỗ trợ |
| API Models | Sinh service từ AWS API Models | Triển khai emulator và các service theo nền tảng LocalStack |
| Fidelity | Công bố bộ Fidelity Test và kết quả theo release | Có cơ chế kiểm thử và tài liệu coverage riêng |
| Trạng thái tài nguyên | In-memory, mất khi dừng instance | Có các tùy chọn persistence và snapshot tùy phiên bản/gói |
| Cách ly môi trường | Mỗi instance có port, credentials và state riêng | Có sandbox, instance và các tính năng cô lập tùy cấu hình/gói |
| IAM | Không mô phỏng đầy đủ IAM policy như AWS | Có các tính năng IAM policy enforcement tùy gói |
| Cross-account / Cross-Region | Chưa hỗ trợ đầy đủ theo giới hạn ban đầu | Có hỗ trợ các kịch bản multi-account và cross-region tùy tính năng |
| IaC | Có thể sử dụng AWS CLI/SDK; cần kiểm tra khả năng tương thích từng workflow | Có tích hợp Terraform, CDK, CloudFormation và nhiều công cụ IaC |
| Chi phí | Không có phí dịch vụ emulator | Có gói miễn phí và các gói trả phí |

Điểm cần lưu ý là phạm vi hỗ trợ của cả hai công cụ thay đổi theo từng phiên bản và gói sản phẩm. Bảng trên mô tả hướng tiếp cận và các khả năng nổi bật, không phải cam kết rằng mọi API đều được hỗ trợ.

### 7.3. Khác biệt trong triết lý thiết kế

Đây là điểm thú vị nhất khi so sánh hai công cụ.

**AWS Emulator: Tập trung vào AWS API và Fidelity**

AWS Emulator được phát triển bởi chính AWS và sử dụng các API Models do AWS công bố làm nền tảng.

Một trong những mục tiêu quan trọng là đảm bảo các request được xử lý gần với hành vi AWS thật nhất có thể trong phạm vi API được hỗ trợ.

AWS công bố Fidelity Test để developer có thể kiểm tra mức độ tương thích của từng service.

Nếu một operation chưa được triển khai, emulator trả về HTTP 501 Not Implemented thay vì giả vờ xử lý thành công.

Cách tiếp cận này khá rõ ràng: ưu tiên tính minh bạch về mức độ hỗ trợ và độ tương thích của API.

**LocalStack: Tập trung vào môi trường Cloud local và hệ sinh thái phát triển**

LocalStack không chỉ dừng lại ở việc cung cấp endpoint mô phỏng AWS API.

Nền tảng này còn phát triển nhiều tính năng để hỗ trợ toàn bộ vòng đời phát triển ứng dụng:

- Chạy và kiểm thử nhiều AWS Services.
- Tích hợp Terraform, CDK và các công cụ IaC.
- Quản lý trạng thái thông qua persistence và snapshot.
- Hỗ trợ sandbox cho developer.
- Tích hợp CI/CD.
- Hỗ trợ kiểm thử IAM và một số kịch bản bảo mật.
- Các công cụ quan sát, debug và kiểm thử nâng cao.

Có thể nói LocalStack hướng đến việc cung cấp một môi trường Cloud local có nhiều tiện ích phục vụ developer và team engineering.

### 7.4. Khác biệt về Fidelity và API Coverage

Một trong những câu hỏi quan trọng khi chọn emulator là:

**Làm sao biết API mà mình đang sử dụng thực sự hoạt động giống AWS?**

AWS Emulator giải quyết vấn đề này bằng Fidelity Test.

Mỗi release có các bài kiểm thử so sánh kết quả với AWS thật. Developer có thể xem kết quả theo từng service và từng workflow.

Với LocalStack, developer cần tham khảo Service Coverage, tài liệu của từng service và các tính năng tương ứng với gói đang sử dụng.

Không nên chỉ nhìn vào số lượng service được quảng bá. Một service có thể được liệt kê là supported nhưng vẫn có những operation hoặc hành vi chưa được mô phỏng đầy đủ.

Vì vậy, khi đánh giá hai công cụ, nên tập trung vào những API mà ứng dụng thực sự sử dụng.

Ví dụ, một hệ thống chỉ dùng S3, SQS và DynamoDB không nhất thiết cần một emulator hỗ trợ hàng trăm service. Điều quan trọng là những workflow cụ thể của hệ thống có hoạt động đúng hay không.

### 7.5. Khác biệt về trạng thái và môi trường kiểm thử

AWS Emulator lưu trạng thái tài nguyên trong bộ nhớ của tiến trình.

Khi emulator dừng, trạng thái đó không mặc định được giữ lại.

Điều này có lợi cho những test cần môi trường sạch và dễ tái tạo. Mỗi lần chạy có thể khởi tạo một instance mới mà không cần lo dữ liệu từ lần trước ảnh hưởng đến kết quả.

Trong khi đó, LocalStack có các tính năng persistence và snapshot, cho phép lưu và khôi phục trạng thái môi trường theo khả năng của phiên bản và gói sản phẩm.

Ví dụ, một team có thể chuẩn bị sẵn một trạng thái môi trường với bucket, queue và các tài nguyên cần thiết, sau đó sử dụng lại cho nhiều lần kiểm thử.

Đây là khác biệt đáng cân nhắc nếu dự án có những môi trường local phức tạp và cần giữ lại trạng thái giữa các phiên chạy.

### 7.6. Khác biệt về IAM và Security Testing

Đây là điểm cần đặc biệt chú ý.

AWS Emulator không đánh giá IAM Policy và Resource-based Policy theo cách AWS thật thực hiện.

Một request được emulator chấp nhận không đồng nghĩa request đó chắc chắn được AWS chấp nhận.

LocalStack cung cấp các tính năng IAM policy enforcement và IAM testing ở một số gói sản phẩm.

Điều này giúp LocalStack phù hợp hơn với một số kịch bản cần kiểm tra logic phân quyền trong môi trường local.

Tuy nhiên, ngay cả khi sử dụng LocalStack, cũng không nên xem kết quả kiểm thử local là bằng chứng đầy đủ cho tính an toàn của hệ thống trên AWS.

Những vấn đề liên quan đến IAM, resource policy, trust relationship, network boundary và các cơ chế bảo mật thực tế vẫn cần được xác minh trên AWS.

### 7.7. Khác biệt về chi phí

AWS Emulator không có phí dịch vụ riêng. Developer có thể sử dụng mà không cần trả phí cho việc chạy emulator.

LocalStack hiện cung cấp nhiều gói khác nhau, bao gồm Hobby miễn phí cho mục đích phi thương mại và các gói trả phí dành cho team hoặc workload phức tạp hơn.

Các tính năng như số lượng service được hỗ trợ, persistence, IAM enforcement nâng cao và sandbox có thể phụ thuộc vào gói sử dụng.

Vì vậy, khi lựa chọn, không nên chỉ so sánh việc công cụ nào miễn phí. Cần xem xét cả những tính năng mà dự án thực sự cần.

### 7.8. Nên chọn AWS Emulator hay LocalStack?

Không có một câu trả lời đúng cho mọi dự án.

Có thể cân nhắc AWS Emulator nếu:

- Muốn sử dụng một công cụ do AWS phát triển.
- Ưu tiên khả năng tương thích với AWS API và muốn xem Fidelity Report.
- Cần môi trường kiểm thử local đơn giản.
- Muốn tạo nhiều instance độc lập cho các test suite.
- Không cần giữ trạng thái tài nguyên sau khi emulator dừng.

Có thể cân nhắc LocalStack nếu:

- Dự án sử dụng nhiều AWS Services.
- Cần một hệ sinh thái hỗ trợ IaC và CI/CD phong phú.
- Muốn sử dụng persistence hoặc snapshot để tái sử dụng môi trường.
- Cần sandbox và các tính năng hỗ trợ team development.
- Có nhu cầu kiểm thử IAM bằng các tính năng mà gói LocalStack đang cung cấp.

Một cách tiếp cận thực tế là chọn công cụ dựa trên workload thay vì chọn theo thương hiệu.

Nếu dự án chỉ cần kiểm thử một số API cơ bản, AWS Emulator có thể là lựa chọn gọn nhẹ. Nếu dự án cần một môi trường Cloud local nhiều tính năng và tích hợp sâu với quy trình DevOps, LocalStack đáng để cân nhắc.

## 8. Những tình huống có thể sử dụng AWS Emulator

### 8.1. Local Development

Đây là một trong những trường hợp sử dụng dễ thấy nhất.

Developer có thể phát triển các chức năng liên quan đến AWS ngay trên máy cá nhân mà không cần liên tục tạo tài nguyên trên Cloud.

Ví dụ:

- Phát triển chức năng upload và download file với S3.
- Kiểm thử producer và consumer với SQS.
- Kiểm thử các thao tác đọc và ghi dữ liệu với DynamoDB.
- Kiểm thử luồng publish và subscribe với SNS.

Điều này giúp giảm sự phụ thuộc vào môi trường AWS trong quá trình phát triển hằng ngày.

### 8.2. Integration Testing

Trong một hệ thống backend, nhiều chức năng không chỉ phụ thuộc vào database mà còn tích hợp với các dịch vụ AWS.

Thay vì chỉ mock toàn bộ AWS SDK, developer có thể sử dụng emulator để kiểm thử luồng tương tác thực tế hơn.

Ví dụ, một luồng xử lý đơn hàng có thể bao gồm:

1. Ứng dụng nhận yêu cầu tạo đơn hàng.
2. Thông tin được lưu vào database.
3. Một message được gửi đến SQS.
4. Worker nhận message và xử lý.
5. Kết quả được lưu trữ hoặc thông báo qua một AWS service khác.

AWS Emulator có thể hỗ trợ kiểm thử những phần tương tác với các AWS API được nó triển khai.

Nhờ vậy, developer có thể kiểm tra nhiều lỗi mà Unit Test sử dụng mock thông thường khó phát hiện.

### 8.3. CI/CD Pipeline

AWS Emulator cũng có thể được sử dụng trong CI/CD.

Thay vì mỗi lần chạy Integration Test đều phải tạo tài nguyên trên AWS, pipeline có thể khởi chạy một instance emulator riêng cho từng job.

Một workflow có thể gồm:

- Khởi chạy emulator.
- Chuẩn bị cấu hình endpoint và credentials.
- Khởi tạo những tài nguyên cần thiết.
- Chạy Integration Test.
- Thu thập kết quả kiểm thử.
- Dừng emulator và giải phóng tài nguyên.

Mỗi job có thể sử dụng một instance độc lập, hạn chế xung đột dữ liệu giữa các lần chạy.

Điều này đặc biệt hữu ích khi có nhiều Pull Request được kiểm thử đồng thời.

### 8.4. Testing với nhiều môi trường độc lập

Một vấn đề thường gặp trong Integration Test là các test cùng sử dụng một môi trường và một tập dữ liệu chung.

Ví dụ, hai test cùng tạo một bucket có tên giống nhau hoặc cùng sử dụng một queue.

Khi chạy tuần tự, mọi thứ có thể hoạt động bình thường. Nhưng khi chạy song song, một test có thể xóa tài nguyên mà test khác đang sử dụng.

Việc chạy mỗi test suite trên một instance emulator riêng giúp giảm loại xung đột này.

Đây cũng là một cách để xây dựng môi trường kiểm thử có tính cô lập cao hơn.

### 8.5. Training và Onboarding

Với những developer mới tham gia dự án, việc làm quen với AWS đôi khi cần nhiều bước chuẩn bị.

AWS Emulator có thể giúp họ tiếp cận cách sử dụng AWS SDK và AWS API ngay trên máy cá nhân, mà không cần cấp quyền truy cập vào AWS account của tổ chức.

Đây cũng là một lựa chọn hữu ích cho các buổi workshop hoặc môi trường học tập.

## 9. AWS Emulator không thay thế AWS thật

Dù AWS Emulator hướng đến việc mô phỏng AWS API, không nên xem nó là một bản sao hoàn chỉnh của AWS Cloud.

Có một số giới hạn cần lưu ý.

### 9.1. Không phải API nào cũng được hỗ trợ đầy đủ

AWS có một hệ sinh thái service rất lớn. Mức độ hỗ trợ của emulator có thể khác nhau giữa từng service và từng operation.

Với API chưa được triển khai, emulator có thể trả về lỗi `501 Not Implemented`.

Do đó, cần kiểm tra Fidelity Report trước khi quyết định sử dụng cho một dự án cụ thể.

### 9.2. Không thay thế kiểm thử IAM và Security

Đây là giới hạn đặc biệt quan trọng.

AWS Emulator không đánh giá IAM Policy và Resource-based Policy giống như AWS thật.

Vì vậy, một request có thể được emulator chấp nhận nhưng lại bị AWS từ chối khi chạy trong môi trường thực tế.

Không nên sử dụng emulator để kiểm tra tính an toàn của cấu hình IAM, phân quyền hoặc các cơ chế bảo mật trên AWS.

### 9.3. Giới hạn về Account và Region

Theo giới hạn được AWS công bố tại thời điểm ra mắt, mỗi instance emulator hoạt động như một AWS account đơn lẻ.

Các hành vi liên quan đến cross-account và cross-Region chưa được hỗ trợ như trên AWS thật.

Nếu ứng dụng phụ thuộc vào những tính năng này, cần có bước kiểm thử bổ sung trên môi trường AWS.

### 9.4. Trạng thái tài nguyên không mặc định được lưu lâu dài

Tài nguyên trong emulator được lưu trong bộ nhớ.

Khi tiến trình dừng, trạng thái này không còn được duy trì.

Điều này phù hợp với nhiều tình huống kiểm thử, nhưng không phù hợp nếu mục tiêu là duy trì một môi trường local lâu dài mà không có cơ chế lưu trữ bổ sung.

### 9.5. Không phản ánh đầy đủ đặc tính vận hành của Cloud

Một emulator có thể giúp kiểm thử API và logic tích hợp, nhưng không thể đại diện đầy đủ cho môi trường AWS thực tế.

Một số vấn đề không thể được đánh giá chính xác chỉ bằng local emulator:

- Network latency giữa các service.
- IAM và các chính sách bảo mật thực tế.
- Throttling và service quota.
- Tính sẵn sàng và khả năng chịu lỗi của AWS.
- Hành vi khi xảy ra sự cố ở hạ tầng Cloud.
- Các giới hạn tài nguyên và hiệu năng của môi trường production.

Do đó, Integration Test trên local không thể thay thế hoàn toàn Staging Test hoặc Production-like Test.

### 9.6. Không sử dụng cho Production

AWS Emulator được thiết kế cho Development và Testing.

Những workload production vẫn cần chạy trên AWS thật hoặc môi trường triển khai phù hợp, nơi có đầy đủ các cơ chế vận hành, bảo mật, khả năng mở rộng và độ tin cậy cần thiết.

## 10. Một chiến lược kiểm thử kết hợp

Thay vì lựa chọn giữa Mocking, AWS Emulator và AWS thật, chúng ta có thể sử dụng cả ba ở những tầng kiểm thử khác nhau.

Một chiến lược kiểm thử có thể được chia thành ba tầng.

**Tầng 1 – Unit Test**

Sử dụng Mock để kiểm thử logic nghiệp vụ độc lập.

Ví dụ:

- Kiểm tra cách xử lý khi upload file thành công.
- Kiểm tra logic retry khi gửi message thất bại.
- Kiểm tra cách xử lý khi nhận lỗi từ AWS SDK.

Mục tiêu là kiểm tra logic của application, không phụ thuộc vào môi trường bên ngoài.

**Tầng 2 – Local Integration Test**

Sử dụng AWS Emulator hoặc LocalStack để kiểm tra khả năng tương tác với AWS API.

Ví dụ:

- Tạo S3 bucket và upload file.
- Gửi message vào SQS và nhận lại message.
- Tạo DynamoDB table và thực hiện thao tác đọc ghi.
- Kiểm tra các workflow kết hợp nhiều service.

Mục tiêu là kiểm tra integration giữa application và những API được emulator hỗ trợ.

**Tầng 3 – Cloud Integration Test**

Sử dụng AWS thật trong môi trường Development hoặc Staging.

Đây là nơi kiểm tra những vấn đề mà emulator không thể mô phỏng đầy đủ:

- IAM Policy.
- Resource-based Policy.
- Cross-account access.
- Cross-Region communication.
- Networking.
- Service quota.
- Hành vi thực tế của AWS.

Mục tiêu là xác minh ứng dụng hoạt động đúng trong môi trường gần với production.

Có thể hình dung chiến lược này như sau:

| Tầng kiểm thử | Công cụ | Mục tiêu |
| --- | --- | --- |
| Unit Test | JUnit, Mockito | Kiểm tra logic nghiệp vụ |
| Local Integration Test | AWS Emulator / LocalStack | Kiểm tra tương tác với AWS API |
| Cloud Integration Test | AWS Development / Staging | Kiểm tra hành vi thực tế trên Cloud |

Cách tiếp cận này giúp giảm số lượng test phải chạy trên AWS thật mà vẫn duy trì được mức độ tin cậy cần thiết.

## 11. Khi nào nên sử dụng AWS Emulator?

Không phải dự án nào sử dụng AWS cũng cần AWS Emulator.

Có thể cân nhắc sử dụng khi:

- Dự án tích hợp nhiều AWS Services và cần kiểm thử thường xuyên.
- Developer muốn phát triển local mà không phụ thuộc vào AWS account.
- Integration Test cần kiểm tra hành vi API thực tế hơn so với mock.
- CI/CD cần môi trường kiểm thử độc lập cho từng job.
- Chi phí và thời gian tạo tài nguyên Cloud cho mục đích kiểm thử là vấn đề cần tối ưu.
- Team muốn giảm sự phụ thuộc vào một AWS Development account dùng chung.

Ngược lại, nếu dự án chỉ sử dụng một vài AWS API đơn giản hoặc phần lớn test đã được xử lý tốt bằng mock, việc bổ sung emulator có thể chưa thực sự cần thiết.

Trước khi đưa vào dự án, nên đánh giá một số yếu tố:

1. Những AWS Services nào đang được sử dụng?
2. Các API quan trọng có được emulator hỗ trợ không?
3. Fidelity của những workflow đó đang ở mức nào?
4. Có cần persistence hoặc multi-account không?
5. Test có cần chạy song song trong CI/CD không?
6. Có những yêu cầu bảo mật nào bắt buộc phải kiểm tra trên AWS thật?

Quan trọng nhất là lựa chọn công cụ phù hợp với từng tầng kiểm thử, thay vì cố gắng đưa tất cả vào một giải pháp duy nhất.

## 12. Kết luận

AWS Emulator mang đến một hướng tiếp cận đáng chú ý cho quá trình phát triển ứng dụng sử dụng AWS.

Thay vì phải phụ thuộc hoàn toàn vào AWS Cloud để kiểm thử từng thay đổi, developer có thể đưa một phần môi trường AWS API về local và thực hiện các thao tác kiểm thử ngay trên máy cá nhân.

Điểm đáng giá không chỉ nằm ở việc tiết kiệm chi phí hay giảm thời gian triển khai, mà còn ở việc rút ngắn vòng lặp phát triển: viết code, kiểm thử, nhận phản hồi và sửa lỗi.

Điều thú vị là AWS Emulator không chỉ đơn thuần cung cấp một endpoint giả lập. AWS còn công bố cách đo lường Fidelity để developer có thể đánh giá mức độ tương thích giữa emulator và AWS thật.

So với LocalStack, AWS Emulator có hướng tiếp cận tập trung vào AWS API và Fidelity, trong khi LocalStack cung cấp một hệ sinh thái local cloud với nhiều tính năng phục vụ phát triển, kiểm thử và vận hành quy trình DevOps.

Mỗi công cụ có thế mạnh riêng và phù hợp với những nhu cầu khác nhau.

Tất nhiên, emulator không thể thay thế hoàn toàn AWS thật. Những vấn đề liên quan đến IAM, security, networking và hành vi thực tế của Cloud vẫn cần được kiểm chứng trên môi trường AWS.

Nhưng với Local Development và Integration Testing, AWS Emulator là một công cụ đáng để developer tìm hiểu và thử nghiệm.

**Tham khảo**

- [AWS Emulator – Official Product Page](https://aws.amazon.com/products/developer-tools/emulator/)
- [AWS Emulator – Official Documentation](https://docs.aws.amazon.com/emulator/)
- [AWS News Blog – Test your applications against AWS locally with AWS Emulator](https://aws.amazon.com/blogs/aws/test-your-applications-against-aws-locally-with-aws-emulator/)
- [AWS Emulator – GitHub Repository](https://github.com/aws/aws-emulator)
- [LocalStack – Official Documentation](https://docs.localstack.cloud/)
- [LocalStack – Pricing and Plans](https://www.localstack.cloud/pricing)
