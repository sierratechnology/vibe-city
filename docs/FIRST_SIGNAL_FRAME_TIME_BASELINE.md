# First Signal local frame-time baseline

## Scope and identity

This document records one bounded local measurement run of the current First Signal renderer. It is a measurement baseline, not an optimization result or release gate.

- Recorded: 2026-09-24T19:36:05Z
- Source commit: `18a06d91ba9e869880c0dd873ce25e6f381db675`
- Source tree: `7aa8d86827ff03b84e92d18e29679f19ae6dd151`
- Host class: Apple M1 (`arm64`), 8 GiB memory, macOS 26.6.2 (build 25G83). Serial numbers, hostnames, usernames and other personal identifiers are omitted.
- Browser engines: local Chromium 140.0.7339.186 and local Firefox 141.0.
- Viewports: desktop 1440×900 and phone-sized emulation 390×844. The phone-sized result is browser emulation, not physical-phone evidence.
- Renderer gate: every scenario entered an authenticated local world, connected the renderer, displayed a nonzero-size canvas, and reported nonzero draw calls and triangles before sampling.
- Sampling: fixed 3,000 ms warmup followed by a fixed 10,000 ms requestAnimationFrame measurement window, with at most 10,000 timestamps.
- Reference threshold: `16.666666666666668 ms`. This is a measurement reference, not an approved product acceptance budget.

## Command and preserved output

The canonical final measurement was run once, without retry:

```text
node tests/frame-time-browser.js
```

The exact console output was preserved at `/tmp/vibe-city-frame-time-canonical-896.json` for this handoff. It is 2,794 bytes with SHA-256 `0a9c18457e4944f9d807f2c9acb6667c52cfa1c777273603c1a60585cd7fe91a`. The server's preceding status line reported a disposable loopback endpoint; the machine-readable payload from that same run follows without hand-normalization:

```json
{
  "referenceThreshold": "16.666666666666668 ms measurement reference; not a product acceptance budget",
  "results": [
    {
      "browser": "chromium",
      "browserVersion": "140.0.7339.186",
      "scenario": "desktop",
      "viewport": {
        "width": 1440,
        "height": 900
      },
      "touchEmulated": false,
      "warmupMs": 3000,
      "measurementWindowMs": 10000,
      "timestampCount": 602,
      "count": 601,
      "durationMs": 10016.3,
      "minMs": 14.699999999998909,
      "medianMs": 16.69999999999891,
      "p95Ms": 18.299999999999272,
      "maxMs": 18.700000000000728,
      "overBudgetCount": 347,
      "budgetMs": 16.666666666666668,
      "pageErrors": 0,
      "requestFailures": 0,
      "externalRequests": 0
    },
    {
      "browser": "chromium",
      "browserVersion": "140.0.7339.186",
      "scenario": "phone-sized-emulation",
      "viewport": {
        "width": 390,
        "height": 844
      },
      "touchEmulated": true,
      "warmupMs": 3000,
      "measurementWindowMs": 10000,
      "timestampCount": 602,
      "count": 601,
      "durationMs": 10016.300000000001,
      "minMs": 14.599999999998545,
      "medianMs": 16.699999999999818,
      "p95Ms": 17.899999999999636,
      "maxMs": 18.600000000000364,
      "overBudgetCount": 355,
      "budgetMs": 16.666666666666668,
      "pageErrors": 0,
      "requestFailures": 0,
      "externalRequests": 0
    },
    {
      "browser": "firefox",
      "browserVersion": "141.0",
      "scenario": "desktop",
      "viewport": {
        "width": 1440,
        "height": 900
      },
      "touchEmulated": false,
      "warmupMs": 3000,
      "measurementWindowMs": 10000,
      "timestampCount": 596,
      "count": 595,
      "durationMs": 10002.02,
      "minMs": 14.739999999999782,
      "medianMs": 16.720000000000255,
      "p95Ms": 18.219999999999345,
      "maxMs": 43.81999999999971,
      "overBudgetCount": 487,
      "budgetMs": 16.666666666666668,
      "pageErrors": 0,
      "requestFailures": 0,
      "externalRequests": 0
    },
    {
      "browser": "firefox",
      "browserVersion": "141.0",
      "scenario": "phone-sized-emulation",
      "viewport": {
        "width": 390,
        "height": 844
      },
      "touchEmulated": true,
      "warmupMs": 3000,
      "measurementWindowMs": 10000,
      "timestampCount": 599,
      "count": 598,
      "durationMs": 10003.539999999999,
      "minMs": 14.739999999999782,
      "medianMs": 16.720000000000255,
      "p95Ms": 18.100000000000364,
      "maxMs": 18.700000000000728,
      "overBudgetCount": 499,
      "budgetMs": 16.666666666666668,
      "pageErrors": 0,
      "requestFailures": 0,
      "externalRequests": 0
    }
  ]
}
```

All four scenarios passed the harness's finite, strictly increasing timestamp validation and minimum 30-interval requirement. Every scenario remained below the 10,000-timestamp ceiling. Page errors, failed requests and external requests were zero in every scenario. Application and test traffic remained on loopback; provider-backed application/test calls were zero.

## Test-first and execution history

The implementation evidence predates this final documentation run and is preserved without relabeling:

1. The first sampler test failed because the sampler function was missing, then passed after the minimum implementation.
2. Six further focused sampler cycles each showed the expected RED before GREEN: non-finite timestamps; non-monotonic timestamps; unsafe sample counts and thresholds; sparse or hostile objects; minimum interval count; and the 10,000-timestamp ceiling. The final focused total was 7/7 passing.
3. The browser journey first failed with the expected `MODULE_NOT_FOUND` before `tests/frame-time-browser.js` existed.
4. Two later browser executions timed out on a hidden `#username` field. Those are retained as transient failed execution attempts, not proof of a functional defect.
5. A subsequent unchanged execution completed all four scenarios. No correction was made to manufacture another RED.
6. The canonical run recorded above then completed all four unchanged scenarios and is the sole measurement source for this document.

## Cleanup and safety evidence

The harness used a disposable local account and disk save beneath a `vibe-frame-time-*` temporary directory. Its idempotent teardown closed each browser context, browser and local server and recursively removed the temporary directory. The immediate post-run check found:

- no `vibe-frame-time-*` temporary directory;
- no harness browser, server or child process;
- no listener on the run's disposable port;
- no Git index lock;
- no page errors, request failures or external requests in the result payload.

No credential, cookie value, verification code, save payload, private/customer data or production save was logged or used. Incremental spend was USD 0 beyond configured inference.

## Limitations and follow-up

This run is not Safari evidence, physical-phone evidence, a separate-LAN-human test, lower-powered or Raspberry Pi hardware evidence, production evidence, thermal or battery testing, subjective camera-feel evidence, or milestone-completion evidence. It does not establish a product frame-time budget or prove all browsers, devices, scenes, player counts or environmental conditions meet one. Reduced motion was requested in each isolated browser context, and the run covered only the current seeded local scene during the stated windows.

Continue the remaining Milestone 0 evaluation separately: physical Safari/phone and lower-powered-hardware checks, two-human LAN play, sustained network latency and reconnect/sleep-wake measurement, and subjective camera/crafting/construction/shelter evaluation. Compare future frame-time measurements using the same raw fields and clearly identify any changed source tree, host class, browser version, viewport, scene or sampling window.
