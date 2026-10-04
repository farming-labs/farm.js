# React optimizer benchmark

Farm commit: 38a2bbcc4ebd482025a6d70fab075ef71677985c
Runtime: v23.11.0, darwin 25.2.0 arm64, Apple M1
Browser: Chromium 145.0.7632.6
5 trials × 20 measured cycles after 5 warmups.

React, Million auto, Farm AOT passed row output, keyed DOM identity, uncontrolled input, focus, and selection controls.
The Million For variants use documented manual source. Any variant that fails correctness is excluded from timing.

| action | React p50 | Million auto p50 |    Million For p50 | Farm AOT p50 | Farm vs Million auto |
| ------ | --------: | ---------------: | -----------------: | -----------: | -------------------: |
| create |    5.90ms |           6.30ms | correctness failed |       4.20ms |                1.50x |
| update |    1.80ms |           1.80ms | correctness failed |       0.80ms |                2.25x |
| select |    1.70ms |           1.80ms | correctness failed |       0.20ms |                9.00x |
| swap   |    7.30ms |           7.70ms | correctness failed |       0.90ms |                8.56x |
| append |    2.50ms |           2.40ms | correctness failed |       1.40ms |                1.71x |
| remove |    2.70ms |           2.90ms | correctness failed |       0.90ms |                3.22x |
| clear  |    5.20ms |           5.20ms | correctness failed |       2.30ms |                2.26x |

| variant             |      CPU/cycle p50 |      CPU/cycle p95 | heap after GC p50 |  JS gzip | JS Brotli |
| ------------------- | -----------------: | -----------------: | ----------------: | -------: | --------: |
| React               |            55.36ms |            75.14ms |        3273.2 KiB | 59.5 KiB |  51.3 KiB |
| Million auto        |            63.69ms |            74.11ms |        3534.4 KiB | 66.3 KiB |  56.6 KiB |
| Million For         | correctness failed | correctness failed |               n/a | 64.8 KiB |  55.2 KiB |
| Million For + block | correctness failed | correctness failed |               n/a | 66.0 KiB |  56.4 KiB |
| Farm AOT            |            23.73ms |            35.29ms |        2698.8 KiB | 70.2 KiB |  60.8 KiB |

Farm CPU speedup over Million auto: 2.68x.
Million For correctness failure: Million For failed correctness after remove: keyed DOM identity changed.
Million For + block correctness failure: page.evaluate: Error: No DOM mutation observed for create.
at eval (eval at evaluate (:290:30), <anonymous>:11:25)
Browser error: TypeError: l is not a function
at lr (http://127.0.0.1:46743/assets/index-DNve-YQj.js:49:46820)
at Object.ir [as block] (http://127.0.0.1:46743/assets/index-DNve-YQj.js:49:52339)
at Go (http://127.0.0.1:46743/assets/index-DNve-YQj.js:51:1534)
at Qv (http://127.0.0.1:46743/assets/index-DNve-YQj.js:51:878)
at Ef (http://127.0.0.1:46743/assets/index-DNve-YQj.js:48:47832)
at zc (http://127.0.0.1:46743/assets/index-DNve-YQj.js:48:70443)
at X0 (http://127.0.0.1:46743/assets/index-DNve-YQj.js:48:67862)
at L0 (http://127.0.0.1:46743/assets/index-DNve-YQj.js:48:83185)
at vh (http://127.0.0.1:46743/assets/index-DNve-YQj.js:48:116148)
at hm (http://127.0.0.1:46743/assets/index-DNve-YQj.js:48:115230)

A value above 1.00x in the final latency column means Farm completed that action faster.
Raw per-action and per-trial samples are stored in latest.json.
