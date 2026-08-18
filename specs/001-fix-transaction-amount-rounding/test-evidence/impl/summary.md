## Test evidence (impl)

- Affected package: `@actual-app/core`
- Test scope: `src/shared`
- Result: PASSED (vitest exit code 0)
- New tests: 5 (all passed)
- Regression: full scoped suite `src/shared` green
- Gate attempts used: 1 of 3

### New tests (5)
1. ✅ regression: 19.99 rounds to nearest cent instead of flooring
2. ✅ previously-correct amounts remain unchanged
3. ✅ rounds half-cent ties up (toward positive infinity) for positive amounts
4. ✅ rounds half-cent ties up (toward positive infinity) for negative amounts
5. ✅ regression: import-style conversion of 19.99 does not lose a cent
