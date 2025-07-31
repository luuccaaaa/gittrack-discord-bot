# Contributing to GitTrack Discord Bot

Thank you for your interest in contributing to GitTrack! This document provides guidelines and information for contributors.

## 🤝 How to Contribute

### Reporting Bugs

- Use the [GitHub issue tracker](https://github.com/gittrack/gittrack-discord-bot/issues)
- Include a clear and descriptive title
- Provide steps to reproduce the bug
- Include your environment details (Node.js version, OS, etc.)
- Add screenshots if applicable

### Suggesting Features

- Use the [GitHub issue tracker](https://github.com/gittrack/gittrack-discord-bot/issues)
- Describe the feature in detail
- Explain why this feature would be useful
- Consider the impact on existing functionality

### Code Contributions

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Test your changes**
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to the branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

## 🛠️ Development Setup

### Prerequisites

- Node.js 18 or higher
- PostgreSQL database
- Discord Bot Token
- GitHub Personal Access Token (for testing)

### Local Development

1. **Clone your fork**
   ```bash
   git clone https://github.com/your-username/gittrack-discord-bot.git
   cd gittrack-discord-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up database**
   ```bash
   # For development (creates migrations)
   npx prisma migrate dev --name init
   npx prisma generate
   
   # For users (applies existing migrations or uses db push)
   npx prisma migrate deploy
   npx prisma generate
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

## 📝 Code Style Guidelines

### JavaScript/Node.js

- Use **ES6+** features
- Follow **camelCase** for variables and functions
- Use **PascalCase** for classes
- Use **UPPER_SNAKE_CASE** for constants
- Add **JSDoc comments** for functions and classes
- Use **async/await** instead of promises when possible
- Handle errors appropriately

### Example

```javascript
/**
 * Processes a GitHub webhook event
 * @param {Object} payload - The webhook payload
 * @param {string} eventType - The type of event
 * @returns {Promise<Object>} The processed result
 */
async function processWebhookEvent(payload, eventType) {
  try {
    const result = await validatePayload(payload);
    return result;
  } catch (error) {
    console.error('Error processing webhook:', error);
    throw new Error('Failed to process webhook event');
  }
}
```

### Database

- Use **Prisma** for all database operations
- Follow **snake_case** for database column names
- Add **migrations** for schema changes
- Include **indexes** for frequently queried fields

### Git Commit Messages

- Use **conventional commits** format
- Start with a type: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`
- Use present tense: "Add feature" not "Added feature"
- Keep the first line under 50 characters
- Add more details in the body if needed

Examples:
```
feat: add support for GitHub releases
fix: resolve webhook signature verification
docs: update installation instructions
```

## 🧪 Testing

### Running Tests

```bash
npm test
```

### Writing Tests

- Write tests for new features
- Update tests when fixing bugs
- Use descriptive test names
- Test both success and error cases
- Mock external dependencies

### Test Structure

```javascript
describe('Webhook Handler', () => {
  describe('processPushEvent', () => {
    it('should process valid push event', async () => {
      // Test implementation
    });

    it('should handle invalid payload', async () => {
      // Test implementation
    });
  });
});
```

## 🔧 Pull Request Guidelines

### Before Submitting

1. **Test your changes** thoroughly
2. **Update documentation** if needed
3. **Add tests** for new features
4. **Check for linting errors**
5. **Ensure all tests pass**

### Pull Request Template

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tests added/updated
- [ ] All tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

## 🏗️ Project Structure

```
Bot/
├── commands/          # Discord slash commands
│   ├── help.js
│   ├── link.js
│   ├── setup.js
│   └── ...
├── functions/         # Utility functions
│   ├── channelLimitChecker.js
│   ├── permissionChecker.js
│   └── ...
├── prisma/           # Database schema and migrations
│   ├── schema.prisma
│   └── migrations/
├── webhookHandler.js # GitHub webhook processing
├── bot.js           # Discord bot setup
├── index.js         # Application entry point
└── README.md        # Project documentation
```

## 🚀 Release Process

1. **Create a release branch**: `git checkout -b release/v1.0.0`
2. **Update version**: Update `package.json` version
3. **Update changelog**: Add changes to `CHANGELOG.md`
4. **Create pull request**: Merge to main
5. **Create release**: Tag and create GitHub release
6. **Deploy**: Deploy to production

## 📞 Getting Help

- **Discussions**: [GitHub Discussions](https://github.com/gittrack/gittrack-discord-bot/discussions)
- **Issues**: [GitHub Issues](https://github.com/gittrack/gittrack-discord-bot/issues)
- **Email**: support@gittrack.me

## 🙏 Recognition

Contributors will be recognized in:
- The project README
- Release notes
- The GitTrack website

Thank you for contributing to GitTrack! 🎉 