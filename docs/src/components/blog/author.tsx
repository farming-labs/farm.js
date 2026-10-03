import { launchPost } from "../../lib/blog";

export function BlogAuthor() {
  return (
    <span className="blog-author">
      <a
        className="blog-author-profile"
        href={launchPost.authorUrl}
        aria-label={`${launchPost.author} on X`}
      >
        <img
          className="blog-author-avatar"
          src={launchPost.authorAvatar}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
        />
      </a>
      <span>
        <span className="blog-author-name">{launchPost.author}</span>
        <small>
          <a href={launchPost.organizationUrl}>{launchPost.organization}</a>
        </small>
      </span>
    </span>
  );
}
