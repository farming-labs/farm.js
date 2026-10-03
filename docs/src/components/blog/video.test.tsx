// @vitest-environment node
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogVideo } from "./video";

const requiredProps = {
  src: "/videos/launch.mp4",
  poster: "/videos/launch.jpg",
  title: "Launch video",
};

function timestampToSeconds(timestamp: string) {
  const [hours, minutes, seconds] = timestamp.split(":").map(Number);
  return hours * 60 * 60 + minutes * 60 + seconds;
}

describe("BlogVideo", () => {
  it("reserves the duration's space when the title is too wide", () => {
    const html = renderToStaticMarkup(
      <BlogVideo {...requiredProps} duration="1:56" title="Farm.js v0.1.0 · launch video" />,
    );
    const css = postcss.parse(readFileSync(new URL("./figures.css", import.meta.url), "utf8"));
    const declarations = (selector: string) => {
      const values = new Map<string, string>();
      css.walkRules(selector, (rule) =>
        rule.walkDecls((declaration) => values.set(declaration.prop, declaration.value)),
      );
      return values;
    };

    expect(html).toContain(
      '<div class="bv-legends"><span class="bv-legend">Farm.js v0.1.0 · launch video</span><span class="bv-legend bv-legend--end">1:56</span></div>',
    );
    expect(declarations(".bv-legends").get("display")).toBe("flex");
    expect(declarations(".bv-legends").get("gap")).toBe("0.75em");
    expect(declarations(".bv-legend:first-child").get("min-width")).toBe("0");
    expect(declarations(".bv-legend:first-child").get("overflow")).toBe("hidden");
    expect(declarations(".bv-legend:first-child").get("text-overflow")).toBe("ellipsis");
    expect(declarations(".bv-legend:first-child").get("white-space")).toBe("nowrap");
    expect(declarations(".bv-legend--end").get("flex-shrink")).toBe("0");
  });

  it("renders configured captions as the default track", () => {
    const html = renderToStaticMarkup(
      <BlogVideo
        {...requiredProps}
        captions={{
          src: "/videos/launch.en.vtt",
          srcLang: "en",
          label: "English",
        }}
      />,
    );

    expect(html).toContain('<track default=""');
    expect(html).toContain('kind="captions"');
    expect(html).toContain('label="English"');
    expect(html).toContain('src="/videos/launch.en.vtt"');
    expect(html).toContain('srcLang="en"');
  });

  it("keeps videos without captions backward compatible", () => {
    const html = renderToStaticMarkup(<BlogVideo {...requiredProps} />);
    expect(html).not.toContain("<track");
  });

  it("ships ordered captions within the launch film duration", () => {
    const captions = readFileSync(
      new URL("../../../public/videos/farmjs-v0.1.0-launch.en.vtt", import.meta.url),
      "utf8",
    );
    const cues = captions
      .trim()
      .split(/\n{2,}/)
      .slice(1);

    expect(captions).toMatch(/^WEBVTT\n/);
    expect(cues).toHaveLength(5);

    let previousEnd = 0;
    for (const cue of cues) {
      const [timing, ...payload] = cue.split("\n");
      const match = timing.match(
        /^(\d{2}:[0-5]\d:[0-5]\d\.\d{3}) --> (\d{2}:[0-5]\d:[0-5]\d\.\d{3})$/,
      );

      expect(match).not.toBeNull();
      expect(payload.join("\n").trim()).not.toBe("");
      if (!match) throw new Error(`Invalid WebVTT cue timing: ${timing}`);

      const [, startTimestamp, endTimestamp] = match;
      const start = timestampToSeconds(startTimestamp);
      const end = timestampToSeconds(endTimestamp);

      expect(start).toBeGreaterThanOrEqual(previousEnd);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(115.6);
      previousEnd = end;
    }
  });
});
