#!/bin/bash

# Farm.js Setup Script
# This script sets up the development environment for Farm.js

set -e

echo "🚜 Setting up Farm.js development environment..."

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is required but not installed."
    echo "Please install pnpm: npm install -g pnpm"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Build all packages
echo "🔨 Building packages..."
pnpm build

# Run tests
echo "🧪 Running tests..."
pnpm test

echo ""
echo "🎉 Farm.js setup completed successfully!"
echo ""
echo "Next steps:"
echo "  1. Start the playground:    cd playground && pnpm dev"
echo "  2. Run an example:          cd examples/basic && pnpm dev"
echo "  3. Start documentation:     cd docs && pnpm dev"
echo "  4. Create a new app:        pnpm dlx @farm.js/create-app@beta my-app"
echo ""
echo "Happy coding with Farm.js! 🚜"
