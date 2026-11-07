import type { Locale } from "@/i18n/config";

/**
 * Interface copy. Article text lives in the content collection; everything the
 * chrome says lives here so both locales stay in step.
 */
const en = {
  "site.tagline": "A personal engineering journal",
  "site.description":
    "Notes on backend engineering, system design, distributed systems, infrastructure, and the craft of building software.",

  "nav.journal": "Journal",
  "nav.topics": "Topics",
  "nav.projects": "Projects",
  "nav.homelab": "Homelab",
  "nav.about": "About",
  "nav.collection": "Engineering Collection",
  "nav.switchLanguage": "Language",
  "nav.switchTo": "Switch to {language}",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",
  "nav.main": "Primary",
  "nav.mobile": "Mobile",
  "nav.footer": "Footer",

  "common.skip": "Skip to content",
  "common.search": "Search",
  "common.searchArticles": "Search articles",
  "common.all": "all",
  "common.latest": "Latest",
  "common.topics": "Topics",
  "common.tags": "Tags",
  "common.posts": "posts",
  "common.articles": "articles",
  "common.backToTop": "top",
  "common.top": "top",
  "common.theme": "Theme",
  "common.changeTheme": "Change colour theme",
  "common.dark": "dark",
  "common.light": "light",
  "common.readingTime": "{minutes} min read",
  "common.untitled": "Untitled",

  "home.eyebrow": "Software engineer · Vietnam",
  "home.greeting": "Hi, I'm {name}",
  "home.intro":
    "a software engineer passionate about backend engineering, system design, distributed systems, infrastructure, security, and emerging technologies.",
  "home.bio":
    "This is where I write down what I learn while building systems: the trade-offs, the failure modes, and the parts that only show up in production.",
  "home.cta.journal": "Read the journal",
  "home.cta.about": "About me",
  "home.cta.github": "GitHub",
  "home.writingSince": "writing since {date}",
  "home.stats.essays": "essays",
  "home.stats.topics": "topics",
  "home.stats.tags": "tags",
  "home.stats.reading": "of reading",
  "home.featured.label": "Featured",
  "home.featured.title": "Worth starting with",
  "home.latest.label": "Latest",
  "home.latest.title": "Fresh from the journal",
  "home.latest.link": "browse all",
  "home.topics.label": "Topics",
  "home.topics.title": "Follow a thread",
  "home.topics.link": "all topics",
  "home.projects.label": "Projects",
  "home.projects.title": "Things I build",
  "home.projects.link": "all projects",
  "home.homelab.label": "Homelab",
  "home.homelab.title": "The lab at the end of the tunnel",
  "home.homelab.link": "open the lab",
  "home.homelab.body":
    "A single Ubuntu box where I self-host services, break things on purpose and keep a record of what actually survives contact with production habits: containers, a reverse proxy, monitoring, backups and the security work that holds it together.",
  "home.homelab.cta": "Lab notes",
  "home.homelab.buildLog": "Read the build log",

  "posts.title": "The journal",
  "posts.lede": "Essays on engineering, systems, and technology.",
  "posts.search": "Search articles",
  "posts.filterTopic": "Topic",
  "posts.filterTag": "Tag",
  "posts.latestCount": "latest {count}",
  "posts.pageOf": "page {current} of {total}",
  "posts.total": "{count} total",
  "posts.startHere": "Start here",
  "posts.allTags": "all tags",
  "posts.empty": "No articles here yet.",

  "article.toc": "On this page",
  "article.share": "Share",
  "article.copyLink": "Copy link",
  "article.copied": "Copied",
  "article.lineNumbers": "line numbers",
  "article.hideNumbers": "hide numbers",
  "article.tags": "Tags",
  "article.related": "Related notes",
  "article.keepReading": "Keep reading",
  "article.older": "Older",
  "article.newer": "Newer",
  "article.moreArticles": "More articles",
  "article.backToBlog": "Back to the journal",
  "article.translationNote": "Also available in {language}",

  "categories.title": "Topics",
  "categories.lede":
    "Every article is filed under the topic it is actually about. Counts are live — they come from the published collection.",
  "categories.count": "{count} articles",
  "categories.latest": "latest · {date}",
  "categories.allTags": "Browse all {count} tags",
  "categories.empty": "No articles in this topic yet.",

  "tags.title": "Tags",
  "tags.lede":
    "Tags are short labels I attach while writing. Size reflects how often a tag recurs across the journal.",
  "tags.neighbours": "Neighbours",
  "tags.browseTopics": "Browse by topic instead",
  "tags.allArticles": "All articles",
  "tags.empty": "No articles with this tag yet.",

  "archives.title": "Archive",
  "archives.lede": "{count} entries across {years} years — the whole journal, in reverse order.",

  "about.title": "About",
  "about.headingLead": "I'm {name}",
  "about.headingAccent": "backend-strong, systems-minded.",
  "about.role":
    "Fullstack software engineer, backend-strong (Java deepest). I make distributed systems behave — Spring Boot, Kafka, Redis, and frontend when it is needed.",
  "about.body1": "I'm {intro} This site is where I keep those notes: {bio}",
  "about.body2":
    "The journal currently holds {count} articles across {topics} topics, the first published {since} and the latest {latest}.",
  "about.approach": "How I write",
  "about.paths": "Reading paths",
  "about.elsewhere": "Elsewhere",
  "about.feed": "Subscribe to the feed",

  "projects.title": "Projects",
  "projects.heading": "Software I actually run, not a portfolio of mockups.",
  "projects.lede":
    "Every card below is a real public repository. Names, descriptions, languages and topics come from the repository metadata rather than being written for the page.",
  "projects.profile": "GitHub profile",
  "projects.profileNote": "{count} public repositories at the time of writing",
  "projects.primary": "Primary",
  "projects.alsoMaintained": "Also maintained",
  "projects.forkNote":
    "Forks of upstream projects are deliberately left off this page so the showcase only lists original work.",

  "homelab.title": "Homelab",
  "homelab.heading": "A small VPS lab, documented honestly.",
  "homelab.lede":
    "This page documents the Ubuntu VPS I use to self-host services and explore infrastructure. It is a working document: anything not yet verified is explicitly marked as a placeholder rather than invented to look complete.",
  "homelab.arch": "Architecture",
  "homelab.pending": "diagram pending",
  "homelab.buildLog": "Read the build log",
  "homelab.openArticle": "Open article",
  "homelab.note":
    "Nothing on this page is a template for your own lab — but the build log is written so it can be copied.",

  "collection.title": "Engineering Collection",
  "collection.lede":
    "A curated shelf of engineering writing from teams that run what they build. Nothing is republished here — every entry links to the original.",
  "collection.shelves": "Shelves",
  "collection.about.title": "How this shelf works",
  "collection.about.body":
    "Every entry is read before it is listed. Titles, dates and links point at the original publication; the summary and the note are editorial, and kept short on purpose.",
  "collection.soon": "Soon",
  "collection.open": "Open",

  "collection.blogs.eyebrow": "Blogs",
  "collection.blogs.title": "Engineering Blogs",
  "collection.blogs.subtitle":
    "Curated engineering insights, architecture decisions, and real-world lessons from teams building systems at scale.",
  "collection.stats.articles": "Articles",
  "collection.stats.companies": "Companies",
  "collection.stats.topics": "Topics",
  "collection.featured.label": "Featured",
  "collection.featured.title": "Start with these",
  "collection.browse.title": "All articles",
  "collection.search.label": "Search the collection",
  "collection.search.placeholder": "Session revocations, retry storms, Vitess…",
  "collection.filter.company": "Company",
  "collection.filter.topic": "Topic",
  "collection.filter.allCompanies": "All companies",
  "collection.filter.allTopics": "All topics",
  "collection.sort.label": "Sort",
  "collection.sort.newest": "Newest",
  "collection.sort.oldest": "Oldest",
  "collection.sort.featured": "Featured",
  "collection.results": "{count} articles",
  "collection.resultsOne": "1 article",
  "collection.reset": "Reset",
  "collection.empty.title": "Nothing matches those filters",
  "collection.empty.body":
    "Try a broader search, or reset the filters to see the whole collection.",
  "collection.empty.collection": "The collection is being assembled. Check back shortly.",
  "collection.error": "Filtering failed to start, so the full list is shown below.",
  "collection.noscript": "Search and filters need JavaScript. Every article is still listed below.",

  "collection.detail.why": "Why it's worth reading",
  "collection.detail.takeaways": "Key takeaways",
  "collection.detail.readOriginal": "Read Original Article",
  "collection.detail.sourceNote": "Opens on {domain}. The full article stays with its publisher.",
  "collection.detail.back": "All engineering blogs",
  "collection.detail.related": "Related reading",
  "collection.detail.details": "Details",
  "collection.detail.topics": "Topics",
  "collection.detail.published": "Published",
  "collection.detail.company": "Company",
  "collection.detail.original": "Original",
  "collection.detail.readingTime": "Reading time",

  "search.title": "Search",
  "search.heading": "Find the note you half remember.",
  "search.lede":
    "Full-text search runs against a static index built at deploy time — no server, and the query never leaves your browser.",
  "search.placeholder": "kafka, saga, virtual threads, zero trust…",
  "search.hint": "Type at least two characters. Results are ranked by relevance.",
  "search.scope": "Search in",
  "search.scopeCurrent": "This language",
  "search.scopeAll": "All languages",
  "search.results": "{count} results for “{query}”",
  "search.one": "1 result for “{query}”",
  "search.none": "Nothing matched. Try a broader term.",
  "search.short": "Type at least two characters.",
  "search.indexMissing":
    "The search index is produced by a production build. Run `pnpm build` to search locally.",
  "search.jump": "Or jump to a topic",

  "footer.blurb":
    "A personal engineering journal by {name} — {count} essays on backend systems, the JVM, infrastructure and the occasional production incident.",
  "footer.journal": "Journal",
  "footer.elsewhere": "Elsewhere",
  "footer.archive": "Archive",
  "footer.rss": "rss",
  "footer.source": "source",
  "footer.rights": "© {year} {name}. Words are mine; code is MIT.",
  "footer.counts": "{topics} topics · {posts} posts",

  "notfound.code": "Error 404",
  "notfound.heading": "Dead link. Wrong terminal.",
  "notfound.body":
    "The URL you followed does not exist. The journal, the topic index and full-text search are all still here.",
  "notfound.back": "Back to the journal",
  "notfound.topics": "Browse topics",
  "notfound.search": "Search instead",
} as const;

