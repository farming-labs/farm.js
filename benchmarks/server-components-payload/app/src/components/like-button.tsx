"use client";
import { useState } from "react";

export function LikeButton({ post }: { post: string }) {
  const [likes, setLikes] = useState(0);
  return (
    <button type="button" data-post={post} onClick={() => setLikes(likes + 1)}>
      {likes === 0 ? "Like" : `Liked ${likes}`}
    </button>
  );
}
