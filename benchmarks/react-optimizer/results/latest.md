# React optimizer benchmark

Farm commit: 2149d42abd79c0558b4f071c2c3578d54a44a64e
Runtime: v24.21.0, darwin 25.2.0 arm64, Apple M1
Browser: Chromium 145.0.7632.6
5 trials × 20 measured cycles after 5 warmups.

React, Million auto, Farm AOT passed row output, keyed DOM identity, uncontrolled input, focus, and selection controls.
The Million For variants use documented manual source. Any variant that fails correctness is excluded from timing.

| action | React p50 | Million auto p50 |    Million For p50 | Farm AOT p50 | Farm vs Million auto |
| ------ | --------: | ---------------: | -----------------: | -----------: | -------------------: |
| create |    5.80ms |           5.90ms | correctness failed |       4.20ms |                1.40x |
| update |    1.70ms |           1.60ms | correctness failed |       0.70ms |                2.29x |
| select |    1.70ms |           1.60ms | correctness failed |       0.10ms |               16.00x |
| swap   |    7.00ms |           6.90ms | correctness failed |       0.80ms |                8.62x |
| append |    2.40ms |           2.30ms | correctness failed |       1.30ms |                1.77x |
| remove |    2.80ms |           2.60ms | correctness failed |       0.80ms |                3.25x |
| clear  |    4.90ms |           4.90ms | correctness failed |       2.10ms |                2.33x |

| variant             |      CPU/cycle p50 |      CPU/cycle p95 | heap after GC p50 |  JS gzip | JS Brotli |
| ------------------- | -----------------: | -----------------: | ----------------: | -------: | --------: |
| React               |            55.11ms |            60.62ms |        3274.5 KiB | 59.6 KiB |  51.3 KiB |
| Million auto        |            55.66ms |            57.14ms |        3538.6 KiB | 66.4 KiB |  56.6 KiB |
| Million For         | correctness failed | correctness failed |               n/a | 64.9 KiB |  55.2 KiB |
| Million For + block | correctness failed | correctness failed |               n/a | 66.1 KiB |  56.4 KiB |
| Farm AOT            |            24.45ms |            24.78ms |        2668.6 KiB | 68.8 KiB |  59.4 KiB |

Farm CPU speedup over Million auto: 2.28x.
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
