---
title: "Consistency vs. Performance: Bài toán truy vấn ít được thiết kế đúng trong Microservices"
description: "Hãy tưởng tượng bạn đang phát triển một hệ thống thương mại điện tử. Khi người dùng mở trang chi tiết sản phẩm, backend cần lấy thông tin từ nhiều service:"
pubDatetime: 2026-10-24T13:49:37+07:00
modDatetime: null
category: "Microservices"
tags: ["Consistency", "microservices", "Performance", "systemdesign", "BackendDevelopment"]
lang: "vi"
featured: false
draft: false
readingTime: 24
coverImage: "../../assets/articles/consistency-vs-performance-bai-toan-truy-van-it-duoc-thiet-ke-dung-trong-microservices/cover.png"
series: null
sourceUrl: "https://viblo.asia/p/consistency-vs-performance-bai-toan-truy-van-it-duoc-thiet-ke-dung-trong-microservices-1j4lQ1WWJwl"
sourceReleasedAt: "2026-10-24T06:49:37.000000Z"
sourceUpdatedAt: "2026-11-05T09:18:02.000000Z"
sourceTags: ["Consistency", "microservices", "Performance", "systemdesign", "BackendDevelopment"]
---

## 1. Một API đơn giản, nhiều vấn đề phía sau

Hãy tưởng tượng bạn đang phát triển một hệ thống thương mại điện tử. Khi người dùng mở trang chi tiết sản phẩm, backend cần lấy thông tin từ nhiều service:

- **Product Service:** tên, mô tả, hình ảnh sản phẩm.
- **Inventory Service:** tình trạng hàng tồn kho.
- **Pricing Service:** giá bán và chương trình khuyến mãi.
- **Review Service:** điểm đánh giá và số lượng nhận xét.

Một API tổng hợp có thể gọi các service trên, sau đó ghép dữ liệu thành một response.

Ban đầu, hệ thống hoạt động khá tốt. Nhưng khi traffic tăng lên, team bắt đầu quan tâm đến latency, throughput và khả năng chịu tải. Trong quá trình tối ưu, một câu hỏi quan trọng thường bị bỏ qua: **Request này thực sự cần đọc dữ liệu mới nhất hay có thể chấp nhận dữ liệu chưa được cập nhật ngay?**

Hãy xét hai trường hợp.

Người dùng mở trang sản phẩm và nhìn thấy điểm đánh giá là 4,5 sao, dù một review vừa được tạo khiến điểm trung bình cần được tính lại. Nếu điểm đánh giá cập nhật chậm vài giây, trải nghiệm có thể vẫn chấp nhận được.

Ngược lại, người dùng vừa cập nhật địa chỉ giao hàng thành công nhưng request tiếp theo lại trả về địa chỉ cũ. Hoặc hệ thống sử dụng thông tin tồn kho chưa được cập nhật để quyết định giữ hàng. Trong những trường hợp này, dữ liệu chưa phản ánh trạng thái mới có thể ảnh hưởng trực tiếp đến nghiệp vụ.

Cả hai đều là vấn đề liên quan đến việc đọc dữ liệu, nhưng yêu cầu consistency hoàn toàn khác nhau.

Điều đó cho thấy vấn đề không đơn thuần là API gọi bao nhiêu service, mà là **mỗi truy vấn cần mức consistency nào và hệ thống phải trả giá bao nhiêu để đáp ứng yêu cầu đó**.

## 2. Consistency và Performance không đơn giản là hai thái cực

Khi tối ưu hiệu năng, chúng ta thường nghĩ đến những giải pháp quen thuộc:

- Thêm cache để giảm latency.
- Đọc từ replica để phân tải database.
- Xử lý bất đồng bộ để giảm phụ thuộc giữa các thành phần.
- Tạo read model riêng cho những truy vấn phức tạp hoặc có lượng đọc lớn.

Tất cả đều hữu ích, nhưng mỗi giải pháp có những đánh đổi riêng.

