---
title: "AI va ky thuat phan mem: Thich nghi de khong tut lai"
description: "Goc nhin thuc te ve cach AI thay doi cong viec phat trien phan mem, nhung ky nang ky thuat van can thiet, va cach dung AI ma khong tu bo phan doan ky thuat."
pubDatetime: 2025-06-08T23:38:00+07:00
featured: false
draft: false
tags:
  - career
  - ai
---

AI dang thay doi cach phan mem duoc tao ra. AI co the sinh code nhanh, giai thich cu phap chua quen, va ho tro cac cong viec lap lai. Lo ngai ve viec lam vi the la co co so: phan viec nao cua developer se thay doi, va ky nang nao van tiep tuc quan trong?

Phan kho khong phai la tao ra mot doan code. Phan kho la quyet dinh nen xay gi, kiem tra no co dung khong, va tich hop no an toan vao san pham that. Bai viet nay tap trung vao ranh gioi do: ky thuat phan mem rong hon viec go code, va AI chi phat huy tot khi ky su van chiu trach nhiem cho cac quyet dinh.

## 1. Ky su phan mem lam nhieu hon viec go code

**[SOURCE FACT]** Cac cong cu AI co the sinh code tu mo ta, thuong nhanh hon viec mot nguoi tu viet cung mot phan code lap lai.

**[ANALYSIS]** Kha nang nay tac dong den cong viec implement, nhung khong loai bo nhu cau xac dinh dung bai toan. Ky su phan mem phai hieu nguoi dung, rang buoc, du lieu, failure mode (cac kich ban loi), va moi truong van hanh truoc khi chon cach implement.

Khac biet nay the hien rat ro:

- Yeu cau thuan ve code la: "Dua cho toi specification, toi se implement."
- Cau hoi ky thuat la: "Ai can tinh nang nay? Uu tien nao dung? Data flow co hop ly khong? API co yeu cau gi ve bao mat va kha nang scale?"

Neu vai tro chi con la chuyen specification day du thanh code, AI co the tu dong hoa mot phan vai tro do. Ky nang ben vung khong phai la go code nhanh hon, ma la dua ra va xac minh cac quyet dinh ky thuat hop ly.

## 2. Sinh code nhanh khong thay the phan doan ky thuat

**[SOURCE FACT]** AI co the nhanh chong sinh mot API controller hoac mot thanh phan code tuong tu.

**[ANALYSIS]** Doan code duoc sinh ra van phu thuoc vao cac quyet dinh ky su phai dua ra. Vi du:

- API contract va resource model nao la phu hop?
- Quy tac authentication va authorization nao ap dung? Co that su can bypass khong?
- Moi client can du lieu gi, va du lieu nao nen giu noi bo?
- Se xu ly error, timeout, retry, idempotency, va observability (kha nang quan sat he thong) nhu the nao?

AI co the de xuat cach implement, nhung AI khong so huu product requirement va cung khong chiu hau qua neu quyet dinh sai. Ky su phai dinh huong cong cu, review output, va test ket qua tren he thong thuc te.

## 3. Hoc sau va hoc rong

Biet mot ngon ngu lap trinh la huu ich, nhung chua du de van hanh mot production system. Developer cung can du breadth (do rong) de lam viec qua toan bo qua trinh delivery, va du depth (chieu sau) de nhan ra khi code sinh ra khong an toan hoac khong dung.

**[ANALYSIS]** Breadth giup giao tiep voi cac nhom lien quan:

- Voi Product, lam ro van de cua nguoi dung va muc uu tien thay vi implement moi endpoint duoc de xuat.
- Voi UX, tinh den interaction flow thuc te va responsive behavior, khong chi dua vao desktop mockup.
- Voi DevOps, hieu deployment, configuration, monitoring, va incident response.
- Voi Data, hieu dependency cua data pipeline, chat luong du lieu, va y nghia cua du lieu dang duoc su dung.

