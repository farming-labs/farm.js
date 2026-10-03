type BlogVideoProps = {
  src: string;
  poster: string;
  /** Set into the frame's top border, like the post's code panel legends. */
  title: string;
  /** Shown at the other end of the top border, such as "1:56". */
  duration?: string;
  caption?: string;
};

/**
 * A video in the post's figure frame: the hairline panel the figures use, with
 * corner squares and a legend in its top border. Only the poster loads until
 * someone presses play.
 */
export function BlogVideo({ src, poster, title, duration, caption }: BlogVideoProps) {
  return (
    <figure className="blog-video">
      <div className="bv-frame">
        <span className="bv-legend">{title}</span>
        {duration ? <span className="bv-legend bv-legend--end">{duration}</span> : null}
        <span aria-hidden className="bv-corner bv-corner-tl" />
        <span aria-hidden className="bv-corner bv-corner-tr" />
        <span aria-hidden className="bv-corner bv-corner-bl" />
        <span aria-hidden className="bv-corner bv-corner-br" />
        <video
          aria-label={title}
          className="bv-video"
          controls
          playsInline
          poster={poster}
          preload="none"
          src={src}
        >
          <a href={src}>Download the video</a>
        </video>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
