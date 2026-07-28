# RSC transport benchmark

Generated 2026-07-28T22:18:14.287Z.

## Transfer size

| Fixture | Representation |       Raw |     gzip |   Brotli |
| ------- | -------------- | --------: | -------: | -------: |
| small   | ir             |   6.7 KiB |  1.4 KiB |  1.1 KiB |
| small   | html           |  14.1 KiB |  1.6 KiB |  1.2 KiB |
| small   | flightHtml     |  14.2 KiB |  1.7 KiB |  1.3 KiB |
| small   | flight         |  25.5 KiB |  2.9 KiB |  2.0 KiB |
| medium  | ir             |  26.2 KiB |  3.0 KiB |  2.3 KiB |
| medium  | html           |  55.4 KiB |  3.2 KiB |  2.4 KiB |
| medium  | flightHtml     |  55.5 KiB |  3.3 KiB |  2.5 KiB |
| medium  | flight         | 101.3 KiB |  8.4 KiB |  4.8 KiB |
| large   | ir             | 104.4 KiB |  7.8 KiB |  5.8 KiB |
| large   | html           | 220.7 KiB |  8.6 KiB |  6.1 KiB |
| large   | flightHtml     | 220.8 KiB |  8.7 KiB |  6.2 KiB |
| large   | flight         | 407.3 KiB | 30.3 KiB | 14.8 KiB |

## Incremental client renderer

| Renderer         |      Raw |     gzip |   Brotli |
| ---------------- | -------: | -------: | -------: |
| JavaScript UI IR |  4.5 KiB |  1.7 KiB |  1.5 KiB |
| Rust/Wasm UI IR  | 39.4 KiB | 16.8 KiB | 14.4 KiB |

## Warm server work

| Fixture | JavaScript IR → HTML | Strata object → HTML | Strata JSON → HTML | HTML wrapper → Flight | React tree → Flight |
| ------- | -------------------: | -------------------: | -----------------: | --------------------: | ------------------: |
| small   |             124.3 µs |             525.8 µs |           413.3 µs |               78.4 µs |            736.5 µs |
| medium  |             432.7 µs |              2.12 ms |            1.73 ms |              158.8 µs |             2.09 ms |
| large   |              1.73 ms |              8.76 ms |            6.95 ms |              495.1 µs |             9.40 ms |

## Browser warm navigation

| Fixture | Mode        |  Total p50 / p95 | Transform/decode p50 / p95 | Commit p50 / p95 |
| ------- | ----------- | ---------------: | -------------------------: | ---------------: |
| small   | html        |   4.20 / 5.00 ms |             0.00 / 0.00 ms |   0.50 / 0.60 ms |
| small   | js          |   4.60 / 5.20 ms |             0.30 / 0.50 ms |   0.50 / 0.60 ms |
| small   | wasm        |   4.50 / 4.90 ms |             0.10 / 0.20 ms |   0.50 / 0.60 ms |
| small   | flight-html |   4.70 / 5.50 ms |             0.20 / 0.30 ms |   0.80 / 0.90 ms |
| small   | flight      |   5.30 / 6.10 ms |             0.40 / 0.50 ms |   1.40 / 1.60 ms |
| medium  | html        |   8.70 / 9.80 ms |             0.00 / 0.00 ms |   1.40 / 1.60 ms |
| medium  | js          |  9.40 / 10.30 ms |             0.70 / 0.80 ms |   1.40 / 1.60 ms |
| medium  | wasm        |   9.20 / 9.70 ms |             0.20 / 0.30 ms |   1.40 / 1.60 ms |
| medium  | flight-html | 10.00 / 10.80 ms |             0.20 / 0.30 ms |   1.90 / 2.20 ms |
| medium  | flight      | 11.80 / 12.50 ms |             0.50 / 0.60 ms |   3.80 / 4.10 ms |
| large   | html        | 26.50 / 35.30 ms |             0.00 / 0.00 ms |   5.20 / 6.60 ms |
| large   | js          | 28.40 / 31.20 ms |             2.40 / 3.00 ms |   4.90 / 6.10 ms |
| large   | wasm        | 26.90 / 34.20 ms |             0.80 / 0.90 ms |   5.00 / 6.60 ms |
| large   | flight-html | 30.30 / 39.20 ms |             0.30 / 0.60 ms |   7.00 / 9.70 ms |
| large   | flight      | 35.90 / 45.70 ms |             1.20 / 1.70 ms | 13.70 / 18.00 ms |

Surrounding client shell state preserved: yes

Cold JavaScript renderer load: 4.00 ms

Cold Rust/Wasm load and instantiation: 4.60 ms

## Measured findings

Plain HTML had the lowest first-navigation transfer for every fixture. Warm browser p50 winners were small: html, medium: html, large: html. Within RSC, carrying one opaque HTML fragment beat serializing the equivalent host-element tree.

| Fixture | Opaque Flight Brotli reduction | Opaque RSC commit reduction | Strata HTML + wrapper server reduction |
| ------- | -----------------------------: | --------------------------: | -------------------------------------: |
| small   |                          34.0% |                       42.9% |                                  18.0% |
| medium  |                          48.1% |                       50.0% |                                  -9.2% |
| large   |                          57.9% |                       48.9% |                                   1.5% |

The reusable-renderer break-even below counts Brotli bytes only. A value of 10 means the renderer plus ten IR payloads becomes no larger than ten baseline payloads on navigation 10.

| Fixture | JS IR vs HTML | JS IR vs opaque Flight | JS IR vs tree Flight | Wasm IR vs HTML | Wasm IR vs opaque Flight | Wasm IR vs tree Flight |
| ------- | ------------: | ---------------------: | -------------------: | --------------: | -----------------------: | ---------------------: |
| small   |            11 |                      7 |                    2 |             100 |                       62 |                     16 |
| medium  |            23 |                     10 |                    1 |             218 |                       89 |                      6 |
| large   |             5 |                      4 |                    1 |              43 |                       33 |                      2 |

## Interpretation limits

The fixture is a host-only content tree. Strata object timing includes JavaScript JSON serialization and its N-API call; Strata JSON timing starts from a pre-serialized typed host tree. Browser endpoints serve precomputed Brotli payloads over loopback to isolate transfer, decode, and commit; server production is measured separately. Flight results do not include Client Component module references, Suspense waterfalls, database work, CDN latency, or initial HTML/Flight duplication. The opaque HTML representation gives up React ownership inside that fragment and therefore cannot contain independently updating Client Components. Browser timings come from one browser and machine. Compare the raw distributions and rerun on target devices before choosing a production transport.