Cache có thể trả kết quả nhanh hơn, nhưng dữ liệu trong cache có thể chưa phản ánh những cập nhật gần đây. Read replica giúp phân tải đọc, nhưng có thể chưa nhận được dữ liệu mới từ primary. Read model được cập nhật qua event có thể phục vụ lượng lớn request, nhưng thông tin trong đó không nhất thiết được cập nhật ngay sau mỗi lần ghi ở service nguồn.

Điểm quan trọng là không phải cứ muốn hiệu năng cao thì phải chấp nhận dữ liệu cũ, hoặc cứ cần consistency thì phải sử dụng cách đọc chậm nhất.

Trước tiên, cần xác định loại consistency mà nghiệp vụ yêu cầu. Sau đó mới lựa chọn cơ chế đọc phù hợp.

Từ góc độ thiết kế API, có thể chia nhu cầu đọc thành hai nhóm.

### 2.1. Những truy vấn cần dữ liệu mới nhất theo yêu cầu nghiệp vụ (Consistency-critical queries)

Đây là những truy vấn mà việc đọc dữ liệu chưa cập nhật có thể khiến hệ thống đưa ra quyết định sai hoặc không đáp ứng được yêu cầu của nghiệp vụ.

Ví dụ:

- Đọc trạng thái giao dịch ngay sau khi cập nhật thành công.
- Kiểm tra trạng thái tài khoản trước một thao tác quan trọng.
- Đọc thông tin mà người dùng vừa thay đổi và cần nhìn thấy ngay.
- Kiểm tra điều kiện để thực hiện một chuyển đổi trạng thái quan trọng.

Với nhóm này, hệ thống cần lựa chọn cơ chế đọc bảo đảm mức consistency phù hợp.

Tuy nhiên, cần phân biệt việc đọc được dữ liệu mới nhất với việc bảo đảm nghiệp vụ đúng khi nhiều request xảy ra đồng thời. Một request có thể đọc đúng trạng thái tại thời điểm đọc, nhưng trạng thái đó vẫn có thể thay đổi trước khi request thực hiện thao tác ghi.

Vì vậy, nếu nghiệp vụ yêu cầu bảo vệ một điều kiện trong quá trình cập nhật, chỉ đọc dữ liệu mới nhất là chưa đủ. Hệ thống có thể cần conditional update, transaction, optimistic locking hoặc một cơ chế tương đương.

### 2.2. Những truy vấn có thể chấp nhận dữ liệu chưa cập nhật ngay (Staleness-tolerant queries)

Đây là những truy vấn mà việc chưa phản ánh một số cập nhật gần đây không làm sai kết quả nghiệp vụ.

Ví dụ:

- Điểm đánh giá và số lượng review trên trang sản phẩm.
- Thống kê lượt xem.
- Dashboard tổng hợp.
- Báo cáo phân tích không yêu cầu realtime.
- Danh sách sản phẩm được cá nhân hóa dựa trên hành vi gần đây.

Với nhóm này, hệ thống có thể chấp nhận dữ liệu chưa cập nhật ngay để tận dụng những cơ chế đọc có latency hoặc chi phí thấp hơn.

Chẳng hạn, thay vì tính lại điểm đánh giá từ toàn bộ review trên mỗi request, hệ thống có thể lưu sẵn kết quả tổng hợp và cập nhật khi có review mới. Nếu nghiệp vụ chấp nhận độ trễ vài giây, cách tiếp cận này có thể giảm đáng kể công việc phải thực hiện khi đọc.

Tuy nhiên, dữ liệu chậm cập nhật không có nghĩa là dữ liệu được phép sai tùy ý. Nếu nghiệp vụ yêu cầu dữ liệu phải được cập nhật trong vài giây, việc chậm đến vài phút vẫn là một vấn đề cần xử lý.

**Thời điểm dữ liệu cần được cập nhật phải xuất phát từ yêu cầu nghiệp vụ, không phải do backend tự quyết định để tiện tối ưu.**

## 3. Cái giá của việc luôn yêu cầu dữ liệu mới nhất

