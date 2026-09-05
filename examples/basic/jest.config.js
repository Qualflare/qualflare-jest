const { qualflareReporter } = require('@qualflare/jest');

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  reporters: [
    'default',
    // The typed helper, which is what this example exists to document. The
    // equivalent literal is ['@qualflare/jest/reporter', { ... }].
    qualflareReporter({ environment: 'development' }),
  ],
};
