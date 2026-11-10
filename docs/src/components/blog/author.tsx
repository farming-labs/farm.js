import type { BlogPost } from "../../lib/blog";
import { launchPost } from "../../lib/blog";

/** A post's byline. Defaults to the launch post for callers that predate the collection. */
export function BlogAuthor({ post = launchPost }: { post?: BlogPost }) {
  return (
    <span className="blog-author">
      <a className="blog-author-profile" href={post.authorUrl} aria-label={`${post.author} on X`}>
        <img
          className="blog-author-avatar"
          src={post.authorAvatar}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
        />
      </a>
      <span>
        <span className="blog-author-name">{post.author}</span>
        <small>
          <a href={post.organizationUrl}>{post.organization}</a>
        </small>
      </span>
    </span>
  );
}
