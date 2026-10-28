export const mediaTypes = {
  image: {
    accept: "image/jpeg,image/png,image/webp,image/gif",
    limit: 8 * 1024 * 1024,
    hint: "JPG、PNG、WebP、GIF · 最大 8 MB",
  },
  video: {
    accept: "video/mp4,video/webm",
    limit: 50 * 1024 * 1024,
    hint: "MP4、WebM · 最大 50 MB",
  },
} as const;
export interface UploadedMedia {
  id: string;
  url: string;
  mime: string;
  size: number;
  filename: string;
}
