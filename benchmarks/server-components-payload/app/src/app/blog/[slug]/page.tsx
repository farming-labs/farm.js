import { Post } from "../../../components/post";

export default function BlogPost({ params }: { params: { slug: string } }) {
  return <Post slug={params.slug} base="/blog" />;
}