export type UIKey = keyof typeof en;

const vi: Record<UIKey, string> = {
  "site.tagline": "Nhật ký kỹ thuật cá nhân",
  "site.description":
    "Ghi chép về backend engineering, thiết kế hệ thống, hệ thống phân tán, hạ tầng và hành trình xây dựng phần mềm.",

  "nav.journal": "Bài viết",
  "nav.topics": "Chủ đề",
  "nav.projects": "Dự án",
  "nav.homelab": "Homelab",
  "nav.about": "Giới thiệu",
  "nav.collection": "Tuyển tập kỹ thuật",
  "nav.switchLanguage": "Ngôn ngữ",
  "nav.switchTo": "Chuyển sang {language}",
  "nav.openMenu": "Mở menu",
  "nav.closeMenu": "Đóng menu",
  "nav.main": "Chính",
  "nav.mobile": "Di động",
  "nav.footer": "Chân trang",

  "common.skip": "Tới nội dung chính",
  "common.search": "Tìm kiếm",
  "common.searchArticles": "Tìm bài viết",
  "common.all": "tất cả",
  "common.latest": "Mới nhất",
  "common.topics": "Chủ đề",
  "common.tags": "Thẻ",
  "common.posts": "bài",
  "common.articles": "bài viết",
  "common.backToTop": "lên đầu",
  "common.top": "lên đầu",
  "common.theme": "Giao diện",
  "common.changeTheme": "Đổi giao diện màu",
  "common.dark": "tối",
  "common.light": "sáng",
  "common.readingTime": "{minutes} phút đọc",
  "common.untitled": "Chưa có tiêu đề",

  "home.eyebrow": "Kỹ sư phần mềm · Việt Nam",
  "home.greeting": "Xin chào, mình là {name}",
  "home.intro":
    "một kỹ sư phần mềm đam mê backend engineering, thiết kế hệ thống, hệ thống phân tán, hạ tầng, bảo mật và các công nghệ mới.",
  "home.bio":
    "Đây là nơi mình ghi lại những điều học được khi xây dựng hệ thống: các đánh đổi, những kiểu lỗi, và những thứ chỉ lộ ra khi lên production.",
  "home.cta.journal": "Đọc bài viết",
  "home.cta.about": "Về mình",
  "home.cta.github": "GitHub",
  "home.writingSince": "viết từ {date}",
  "home.stats.essays": "bài viết",
  "home.stats.topics": "chủ đề",
  "home.stats.tags": "thẻ",
  "home.stats.reading": "thời gian đọc",
  "home.featured.label": "Nổi bật",
  "home.featured.title": "Bắt đầu từ đây",
  "home.latest.label": "Mới nhất",
  "home.latest.title": "Vừa viết xong",
  "home.latest.link": "xem tất cả",
  "home.topics.label": "Chủ đề",
  "home.topics.title": "Đi theo một mạch",
  "home.topics.link": "tất cả chủ đề",
  "home.projects.label": "Dự án",
  "home.projects.title": "Những thứ mình xây",
  "home.projects.link": "tất cả dự án",
  "home.homelab.label": "Homelab",
  "home.homelab.title": "Cái lab ở cuối đường hầm",
  "home.homelab.link": "mở homelab",
  "home.homelab.body":
    "Một chiếc VPS Ubuntu, nơi mình tự host dịch vụ, cố tình làm hỏng mọi thứ và ghi lại những gì thực sự trụ được: container, reverse proxy, monitoring, backup và phần bảo mật giữ chúng đứng vững.",
  "home.homelab.cta": "Ghi chép homelab",
  "home.homelab.buildLog": "Đọc bài dựng lab",

  "posts.title": "Bài viết",
  "posts.lede": "Những ghi chép về kỹ thuật phần mềm, hệ thống và công nghệ.",
  "posts.search": "Tìm kiếm bài viết",
  "posts.filterTopic": "Chủ đề",
  "posts.filterTag": "Thẻ",
  "posts.latestCount": "{count} bài mới nhất",
  "posts.pageOf": "trang {current}/{total}",
  "posts.total": "tổng {count} bài",
  "posts.startHere": "Bắt đầu từ đây",
  "posts.allTags": "tất cả thẻ",
  "posts.empty": "Chưa có bài viết nào.",

  "article.toc": "Trong bài này",
  "article.share": "Chia sẻ",
  "article.copyLink": "Chép liên kết",
  "article.copied": "Đã chép",
  "article.lineNumbers": "số dòng",
  "article.hideNumbers": "ẩn số dòng",
  "article.tags": "Thẻ",
  "article.related": "Đọc tiếp",
  "article.keepReading": "Cùng chủ đề",
  "article.older": "Cũ hơn",
  "article.newer": "Mới hơn",
  "article.moreArticles": "Các bài khác",
  "article.backToBlog": "Về trang bài viết",
  "article.translationNote": "Cũng có bản {language}",

  "categories.title": "Chủ đề",
  "categories.lede":
    "Mỗi bài được xếp vào đúng chủ đề chính của nó. Số lượng là số thật, lấy từ tập bài viết đã xuất bản.",
  "categories.count": "{count} bài viết",
  "categories.latest": "mới nhất · {date}",
  "categories.allTags": "Xem tất cả {count} thẻ",
  "categories.empty": "Chủ đề này chưa có bài nào.",

  "tags.title": "Thẻ",
  "tags.lede":
    "Thẻ là những nhãn ngắn mình gắn khi viết. Cỡ chữ thể hiện tần suất xuất hiện của thẻ trong toàn bộ bài viết.",
  "tags.neighbours": "Thẻ lân cận",
  "tags.browseTopics": "Xem theo chủ đề",
  "tags.allArticles": "Tất cả bài viết",
  "tags.empty": "Chưa có bài nào với thẻ này.",

  "archives.title": "Lưu trữ",
  "archives.lede": "{count} bài trong {years} năm — toàn bộ bài viết, theo thứ tự ngược.",

  "about.title": "Giới thiệu",
  "about.headingLead": "Mình là {name}",
  "about.headingAccent": "mạnh về backend, tư duy hệ thống.",
  "about.role":
    "Kỹ sư phần mềm fullstack, mạnh nhất ở backend (Java là sâu nhất). Mình làm cho các hệ thống phân tán chạy đúng — Spring Boot, Kafka, Redis, và frontend khi cần.",
  "about.body1": "Mình là {intro} Đây là nơi mình giữ những ghi chép đó: {bio}",
  "about.body2":
    "Hiện tại có {count} bài viết trong {topics} chủ đề, bài đầu tiên {since} và bài mới nhất {latest}.",
  "about.approach": "Mình viết thế nào",
  "about.paths": "Lối đọc",
  "about.elsewhere": "Ở nơi khác",
  "about.feed": "Theo dõi bằng RSS",

  "projects.title": "Dự án",
  "projects.heading": "Phần mềm mình thực sự chạy, không phải portfolio mockup.",
  "projects.lede":
    "Mỗi thẻ bên dưới là một repository công khai có thật. Tên, mô tả, ngôn ngữ và chủ đề lấy từ metadata của repository, không phải viết riêng cho trang này.",
  "projects.profile": "Trang GitHub",
  "projects.profileNote": "{count} repository công khai tại thời điểm viết",
  "projects.primary": "Chính",
  "projects.alsoMaintained": "Cũng đang duy trì",
  "projects.forkNote":
    "Các bản fork của dự án khác được cố ý bỏ khỏi trang này để danh sách chỉ gồm sản phẩm do mình làm.",

  "homelab.title": "Homelab",
  "homelab.heading": "Một homelab nhỏ trên VPS, ghi chép thật thà.",
  "homelab.lede":
    "Trang này ghi lại chiếc VPS Ubuntu mình dùng để self-host dịch vụ và thử nghiệm hạ tầng. Đây là tài liệu đang viết: phần nào chưa kiểm chứng sẽ được đánh dấu rõ là placeholder, không bịa cho đầy đủ.",
  "homelab.arch": "Kiến trúc",
  "homelab.pending": "đang chờ sơ đồ",
  "homelab.buildLog": "Đọc bài dựng lab",
  "homelab.openArticle": "Mở bài viết",
  "homelab.note":
    "Không có gì trên trang này là template cho lab của bạn — nhưng bài dựng lab được viết để có thể làm theo.",

  "collection.title": "Tuyển tập kỹ thuật",
  "collection.lede":
    "Một kệ bài viết kỹ thuật được chọn lọc từ những team tự vận hành hệ thống mình xây. Không đăng lại bài nào — mỗi mục đều dẫn về nguồn gốc.",
  "collection.shelves": "Các kệ",
  "collection.about.title": "Kệ này hoạt động thế nào",
  "collection.about.body":
    "Mỗi mục đều được đọc trước khi đưa vào. Tiêu đề, ngày và liên kết trỏ về bài gốc; phần tóm tắt và ghi chú là của biên tập, và được giữ ngắn có chủ đích.",
  "collection.soon": "Sắp có",
  "collection.open": "Mở",

  "collection.blogs.eyebrow": "Blog",
  "collection.blogs.title": "Blog kỹ thuật",
  "collection.blogs.subtitle":
    "Góc nhìn kỹ thuật, quyết định kiến trúc và bài học thực tế từ những team đang xây hệ thống ở quy mô lớn.",
  "collection.stats.articles": "Bài viết",
  "collection.stats.companies": "Công ty",
  "collection.stats.topics": "Chủ đề",
  "collection.featured.label": "Nổi bật",
  "collection.featured.title": "Bắt đầu từ đây",
  "collection.browse.title": "Tất cả bài viết",
  "collection.search.label": "Tìm trong tuyển tập",
  "collection.search.placeholder": "session revocation, retry storm, Vitess…",
  "collection.filter.company": "Công ty",
  "collection.filter.topic": "Chủ đề",
  "collection.filter.allCompanies": "Tất cả công ty",
  "collection.filter.allTopics": "Tất cả chủ đề",
  "collection.sort.label": "Sắp xếp",
  "collection.sort.newest": "Mới nhất",
  "collection.sort.oldest": "Cũ nhất",
  "collection.sort.featured": "Nổi bật",
  "collection.results": "{count} bài viết",
  "collection.resultsOne": "1 bài viết",
  "collection.reset": "Đặt lại",
  "collection.empty.title": "Không có bài nào khớp",
  "collection.empty.body": "Thử từ khoá rộng hơn, hoặc đặt lại bộ lọc để xem toàn bộ tuyển tập.",
  "collection.empty.collection": "Tuyển tập đang được hoàn thiện. Quay lại sau nhé.",
  "collection.error": "Bộ lọc không khởi động được, danh sách đầy đủ vẫn hiển thị bên dưới.",
  "collection.noscript":
    "Tìm kiếm và bộ lọc cần JavaScript. Toàn bộ bài viết vẫn được liệt kê bên dưới.",

  "collection.detail.why": "Vì sao đáng đọc",
  "collection.detail.takeaways": "Điểm chính",
  "collection.detail.readOriginal": "Đọc bài gốc",
  "collection.detail.sourceNote": "Mở trên {domain}. Toàn văn bài viết thuộc về nhà xuất bản.",
  "collection.detail.back": "Tất cả blog kỹ thuật",
  "collection.detail.related": "Đọc thêm",
  "collection.detail.details": "Thông tin",
  "collection.detail.topics": "Chủ đề",
  "collection.detail.published": "Xuất bản",
  "collection.detail.company": "Công ty",
  "collection.detail.original": "Bài gốc",
  "collection.detail.readingTime": "Thời gian đọc",

  "search.title": "Tìm kiếm",
  "search.heading": "Tìm lại bài bạn nhớ mang máng.",
  "search.lede":
    "Tìm kiếm toàn văn chạy trên index tĩnh được tạo lúc build — không có server, và câu truy vấn không rời khỏi trình duyệt của bạn.",
  "search.placeholder": "kafka, saga, virtual threads, zero trust…",
  "search.hint": "Nhập ít nhất hai ký tự. Kết quả xếp theo độ liên quan.",
  "search.scope": "Tìm trong",
  "search.scopeCurrent": "Ngôn ngữ này",
  "search.scopeAll": "Tất cả ngôn ngữ",
  "search.results": "{count} kết quả cho “{query}”",
  "search.one": "1 kết quả cho “{query}”",
  "search.none": "Không có kết quả. Thử từ khóa rộng hơn.",
  "search.short": "Nhập ít nhất hai ký tự.",
  "search.indexMissing":
    "Index tìm kiếm chỉ được tạo khi build production. Chạy `pnpm build` để tìm kiếm ở máy.",
  "search.jump": "Hoặc nhảy tới một chủ đề",

  "footer.blurb":
    "Nhật ký kỹ thuật cá nhân của {name} — {count} bài về hệ thống backend, JVM, hạ tầng và thỉnh thoảng là một sự cố production.",
  "footer.journal": "Bài viết",
  "footer.elsewhere": "Ở nơi khác",
  "footer.archive": "Lưu trữ",
  "footer.rss": "rss",
  "footer.source": "mã nguồn",
  "footer.rights": "© {year} {name}. Chữ là của mình; code theo giấy phép MIT.",
  "footer.counts": "{topics} chủ đề · {posts} bài",

  "notfound.code": "Lỗi 404",
  "notfound.heading": "Link chết. Sai cửa.",
  "notfound.body":
    "Đường dẫn bạn theo không tồn tại. Danh sách bài viết, mục lục chủ đề và tìm kiếm toàn văn vẫn ở đây.",
  "notfound.back": "Về trang bài viết",
  "notfound.topics": "Xem chủ đề",
  "notfound.search": "Tìm kiếm",
};

const dictionaries: Record<Locale, Record<UIKey, string>> = { en, vi };

export type Translate = (key: UIKey, vars?: Record<string, string | number>) => string;

/** Returns a translator bound to one locale, with English as the fallback. */
export function useTranslations(locale: Locale): Translate {
  const dict = dictionaries[locale] ?? dictionaries.en;
  return (key, vars) => {
    const template = dict[key] ?? dictionaries.en[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) =>
      vars[name] === undefined ? `{${name}}` : String(vars[name])
    );
  };
}

export { dictionaries };
