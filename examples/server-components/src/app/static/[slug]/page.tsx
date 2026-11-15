export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ slug: "a" }, { slug: "b" }];
}

export default async function StaticPage({ params }: { params: { slug: string } | Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <h1>{`Static ${slug}`}</h1>;
}
