# Changelog

## 0.1.0

- First installable version: the marketplace and plugin manifests, with no agents, skills or commands yet (#3).
- CI runs the test suite, validates the marketplace, plugin, agents, skills and commands with Claude Code's own validator, installs the plugin into a clean config, and fails a pull request that changes shipped files without raising the version and adding a changelog entry (#3).
