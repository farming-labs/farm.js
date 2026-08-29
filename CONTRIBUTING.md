# Contributing to Farm.js

Thank you for your interest in contributing to Farm.js! This guide will help you get started.

Repository architecture, package boundaries, verification expectations, and pull request guidance live in [`AGENTS.md`](./AGENTS.md). Coding agents must read and follow it; human contributors can use it as the current maintainer playbook.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 8+

### Getting Started

1. **Fork and clone the repository**

```bash
git clone https://github.com/your-username/farm.js.git
cd farm.js
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Build all packages**

```bash
pnpm build
```

4. **Start development**

```bash
# Start playground for testing
cd playground
pnpm dev

# Or run tests
pnpm test
```

## Project Structure

```
farm.js/
├── packages/
│   ├── farm/              # Core framework
│   ├── farm-cli/          # @farm.js/cli tools
│   └── create-farm-app/   # @farm.js/create-app tool
├── examples/              # Example applications
├── docs/                  # Documentation site
├── playground/            # Development testing
└── tests/                 # Integration tests
```

## Development Workflow

### Making Changes

1. **Create a feature branch**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**
   - Write code following our style guidelines
   - Add tests for new functionality
   - Update documentation if needed

3. **Test your changes**

```bash
# Run unit tests
pnpm test

# Test in playground
cd playground
pnpm dev

# Test examples
cd examples/basic
pnpm dev
```

4. **Describe the user-facing impact** in your pull request.

### Code Style

- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Testing

- Write unit tests for utility functions
- Add integration tests for new features
- Test in multiple environments (playground, examples)
- Ensure all existing tests pass

### Documentation

- Update relevant documentation in `/docs`
- Add examples for new features
- Update README files if needed
- Include code comments for complex logic

## Submitting Changes

1. **Push your branch**

```bash
git push origin feature/your-feature-name
```

2. **Create a Pull Request**
   - Use a clear, descriptive title
   - Include a detailed description of changes
   - Reference any related issues
   - Include screenshots if applicable

3. **Address feedback**
   - Respond to code review comments
   - Make requested changes
   - Update tests and documentation as needed

## Release Process

Maintainers use Bumpp to align package versions, verify the workspace, create the release
commit and tag, and publish the packages to npm. See [RELEASING.md](./RELEASING.md) for the
commands and recovery steps.

## Getting Help

- **Documentation**: Check the [docs](./docs) first
- **Issues**: Search existing [GitHub issues](https://github.com/farming-labs/farm.js/issues)
- **Discussions**: Use [GitHub Discussions](https://github.com/farming-labs/farm.js/discussions)
- **Discord**: Join our community Discord (link coming soon)

## Code of Conduct

Please be respectful and inclusive in all interactions. We follow the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct.

## License

By contributing to Farm.js, you agree that your contributions will be licensed under the MIT License.
