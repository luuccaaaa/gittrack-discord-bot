module.exports = [
  {
    ignores: [
      'node_modules/**',
      'logs/**',
      'dashboard/**',
      'coverage/**'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-global-assign': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['warn', 'always'],
      curly: ['warn', 'all'],
      'no-console': 'off'
    }
  }
];