Quay lại API chi tiết sản phẩm. Khi người dùng mở trang, mỗi trường dữ liệu có thể có một yêu cầu consistency khác nhau.

Thông tin mô tả sản phẩm ít thay đổi có thể được cache. Điểm đánh giá có thể chấp nhận cập nhật chậm vài giây. Trong khi đó, thông tin giá hoặc tồn kho cần được xử lý theo yêu cầu cụ thể của nghiệp vụ.

Nếu mọi truy vấn đều yêu cầu đọc dữ liệu mới nhất từ nguồn có thẩm quyền, hệ thống có thể phải thực hiện nhiều thao tác đồng bộ hơn mức cần thiết.

Điều này có thể dẫn đến:

- Nhiều thao tác đọc phải truy cập nguồn dữ liệu chính.
- Tài nguyên database được sử dụng cho những dữ liệu có thể tái sử dụng kết quả.
- Các request phải chờ những thao tác đọc đồng bộ hoàn tất.
- Khả năng phân tải đọc bị hạn chế bởi yêu cầu consistency.
- Chi phí đọc tăng khi workload lớn.

Điều đó không có nghĩa đọc dữ liệu mới nhất luôn chậm hoặc mọi request đều nên tránh database chính. Tác động thực tế phụ thuộc vào database, workload, cơ chế consistency và cách triển khai.

Vấn đề là liệu request có thực sự cần mức consistency đó hay không.

Ví dụ, nếu mỗi lần mở trang sản phẩm, hệ thống đều tính lại điểm đánh giá từ hàng nghìn review, việc tối ưu index có thể giúp query nhanh hơn nhưng không loại bỏ công việc lặp lại.

Nếu điểm đánh giá chỉ cần cập nhật trong vài giây sau khi có review mới, hệ thống có thể tính toán lại khi dữ liệu thay đổi và lưu sẵn kết quả tổng hợp.

Ngược lại, nếu một request cần kiểm tra trạng thái giao dịch vừa được cập nhật, sử dụng dữ liệu cũ chỉ để giảm latency có thể không đáp ứng yêu cầu nghiệp vụ.

**Tối ưu hiệu năng không chỉ là làm cho một truy vấn chạy nhanh hơn, mà còn là xác định liệu truy vấn đó có cần thực hiện với mức consistency hiện tại hay không.**

## 4. Tách dữ liệu phục vụ hiển thị khỏi dữ liệu dùng để xử lý nghiệp vụ

Một hướng tiếp cận thực tế là không áp dụng cùng một yêu cầu consistency cho mọi nhu cầu đọc.

### 4.1. Với dữ liệu phục vụ hiển thị, có thể chấp nhận độ trễ cập nhật

Với những dữ liệu được đọc nhiều nhưng không cần cập nhật tức thời, chúng ta có thể sử dụng cache hoặc read model để phục vụ truy vấn.

Ví dụ, mỗi khi có review mới, Review Service phát ra event. Một consumer nhận event và cập nhật thông tin tổng hợp:

```json
{
  "productId": "P001",
  "averageRating": 4.6,
  "reviewCount": 1280
}
```

API hiển thị sản phẩm chỉ cần đọc kết quả tổng hợp này thay vì tính toán từ toàn bộ review mỗi lần có request.

Luồng xử lý có thể được tổ chức như sau:

```text
Review Service
      |
      | ReviewCreated event
      v
Message Broker
      |
      v
Consumer / Projection Builder
      |
      v
Review Summary Read Model
      |
      v
Product Detail API
```

Read model có thể nằm trong database được tối ưu cho truy vấn, cache hoặc OpenSearch, tùy theo nhu cầu.

Khi có review mới, điểm đánh giá hoặc số lượng review hiển thị có thể chưa thay đổi ngay lập tức. Nếu nghiệp vụ chấp nhận khoảng thời gian cập nhật đó, hệ thống đổi lại được khả năng đọc nhanh hơn và giảm công việc phải thực hiện trên mỗi request.

