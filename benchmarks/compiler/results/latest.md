# Farm.js compiler benchmark

25 measured iterations per action after 5 warmups, production build, Chromium.
Latency is click dispatch to the MutationObserver callback for the resulting DOM writes.

| action | baseline p50 | compiled p50 | baseline p95 | compiled p95 | p50 speedup |
| --- | --- | --- | --- | --- | --- |
| create | 2.70ms | 2.30ms | 3.10ms | 2.60ms | 1.17x |
| update | 0.70ms | 0.70ms | 0.90ms | 1.00ms | 1.00x |
| select | 0.60ms | 0.50ms | 0.80ms | 1.00ms | 1.20x |
| swap | 3.40ms | 0.50ms | 4.40ms | 0.70ms | 6.80x |
| clear | 3.80ms | 0.70ms | 5.60ms | 1.50ms | 5.43x |

CPU (script+style+layout) per full action cycle: baseline 18.71ms, compiled 9.05ms (2.07x).

