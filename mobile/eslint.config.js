// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
  {
    rules: {
      // HTML-escaping rule; apostrophes in React Native <Text> are fine.
      'react/no-unescaped-entities': 'off',
      // React Compiler advisories. Kept visible as warnings: the compiler safely skips components that
      // trip them, and several are false positives (e.g. Reanimated `sharedValue.value = ...`).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]);
