import { TypedProps } from "../../components/typed-props";

export default function TypesPage() {
  return (
    <section>
      <h1>Typed props</h1>
      <TypedProps
        updated={new Date("2026-10-28T09:00:00.000Z")}
        tags={new Set(["new", "sale"])}
        stock={new Map([["sku-1", 3]])}
        id={12345678901234567890n}
        missing={undefined}
        ratio={Number.NaN}
        limit={Infinity}
        sign={-0}
        bytes={new Uint8Array([0, 1, 254, 255])}
      />
    </section>
  );
}
