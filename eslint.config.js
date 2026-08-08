import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: {
                process: 'readonly',
                console: 'readonly',
                __dirname: 'readonly',
                module: 'writable',
                require: 'readonly',
                fetch: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                Buffer: 'readonly',
                // server/update_user_data.js and friends pass callbacks into
                // Puppeteer's page.evaluate() that run in a real browser
                // context, not Node — these globals only exist there, but
                // ESLint parses the whole file as one scope.
                document: 'readonly',
                window: 'readonly',
                location: 'readonly',
                URL: 'readonly',
                Blob: 'readonly',
                atob: 'readonly',
                navigator: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // Empty catch blocks are a deliberate, recurring pattern in this
            // codebase (best-effort cleanup/retry paths) — flag as a nudge,
            // not a build-breaking error.
            'no-empty': 'warn',
        },
    },
    {
        ignores: ['node_modules/', 'discord-ai-assistant/', 'web/', 'screenshots/'],
    },
];
