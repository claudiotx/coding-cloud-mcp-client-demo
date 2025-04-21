# coding-cloud-mcp-client-demo

This project demonstrates a client implementation for the Coding Cloud Model Context Protocol (MCP).

## Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:claudiotx/coding-cloud-mcp-client-demo.git
   cd coding-cloud-mcp-client-demo
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file in the root directory and add your environment variables. You can use `.env` as a template:
   ```bash
   cp .env .env.local
   # Edit .env.local with your actual values
   ```
   You will need to provide your `ANTHROPIC_API_KEY`.

## Running the Application

### Development

To run the application in development mode with hot-reloading:

```bash
npm run dev
```

### Production / Running the Client

To build and run the compiled client:

1. Build the project:
   ```bash
   npm run build
   ```

2. Run the client, specifying the MCP server package (example uses `@coding-cloud/coding-cloud-mcp-server`):
   ```bash
   npm run run-client
   ```
   Alternatively, you can run the built JavaScript directly:
   ```bash
   node build/index.js @coding-cloud/coding-cloud-mcp-server
   ```

## What the Client Does

The client will:

*   Connect to the specified server
*   List available tools
*   Start an interactive chat session where you can:
    *   Enter queries
    *   See tool executions
    *   Get responses from Claude

## How It Works

When you submit a query:

1.  The client gets the list of available tools from the server.
2.  Your query is sent to Claude along with tool descriptions.
3.  Claude decides which tools (if any) to use.
4.  The client executes any requested tool calls through the server.
5.  Results are sent back to Claude.
6.  Claude provides a natural language response.
7.  The response is displayed to you.

## Best Practices

### Error Handling

*   Use TypeScript’s type system for better error detection.
*   Wrap tool calls in `try-catch` blocks.
*   Provide meaningful error messages.
*   Gracefully handle connection issues.

### Security

*   Store API keys securely in `.env.local` (and ensure `.env.local` is in your `.gitignore`).
*   Validate server responses.
*   Be cautious with tool permissions.