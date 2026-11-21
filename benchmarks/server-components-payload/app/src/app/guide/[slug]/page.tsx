import { Post } from "../../../components/post";

export default function GuidePost({ params }: { params: { slug: string } }) {
  return <Post slug={params.slug} base="/guide" />;
}
