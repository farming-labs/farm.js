export default function NavB() {
  return (
    <>
      <h1>Nav page B</h1>
      {/* Only a browser without JavaScript loads this; a client navigation leaves it inert. */}
      <noscript>
        <img src="/noscript-pixel/nav" alt="" />
      </noscript>
    </>
  );
}
