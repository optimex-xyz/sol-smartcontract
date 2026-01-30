export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Basic rules
    'type-enum': [
      2,
      'always',
      [
        'feat', // New features
        'fix', // Fix bugs
        'docs', // Docs
        'style', // Change style without effect flow
        'refactor', // Refactor code for beauty, no new features
        'perf', // Rewrite code for increase performance
        'test', // Add or modify test
        'build', // Change or update build setup
        'ci', // Change ci/cd configuration
        'chore', // Change code without effect to product
        'revert', // Revert previous commit
      ],
    ],
    'type-case': [2, 'always', 'lowerCase'], // Change `lowrer` to `lowerCase`
    'type-empty': [2, 'never'], // Don't allow empty type
    'subject-empty': [2, 'never'], // Don't allow empty subject
    'subject-full-stop': [2, 'never', '.'], // Don't allow dot at the end of subject
    'subject-case': [0], // Disable case check for subject
    'header-max-length': [2, 'always', 100], // Max length of header
  },
}