**[ANALYSIS]** Depth cho phep ky su phan bien de xuat cua AI. Code sinh ra co the chua gia dinh sai, loi bao mat, cach xu ly du lieu khong hop le, hoac dac tinh hieu nang khong phu hop. Developer khong the giai thich code thi cung khong the review no mot cach dang tin cay.

## 4. Dung AI de hoc, khong phai de dung hoc

**[PROPOSED DESIGN]** Hay xem AI la assistant trong quy trinh hoc tap va delivery:

- Nho AI giai thich YAML, Dockerfile, shell script, hoac convention chua quen cua framework.
- Yeu cau AI dua ra cac cach implement khac nhau va trade-off giua chung.
- Dung AI de draft test, sau do kiem tra cac truong hop bi bo sot.
- Dua mot loi hoac configuration cho AI review, nhung tu minh xac minh chan doan.

Cach nay mo rong pham vi lam viec cua developer. Mot backend engineer co the dung AI de hieu CI/CD, ETL trong data pipeline, hoac cac van de UX va UI co ban ma khong can tu nhan minh la chuyen gia cua moi linh vuc.

Dieu quan trong la phan biet acceleration (tang toc) va delegation of responsibility (uy thac trach nhiem). AI co the rut ngan duong den mot loi giai thich hoac ban draft dau tien. Ky su van chiu trach nhiem hoc cac khai niem nen tang va quyet dinh ket qua co nen duoc dua vao san pham hay khong.

## 5. Rui ro nghe nghiep den tu tri tre, khong phai tu mot cong cu

**[ANALYSIS]** AI khong phai yeu to duy nhat quyet dinh gia tri cua mot developer. Hieu boi canh san pham, system design, debugging, giao tiep, va phan doan khi van hanh deu anh huong den chat luong cong viec.

Tu choi hoc cac cong cu phu hop co the lam giam hieu qua khi team xung quanh da ap dung chung. Nguoc lai, dung AI ma khong hieu output tao ra mot rui ro khac: sinh loi nhanh hon va lam he thong kho debug hon.

Phan ung thuc te la hoc nhung cong cu giup cai thien cong viec, dong thoi cung co cac ky nang ma cong cu khong the tu minh cung cap mot cach an toan: dat van de, phan tich trade-off, xac minh, va chiu trach nhiem.

## 6. Kha nang thich nghi la mot ky nang ky thuat

Hay tu hoi:

- Toi dang dung AI de tang toc mot task da hieu ro, hay dang tranh viec phai hieu task do?
- Toi co hoc vuot ra ngoai technology stack quen thuoc khong?
- Toi co hieu ai dang dung san pham va san pham can tao ra ket qua gi khong?
- Toi co the review, test, van hanh, va giai thich phan code AI da ho tro tao ra khong?

Neu cau tra loi la co, AI la cong cu tang productivity va ho tro hoc tap. Neu khong, van de khong phai la AI da khien developer tro nen loi thoi. Van de la cach lam viec hien tai khong con theo kip yeu cau cua cong viec.

## Ket luan: Giu phan doan, su dung cong cu

Ky su phan mem thiet ke giai phap, tich hop he thong, va ket noi cac lua chon ky thuat voi nhu cau nguoi dung cung nhu san pham. Sinh code chi la mot phan cua cong viec do.

Trong quy trinh co AI ho tro:

- Hoc du sau de nhan ra code sinh ra bi sai, khong an toan, hoac khong phu hop.
- Hoc du rong de lam viec voi Product, UX, DevOps, va Data.
- Dung AI cho ban draft, giai thich, test, va exploration (kham pha), khong thay cho ownership (trach nhiem so huu ket qua).
- Xac minh behavior bang review, test, va boi canh van hanh cua he thong.

AI thay doi quy trinh implement. AI khong loai bo nhu cau doi voi ky su co the xac dinh dung bai toan, can nhac trade-off, va chiu trach nhiem cho ket qua.
