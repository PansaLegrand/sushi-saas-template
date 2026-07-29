## Summary

<!-- What changed, and why does the starter need it? -->

## Validation

- [ ] `pnpm lint`
- [ ] `pnpm test:cov`
- [ ] `pnpm test:db` when an infrastructure invariant changed
- [ ] `pnpm build`
- [ ] Manual happy path documented for auth, billing, i18n, or storage changes

## Deployment and compatibility

- [ ] No migration
- [ ] Migration is expand/contract safe and generated SQL + metadata are committed
- [ ] No new environment variables
- [ ] New environment variables are in `.env.example` and deployment docs
- [ ] Backward compatibility and rollout order are described below

<!-- Remove mutually exclusive unchecked items and explain anything operators must do. -->

## Security and tenancy

- [ ] Authentication is checked before data access
- [ ] Organization scope is explicit on tenant-owned data
- [ ] Money or credit mutations include a replay test
- [ ] Errors use the catalog and expose no raw provider/database messages
- [ ] Logs and screenshots contain no secrets or personal data

## Documentation impact

- [ ] Co-versioned engineering docs were updated
- [ ] Public website/docs do not need a corresponding change
- [ ] A corresponding website/docs change is linked below

## UI evidence

<!-- Add before/after screenshots or recordings for visible changes. -->

## Related issues

<!-- Closes #... -->
