import { Tweet } from "react-tweet";

export const dynamic = "force-dynamic";

// react-tweet's server Tweet, from its react-server build, whose client parts import CSS modules.
export default function TweetPage() {
  return (
    <div data-testid="tweet">
      <Tweet id="1628832338187636740" />
    </div>
  );
}
