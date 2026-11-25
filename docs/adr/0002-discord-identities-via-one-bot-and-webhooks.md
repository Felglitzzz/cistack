# Discord identities: the coordinator is the bot, other roles post through webhooks

The coordinator speaks and listens on Discord through the official Claude Code Discord plugin's single bot. Every other role posts through a channel webhook that sets its own name and avatar per message, so each role appears as its own profile. Agents talk to each other through Claude Code's own messaging, never through Discord, and Discord shows those conversations so the owner can follow and step in.

## Considered Options

- **A real Discord account per agent**: rejected; automating a user account breaks Discord's Terms of Service.
- **One bot application per role**: rejected; each bot needs its own session and token, and the plugin drops every message written by a bot, so the bots still could not hear each other.
- **One bot posting every role's text with a name in front (Larceny's approach)**: rejected; it works, but every message shows the same profile, which makes a busy thread hard to follow.

## Consequences

- Webhook posts count as bot messages, so the coordinator's bot never receives them. This is what keeps agents from answering their own posts in a loop.
- The project channel must deliver all of the owner's messages without requiring an @mention, because a reply to a webhook post is not a reply to the bot.
- Webhook URLs are secrets kept on the owner's machine and never committed.
