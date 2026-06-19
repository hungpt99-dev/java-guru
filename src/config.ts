export const SITE = {
  website: "https://java-guru.dev/", // replace this with your deployed domain
  author: "Phạm Thanh Hưng (Harry)",
  profile: "https://github.com/hungpt99-dev",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true, // show back button in post detail
  editPost: {
    enabled: false,
    url: "",
  },
  dynamicOgImage: true,
  lang: "", // html lang code. Set this empty and default will be "en"
  timezone: "Asia/Ho_Chi_Minh", // Default global timezone (IANA format) https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
} as const;