Đây là một ứng dụng của CQRS — tách mô hình đọc và mô hình ghi khi nhu cầu thực sự yêu cầu.

Tuy nhiên, không nên áp dụng CQRS chỉ vì hệ thống đang sử dụng Microservices. Nếu dữ liệu nhỏ, lượng truy cập thấp và truy vấn đơn giản, đọc trực tiếp từ database có thể dễ triển khai và vận hành hơn.

### 4.2. Với dữ liệu dùng để quyết định nghiệp vụ, phải bảo vệ tính đúng đắn

Bây giờ hãy xét bài toán tồn kho.

Một cách làm nguy hiểm là:

1. Đọc số lượng tồn kho từ cache.
2. Nếu thấy còn hàng, tạo đơn hàng.
3. Giảm số lượng tồn kho sau đó.

Giả sử chỉ còn một sản phẩm. Hai request đến gần như đồng thời và cùng đọc được giá trị `1` từ cache. Cả hai đều cho rằng có thể đặt hàng.

Ngay cả khi cả hai request đều đọc được dữ liệu mới nhất tại thời điểm đọc, race condition vẫn có thể xảy ra. Vấn đề không chỉ nằm ở việc dữ liệu đã được cập nhật hay chưa, mà còn ở khoảng thời gian giữa thao tác đọc và thao tác ghi.

Một giải pháp đơn giản trong database là cập nhật có điều kiện:

```sql
UPDATE inventory
SET available_quantity = available_quantity - 1
WHERE product_id = :productId
  AND available_quantity >= 1;
```

Sau đó kiểm tra số dòng được cập nhật:

- Một dòng được cập nhật: thao tác giữ hàng thành công.
- Không có dòng nào được cập nhật: điều kiện không được đáp ứng.

Khi database thực thi câu lệnh này một cách nguyên tử, hệ thống có thể ngăn hai request cùng giảm tồn kho vượt quá số lượng khả dụng.

Nếu thao tác cần cập nhật thêm nhiều bảng, hệ thống phải xác định transaction boundary phù hợp. Nếu Inventory thuộc một service riêng, việc giữ hàng có thể được triển khai thành nghiệp vụ reservation độc lập, kết hợp idempotency để xử lý retry và tránh giữ hàng trùng lặp.

Điểm mấu chốt là không nên nhầm lẫn giữa việc đọc dữ liệu mới nhất và việc bảo đảm một điều kiện vẫn đúng tại thời điểm cập nhật.

**Consistency của thao tác đọc và concurrency control ở thao tác ghi là hai vấn đề liên quan nhưng không thể thay thế cho nhau.**

## 5. Cache, Read Replica và Read Model: chọn đúng công cụ

Cache, read replica và read model đều có thể cải thiện hiệu năng đọc, nhưng chúng có đặc điểm khác nhau về cách cập nhật dữ liệu và mức consistency có thể đáp ứng.

| Giải pháp | Phù hợp khi | Đánh đổi chính |
|---|---|---|
| Cache | Dữ liệu được đọc nhiều và có thể tái sử dụng kết quả | Cache invalidation, TTL, cache miss |
| Read replica | Cần phân tải đọc khỏi primary database | Replication lag, read-after-write |
| Read model / CQRS | Có truy vấn phức tạp hoặc dữ liệu tổng hợp cần phục vụ nhanh | Độ trễ đồng bộ, vận hành projection |
| Conditional update / transaction | Cần bảo vệ quy tắc nghiệp vụ khi ghi | Lock contention, thời gian transaction |

Các kỹ thuật này không loại trừ lẫn nhau. Một hệ thống có thể sử dụng read model, đặt cache trước read model và vẫn dùng transaction ở đường xử lý ghi.

Ví dụ:

- Trang danh sách sản phẩm: cache hoặc read model nếu chấp nhận độ trễ.
- Dashboard: dữ liệu tổng hợp cập nhật định kỳ hoặc theo event.
- Tìm kiếm sản phẩm: OpenSearch phục vụ tìm kiếm và lọc.
- Giữ tồn kho: thao tác nguyên tử trên nguồn dữ liệu có thẩm quyền.
- Chi tiết giao dịch: sử dụng nguồn dữ liệu và cơ chế đọc đáp ứng yêu cầu nghiệp vụ.

