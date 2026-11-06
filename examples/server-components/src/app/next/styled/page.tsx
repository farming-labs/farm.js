import "./styled.css";
import { Badge } from "../../../components/badge";

// Styles imported by a server page and by a server component it renders.
export default function StyledPage() {
  return (
    <section>
      <h1>Styled</h1>
      <p className="next-styled" data-testid="styled-text">
        Styled by the page
      </p>
      <Badge />
    </section>
  );
}
