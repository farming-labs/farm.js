import { content, collection, files } from "@farm.js/content";
import { defineConfig } from "@farm.js/core";
import { z } from "zod";

const post = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  publishedAt: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
});

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  plugins: [
    content({
      collections: {
        posts: collection({
          source: files("content/posts/**/*.md"),
          schema: post,
          transform: ({ data, words }) => ({
            ...data,
            readingMinutes: Math.max(1, Math.ceil(words / 220)),
          }),
        }),
      },
    }),
  ],
});
