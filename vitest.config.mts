import path from 'node:path'

import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const timeout = 60 * 1000

export default defineConfig({
    plugins: [tsconfigPaths()],
    resolve: {
        alias: {
            '@bufbuild/protobuf/wire': path.resolve('./node_modules/@bufbuild/protobuf/dist/cjs/wire/index.js'),
            '@bufbuild/protobuf': path.resolve('./node_modules/@bufbuild/protobuf/dist/cjs/index.js'),
        },
    },
    test: {
        name: 'unit',
        env: {
            NODE_ENV: 'test',
        },
        clearMocks: true,
        restoreMocks: true,
        mockReset: true,
        globals: true,
        testTimeout: timeout,
        hookTimeout: timeout,
        exclude: ['node_modules', 'dist'],
        include: ['tests/unit/**/*.spec.ts'],
    },
})