Đặc biệt, cần cẩn thận với read replica.

Giả sử người dùng vừa cập nhật địa chỉ giao hàng thành công. Request tiếp theo đọc từ replica chưa nhận được thay đổi đó có thể trả về địa chỉ cũ.

Nếu API yêu cầu người dùng phải nhìn thấy ngay thông tin vừa cập nhật, hệ thống cần có chiến lược read-after-write phù hợp. Có thể định tuyến một số request sang primary, sử dụng version dữ liệu hoặc áp dụng cơ chế đọc có điều kiện, tùy vào database và yêu cầu của hệ thống.

Điều quan trọng là không nên chọn cache, replica hay read model chỉ vì chúng có thể cải thiện hiệu năng. Cần xác định trước dữ liệu được phép chậm cập nhật đến mức nào, sau đó mới lựa chọn công cụ phù hợp.

## 6. Eventual Consistency không có nghĩa là dữ liệu sẽ tự động đúng

Khi sử dụng event-driven architecture, một sai lầm thường gặp là cho rằng chỉ cần phát event qua Kafka thì read model sẽ tự động cập nhật đúng.

Trên thực tế, consumer có thể bị chậm, xử lý lỗi, nhận lại event hoặc cập nhật dữ liệu không theo thứ tự mong muốn.

Giả sử hệ thống nhận hai event cập nhật số lượt review:

```text
ReviewCountUpdated: 100
ReviewCountUpdated: 101
```

Nếu event cũ được xử lý sau event mới và consumer ghi đè trực tiếp giá trị, read model có thể quay ngược từ `101` về `100`.

Tùy mô hình dữ liệu, có thể giải quyết bằng version, sequence hoặc thiết kế phép cập nhật theo hướng idempotent. Timestamp đơn thuần không phải lúc nào cũng đủ để bảo đảm thứ tự chính xác.

Ngoài ra, consumer cần có cơ chế retry, xử lý event trùng lặp, theo dõi lag và phục hồi khi thất bại. Nếu read model bị thiếu hoặc sai dữ liệu, team cũng cần biết cách xây dựng lại nó từ nguồn dữ liệu có thẩm quyền hoặc event log còn được lưu giữ.

Giả sử hệ thống được thiết kế để cập nhật số lượt review trong vài giây, nhưng consumer bị chậm đến 10 phút. Đây không còn là một sai lệch nhỏ có thể bỏ qua; hệ thống đang không đáp ứng yêu cầu đã đặt ra.

Vì vậy, khi sử dụng eventual consistency, cần làm rõ:

- Dữ liệu cần được cập nhật trong khoảng thời gian bao lâu.
- Làm thế nào để phát hiện consumer bị chậm.
- Cách xử lý event trùng lặp và lỗi.
- Cách khôi phục hoặc xây dựng lại read model.
- API sẽ phản hồi thế nào nếu dữ liệu chưa được cập nhật như dự kiến.

**Eventual consistency không có nghĩa là chấp nhận dữ liệu sai. Nó có nghĩa là hệ thống cho phép dữ liệu được cập nhật sau dữ liệu nguồn, trong những giới hạn đã được xác định.**

## 7. Những câu hỏi cần trả lời trước khi thiết kế API đọc

Trước khi quyết định sử dụng cache, replica hay read model, hãy làm rõ một số câu hỏi.

### Dữ liệu này cần phản ánh cập nhật mới nhất đến mức nào?

Điểm đánh giá sản phẩm có thể chấp nhận cập nhật chậm vài giây. Nhưng với trạng thái giao dịch hoặc dữ liệu được sử dụng để đưa ra quyết định quan trọng, việc đọc một phiên bản cũ có thể không đáp ứng yêu cầu nghiệp vụ.

