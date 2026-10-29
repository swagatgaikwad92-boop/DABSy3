// Self-contained flat config (no plugin/globals packages needed).
const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly', fetch: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', requestIdleCallback: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  Headers: 'readonly', Request: 'readonly', Response: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
  Image: 'readonly', Notification: 'readonly', Intl: 'readonly', structuredClone: 'readonly',
  matchMedia: 'readonly', getComputedStyle: 'readonly', performance: 'readonly', queueMicrotask: 'readonly',
  HTMLElement: 'readonly', Element: 'readonly', Node: 'readonly', CustomEvent: 'readonly', Event: 'readonly',
  ResizeObserver: 'readonly', MutationObserver: 'readonly', IntersectionObserver: 'readonly',
  SpeechRecognition: 'readonly', webkitSpeechRecognition: 'readonly', Blob: 'readonly', crypto: 'readonly',
  caches: 'readonly', self: 'readonly', clients: 'readonly', addEventListener: 'readonly', skipWaiting: 'readonly',
  DOMMatrix: 'readonly', atob: 'readonly', btoa: 'readonly', ReadableStream: 'readonly', DOMException: 'readonly',
};
const node = {
  process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', console: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', URL: 'readonly', fetch: 'readonly',
  AbortController: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', ReadableStream: 'readonly',
  Response: 'readonly', Request: 'readonly', Headers: 'readonly', structuredClone: 'readonly', crypto: 'readonly',
  queueMicrotask: 'readonly', performance: 'readonly', DOMException: 'readonly', globalThis: 'readonly',
};
const rules = {
  'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always', { null: 'ignore' }], 'no-var': 'error', 'prefer-const': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }], 'no-unreachable': 'error', 'no-dupe-keys': 'error',
  'no-redeclare': 'error', 'no-fallthrough': 'error', 'no-self-assign': 'error', 'no-shadow-restricted-names': 'error',
  'no-const-assign': 'error', 'no-dupe-args': 'error', 'no-duplicate-case': 'error', 'no-func-assign': 'error',
  'no-inner-declarations': 'error', 'no-invalid-regexp': 'error', 'no-sparse-arrays': 'error',
  'no-unsafe-finally': 'error', 'no-unused-labels': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
  'no-useless-catch': 'error', 'no-cond-assign': ['error', 'except-parens'], 'no-constant-condition': ['error', { checkLoops: false }],
  'no-prototype-builtins': 'error', 'no-throw-literal': 'error', 'no-eval': 'error', 'no-implied-eval': 'error',
};
export default [
  { ignores: ['dist/**', 'node_modules/**', 'assets-src/**', 'tests/e2e/shots/**'] },
  { files: ['src/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser }, rules },
  { files: ['public/sw.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browser }, rules },
  { files: ['worker/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node } }, rules },
  { files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node, ...browser } }, rules },
];
