export const ssg = true;

export default function AboutPage() {
  return (
    <>
      <h1 className="page-title">About</h1>
      <p>
        A static page. In the shell it is pushed onto the Home tab's stack from a pre-warmed
        WebView, and back pops it.
      </p>
    </>
  );
}