Không nên đặt cùng một yêu cầu consistency cho mọi dữ liệu chỉ vì chúng xuất hiện trong cùng một response.

### Người dùng có cần thấy ngay thay đổi vừa thực hiện không?

Nếu người dùng vừa cập nhật dữ liệu và đọc lại ngay, họ có cần thấy thay đổi đó tức thời không?

Nếu có, chiến lược đọc phải tính đến khả năng cache hoặc replica chưa được cập nhật. Nếu không, có thể tận dụng những cơ chế đọc giúp giảm chi phí và cải thiện hiệu năng.

### Kết quả truy vấn có được dùng để quyết định nghiệp vụ không?

Nếu kết quả chỉ phục vụ hiển thị, dữ liệu chưa cập nhật ngay có thể chấp nhận được.

Nếu kết quả quyết định việc thanh toán, giữ hàng hoặc chuyển trạng thái giao dịch, cần xác định consistency guarantee và cơ chế bảo vệ quy tắc nghiệp vụ phù hợp. Không nên chỉ dựa vào kết quả của một lần đọc rồi mặc định rằng trạng thái vẫn giữ nguyên khi request thực hiện thao tác ghi.

### Điều gì xảy ra khi một service không phản hồi?

Nếu Review Service không phản hồi, API có thể trả về thông tin sản phẩm cùng điểm đánh giá được lưu trước đó, nếu nghiệp vụ chấp nhận cách này.

Nhưng nếu hệ thống không thể xác nhận điều kiện bắt buộc của một giao dịch, nó có thể phải từ chối hoặc tạm thời chưa xử lý giao dịch đó.

Fallback phải được quyết định theo từng loại dữ liệu và nghiệp vụ, không nên áp dụng cùng một cách cho toàn bộ API.

### Làm sao biết hệ thống đang đáp ứng yêu cầu consistency?

Một số chỉ số hữu ích gồm:

- P95/P99 latency của API và các dependency.
- Cache hit ratio và cache miss.
- Thời gian từ lúc phát event đến khi read model được cập nhật.
- Consumer lag và số lượng event đang chờ xử lý.
- Tỷ lệ dữ liệu chưa cập nhật vượt quá giới hạn đã đặt ra.
- Tỷ lệ reservation thất bại do hết hàng hoặc cạnh tranh đồng thời.

Nếu không theo dõi những chỉ số này, team khó biết hệ thống có thực sự đáp ứng yêu cầu hay chỉ đơn giản là chưa gặp sự cố rõ ràng.

## Kết luận

Trong Microservices, tối ưu truy vấn không đơn thuần là giảm số lần gọi database hay giảm thời gian thực thi SQL.

Một thiết kế tốt bắt đầu từ việc hiểu dữ liệu được dùng để làm gì, request cần nhìn thấy những cập nhật nào và điều gì sẽ xảy ra nếu hệ thống sử dụng dữ liệu chưa được cập nhật đầy đủ.

Với dữ liệu phục vụ hiển thị hoặc phân tích, cache, read replica và read model có thể giúp cải thiện throughput và giảm chi phí đọc nếu nghiệp vụ chấp nhận độ trễ phù hợp.

Với những truy vấn cần phản ánh các cập nhật đã hoàn tất, hệ thống cần cơ chế đọc đáp ứng consistency guarantee tương ứng. Với những nghiệp vụ có cập nhật đồng thời, còn cần cơ chế bảo vệ tính đúng đắn ở tầng ghi.

**Đừng mặc định mọi request đều cần dữ liệu mới nhất. Hãy xác định mức consistency mà nghiệp vụ thực sự yêu cầu, rồi lựa chọn chiến lược đọc để cân bằng giữa tính đúng đắn, hiệu năng và chi phí.**

### Tài liệu tham khảo

1. [Microsoft Learn — Data considerations for microservices](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations)
2. [Microsoft Learn — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
3. [AWS Prescriptive Guidance — CQRS pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/cqrs-pattern.html)
4. [microservices.io — CQRS](https://microservices.io/patterns/data/cqrs.html)
