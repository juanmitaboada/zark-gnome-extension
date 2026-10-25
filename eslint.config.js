// SPDX-License-Identifier: GPL-2.0-or-later
//
// GNOME's ESLint rules, as gnome-shell-extensions uses them (its
// eslint.config.js, with the same rule overrides).

import {defineConfig} from '@eslint/config-helpers';
import gnome from 'eslint-config-gnome';

export default defineConfig([
    gnome.configs.recommended,
    gnome.configs.jsdoc,
    {
        rules: {
            camelcase: ['error', {
                properties: 'never',
            }],
            'consistent-return': 'error',
            'eqeqeq': ['error', 'smart'],
            'key-spacing': ['error', {
                mode: 'minimum',
                beforeColon: false,
                afterColon: true,
            }],
            'prefer-arrow-callback': 'error',
            'prefer-const': ['error', {
                destructuring: 'all',
            }],
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-jsdoc': ['error', {
                exemptEmptyFunctions: true,
                publicOnly: {
                    esm: true,
                },
            }],
        },
        languageOptions: {
            globals: {
                global: 'readonly',
            },
        },
    },
    {
        ignores: ['node_modules/', 'dev/'],
    },
]);
