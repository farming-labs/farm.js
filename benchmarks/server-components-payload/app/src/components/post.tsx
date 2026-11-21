import { Link } from "@farm.js/core/client";
import { LikeButton } from "./like-button";
import { getPost } from "../data";

// A long post: server-rendered prose and highlighted code (a span per token), one client button.
export function Post({ slug, base }: { slug: string; base: string }) {
  const post = getPost(slug);
  if (!post) return <h1>Not found</h1>;
  const n = Number(slug.slice(1));
  return (
    <article>
      <h1>{post.title}</h1>
      <LikeButton post={slug} />
      {post.sections.map((section, index) => (
        <section key={index}>
          <h2>{section.text}</h2>
          {section.paragraphs.map((paragraph, p) => (
            <p key={p}>{paragraph}</p>
          ))}
          <pre>
            <code>
              {section.code.map((line, l) => (
                <span key={l} className="line">
                  {line.map((token, t) => (
                    <span key={t} className={`token ${token.kind}`}>
                      {token.text}
                    </span>
                  ))}
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
        </section>
      ))}
      {n < 99 ? (
        <Link href={`${base}/b${n + 1}`} data-next>
          {`Next post`}
        </Link>
      ) : null}
    </article>
  );
}
