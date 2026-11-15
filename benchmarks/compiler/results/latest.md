# Farm.js compiler benchmark

25 measured iterations per action after 5 warmups, production build, Chromium.
Latency is click dispatch to the MutationObserver callback for the resulting DOM writes.

| action | baseline p50 | compiled p50 | baseline p95 | compiled p95 | p50 speedup |
| ------ | ------------ | ------------ | ------------ | ------------ | ----------- |
| create | 2.40ms       | 1.20ms       | 2.70ms       | 1.40ms       | 2.00x       |
| update | 0.70ms       | 0.20ms       | 0.90ms       | 0.40ms       | 3.50x       |
| select | 0.60ms       | 0.10ms       | 0.80ms       | 0.20ms       | 6.00x       |
| swap   | 3.80ms       | 0.20ms       | 4.50ms       | 0.30ms       | 19.00x      |
| clear  | 2.60ms       | 0.40ms       | 3.90ms       | 1.10ms       | 6.50x       |

CPU (script+style+layout) per full action cycle: baseline 17.25ms, compiled 3.64ms (4.74x).
