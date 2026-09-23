import { TableRowIsland } from "../../components/table-row-island";

export default function TablePage() {
  return (
    <main>
      <h1 data-testid="table-title">Island in table context</h1>
      <table data-testid="table">
        <tbody data-testid="tbody">
          <tr>
            <td>static row</td>
          </tr>
          <TableRowIsland />
        </tbody>
      </table>
    </main>
  );
}
