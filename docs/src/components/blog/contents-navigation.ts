// Progressive enhancement for the server-rendered Markdown article. Native
// anchors remain usable without JavaScript; scrolling and history stay native.
export function enhanceContents(root: HTMLElement) {
  const navigation = [...root.querySelectorAll<HTMLElement>(".blog-contents-links")];
  if (!navigation.length) return;

  const sections = [...navigation[0].querySelectorAll<HTMLAnchorElement>("a[href^='#']")]
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter((section): section is HTMLElement => section !== null && root.contains(section));
  if (!sections.length) return;

  let activeId = sections[0].id;
  let frame = 0;
  const controller = new AbortController();
  const { signal } = controller;
  const observers: ResizeObserver[] = [];
  const updateNavigation = navigation.map((nav) => {
    const links = [...nav.querySelectorAll("a")];
    const highlight = nav.querySelector<HTMLElement>(".blog-contents-highlight");
    const indicator = nav.querySelector<HTMLElement>(".blog-contents-indicator");
    let pointerLink: HTMLAnchorElement | null = null;
    let focusedLink: HTMLAnchorElement | null = null;

    function update() {
      const current = links.find((link) => link.hash === `#${activeId}`);
      for (const link of links) {
        if (link === current) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
      const target = focusedLink ?? pointerLink ?? current;
      if (current && indicator && nav.offsetHeight) {
        const currentBounds = current.getBoundingClientRect();
        const offset = currentBounds.top - nav.getBoundingClientRect().top;
        indicator.style.transform = `translateY(${offset + (currentBounds.height - 18) / 2}px)`;
      }
      if (!target || !highlight || !nav.offsetHeight) return;
      highlight.style.transform = `translateY(${target.offsetTop}px)`;
      highlight.style.height = `${target.offsetHeight}px`;
      nav.dataset.highlightReady = "true";
    }

    for (const link of links) {
      link.addEventListener(
        "pointerenter",
        (event) => {
          if (
            event.pointerType !== "mouse" ||
            !matchMedia("(hover: hover) and (pointer: fine)").matches
          )
            return;
          nav.dataset.input = "pointer";
          pointerLink = link;
          focusedLink = null;
          update();
        },
        { signal },
      );
      link.addEventListener(
        "focus",
        () => {
          if (!link.matches(":focus-visible")) return;
          nav.dataset.input = "keyboard";
          focusedLink = link;
          pointerLink = null;
          update();
        },
        { signal },
      );
      link.addEventListener(
        "blur",
        () => {
          focusedLink = null;
          update();
        },
        { signal },
      );
    }
    function clearPointer() {
      pointerLink = null;
      update();
    }
    nav.addEventListener("pointerleave", clearPointer, { signal });
    nav.addEventListener("pointercancel", clearPointer, { signal });
    nav.addEventListener(
      "pointerdown",
      () => {
        nav.dataset.input = "pointer";
      },
      { signal },
    );
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    observers.push(observer);
    return update;
  });

  function updateSection() {
    frame = 0;
    activeId = sections[0].id;
    // Native fragment scrolling combines the document's scroll padding with
    // the target's scroll margin. Allow a small reading-line buffer for font
    // metrics settling just after the browser lands on an initial fragment.
    const scrollPadding =
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    for (const section of sections) {
      const scrollMargin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
      if (section.getBoundingClientRect().top <= scrollPadding + scrollMargin + 16)
        activeId = section.id;
    }
    for (const update of updateNavigation) update();
  }
  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(updateSection);
  }
  window.addEventListener("scroll", scheduleUpdate, { passive: true, signal });
  window.addEventListener("resize", scheduleUpdate, { signal });
  window.addEventListener("hashchange", scheduleUpdate, { signal });
  window.addEventListener("pageshow", scheduleUpdate, { signal });
  window.addEventListener(
    "wheel",
    () => {
      for (const nav of navigation) nav.dataset.input = "scroll";
    },
    { passive: true, signal },
  );
  window.addEventListener(
    "touchstart",
    () => {
      for (const nav of navigation) nav.dataset.input = "scroll";
    },
    { passive: true, signal },
  );
  // Each section heading links to its own anchor, the same target the contents use, so a reader can
  // click or copy a heading to share that section. The heading text is the link; no "#" is shown.
  const headingLinks = sections.flatMap((section) => {
    const heading = section.nextElementSibling;
    if (!(heading instanceof HTMLHeadingElement) || heading.querySelector(".blog-heading-link"))
      return [];
    const link = document.createElement("a");
    link.className = "blog-heading-link";
    link.href = `#${section.id}`;
    link.append(...heading.childNodes);
    heading.append(link);
    return [{ heading, link }];
  });

  updateSection();
  return () => {
    controller.abort();
    cancelAnimationFrame(frame);
    for (const observer of observers) observer.disconnect();
    for (const { heading, link } of headingLinks) heading.replaceChildren(...link.childNodes);
  };
}
