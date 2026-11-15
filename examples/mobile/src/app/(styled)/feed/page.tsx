import { Link } from "@farm.js/core/client";

export const ssg = true;

const ROWS = Array.from({ length: 240 }, (_, index) => ({
  id: index + 1,
  title: `Observation ${index + 1}`,
  detail: ["Lichen on granite", "Fresh tracks", "Low cloud", "Snow patch", "Marmot burrow"][
    index % 5
  ],
}));

/** 240 server-rendered rows, for scroll and frame-time checks. */
export default function FeedPage() {
  return (
    <>
      <h1 className="page-title">Feed</h1>
      <p className="meta">{ROWS.length} observations</p>
      <ul className="list" data-testid="feed">
        {ROWS.map((row) => (
          <li key={row.id}>
            <Link className="row" href={`/notes/${(row.id % 3) + 1}`}>
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
