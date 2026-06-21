export interface Video {
  title: string;
  description: string;
  youtubeId: string;
  locale: "en" | "vi";
}

export const videos: Video[] = [];
