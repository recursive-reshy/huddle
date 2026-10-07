import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default defineConfig(
  { ignores: [ 'dist', 'node_modules', 'src/generated' ] },
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [ '**/*.ts' ],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/space-in-parens': [ 'error', 'always' ],
      '@stylistic/array-bracket-spacing': [ 'error', 'always' ],
      '@stylistic/object-curly-spacing': [ 'error', 'always' ],
      '@stylistic/keyword-spacing': [ 'error', {
        overrides: {
          if: { after: false },
          for: { after: false },
          while: { after: false },
          switch: { after: false },
          catch: { after: false },
        },
      } ],
      '@stylistic/semi': [ 'error', 'never' ],
      '@stylistic/quotes': [ 'error', 'single', { avoidEscape: true } ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
)