import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The JVM baseline these tests are compared against ran with TZ=UTC, and
    // `parseUID` renders its timestamp in the default zone.
    env: { TZ: 'UTC' },
    // CachedUidGeneratorTest draws 7 000 000 ids per test method; the upstream
    // JUnit run of the same two methods takes ~50 s.
    testTimeout: 900_000,
    hookTimeout: 120_000,
    // The two ported generator suites hold a set of every id they drew —
    // 7 000 000 of them for CachedUidGeneratorTest — so each file gets its own
    // process and they run one at a time: sharing one process makes the peak
    // the *sum* of those sets, and adding coverage instrumentation on top of
    // that exhausts the heap.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=4096'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Ports of the original's interfaces and @FunctionalInterfaces. Each holds
      // only type declarations, so `tsc` emits nothing but the licence comment
      // and `export {}` — there is no statement in them to execute. The v8
      // provider maps its counters back to the TypeScript source and would
      // report every one of their comment lines as uncovered. Listed one by one
      // rather than matched by a glob, so a file that grows real code has to be
      // removed from here deliberately.
      exclude: [
        'src/uid-generator.ts',
        'src/buffer/buffered-uid-provider.ts',
        'src/buffer/rejected-put-buffer-handler.ts',
        'src/buffer/rejected-take-buffer-handler.ts',
        'src/deps/spring/lifecycle.ts',
        'src/utils/valued-enum.ts',
        'src/worker/worker-id-assigner.ts',
        'src/worker/dao/worker-node-dao.ts',
      ],
      reporter: ['text', 'json'],
    },
  },
});
