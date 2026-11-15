import { Link } from "@farm.js/core/client";
import { LikeButton } from "../../../components/like-button";
import { getPost } from "../../../data";

export default function BlogPost({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) return <h1>Not found</h1>;
  const n = Number(params.slug.slice(1));
  return (
    <article>
      <h1>{post.title}</h1>
      <LikeButton post={params.slug} />
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
        <Link href={`/blog/b${n + 1}`} data-next>
          {`Next post`}
        </Link>
      ) : null}
    </article>
  );
}
