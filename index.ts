import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";
import winston from 'winston';

dotenv.config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          return `${timestamp} [${level}]: ${stack || message}`;
        })
      )
    })
  ],
});


const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    logger.error("ANTHROPIC_API_KEY is not set in environment variables.");
    throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    logger.info("MCPClient initialized");
  }

  async connectToServer(serverIdentifier: string) {
    logger.info(`Attempting to connect to MCP server using identifier: ${serverIdentifier}`);
    try {
      let command: string;
      let args: string[];

      const isJs = serverIdentifier.endsWith(".js");
      const isPy = serverIdentifier.endsWith(".py");

      if (isJs) {
        command = process.execPath;
        args = [serverIdentifier];
        logger.info(`Identified as local JS file. Using command: ${command} ${args.join(' ')}`);
      } else if (isPy) {
        command = process.platform === "win32" ? "python" : "python3";
        args = [serverIdentifier];
        logger.info(`Identified as local Python file. Using command: ${command} ${args.join(' ')}`);
      } else {
        command = "npx";
        args = ["-y", serverIdentifier];
        logger.info(`Identified as potential NPM package. Using command: ${command} ${args.join(' ')}`);
      }

      this.transport = new StdioClientTransport({
        command,
        args,
      });

      logger.info("Connecting MCP client to transport...");
      this.mcp.connect(this.transport);

      logger.info("Fetching list of tools from server...");
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      logger.info(
        `Connected successfully. Available tools: [${this.tools.map(({ name }) => name).join(', ')}]`
      );

    } catch (e) {
      logger.error("Failed to connect to MCP server:", e);
      throw e;
    }
  }

  async processQuery(query: string): Promise<string> {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    logger.info("\nSending query to Anthropic to determine action...");
    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });
    logger.info("Received response from Anthropic.");

    let initialTextResponse = "";
    let toolCallRequested = false;

    for (const content of response.content) {
      if (content.type === "text") {
        logger.info("Anthropic provided text response.");
        initialTextResponse += content.text + "\n";
      } else if (content.type === "tool_use") {
        toolCallRequested = true;
        const toolUseBlock = content as ToolUseBlock;
        const toolName = toolUseBlock.name;
        const toolInput = toolUseBlock.input;
        const toolUseId = toolUseBlock.id;

        logger.info(`\nAnthropic requested tool use:`);
        logger.info(`  Tool Name: ${toolName}`);
        logger.info(`  Tool Input: ${JSON.stringify(toolInput)}`);
        logger.info(`  Tool Use ID: ${toolUseId}`);

        logger.info(`\nAttempting to call MCP tool '${toolName}'...`);
        logger.debug(`[System Message: Calling tool ${toolName} with args ${JSON.stringify(toolInput)}]`);

        try {
          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolInput as { [x: string]: unknown } | undefined,
          });

          logger.info(`\nReceived result from MCP tool '${toolName}':`);
          logger.debug(JSON.stringify(result, null, 2));

          let extractedText = "";

          if (Array.isArray(result.content) && result.content.length > 0) {
            for (const block of result.content) {
              if (block && typeof block.text === 'string') {
                extractedText += block.text + "\n";
              }
            }
            extractedText = extractedText.trim();
          } else if (typeof result.content === 'string') {
            extractedText = result.content.trim();
          }


          if (extractedText.length > 0) {
            logger.info("Tool returned content. Returning it directly.");
            return extractedText;
          } else {
            logger.warn("Tool returned no usable text content.");
            return `The tool '${toolName}' was called successfully using arguments ${JSON.stringify(toolInput)}, but it returned no specific data or text content.`;
          }

        } catch (toolError) {
          logger.error(`\nError calling MCP tool '${toolName}':`, toolError);
          const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
          return `[Error calling tool ${toolName}: ${errorMessage}]`;
        }
      }
    }

    if (!toolCallRequested) {
      logger.info("No tool use requested by Anthropic. Returning initial text response.");
      if (initialTextResponse.trim().length > 0) {
        return initialTextResponse.trim();
      } else {
        logger.warn("No tool use requested and no initial text received from Anthropic.");
        return "[MCPClient] Received no actionable text response or tool request from the LLM.";
      }
    }

    logger.warn("Reached end of processQuery unexpectedly after checking for tool calls.");
    return initialTextResponse.trim() || "[MCPClient] Unexpected end of processing.";
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      logger.info("\nMCP Client Started!");
      logger.info("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          logger.info("Quit command received. Exiting chat loop.");
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
      logger.info("Readline interface closed.");
    }
  }

  async cleanup() {
    logger.info("Closing MCP connection...");
    try {
        await this.mcp.close();
        logger.info("MCP connection closed successfully.");
    } catch (e) {
        logger.error("Error closing MCP connection:", e);
    }
  }
}

async function main() {
  if (process.argv.length < 3) {
    logger.error("Usage: node build/index.js <path_to_server_script_or_npm_package_name>");
    console.log("Usage: node build/index.js <path_to_server_script_or_npm_package_name>");
    process.exit(1);
  }

  const serverIdentifier = process.argv[2];
  const mcpClient = new MCPClient();

  const shutdown = async (signal: string) => {
      logger.warn(`Received ${signal}. Shutting down gracefully...`);
      await mcpClient.cleanup();
      process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await mcpClient.connectToServer(serverIdentifier);
    await mcpClient.chatLoop();
  } catch (error) {
      logger.error("An unrecoverable error occurred during client execution.", error);
  } finally {
    if (!process.exitCode) {
        await mcpClient.cleanup();
        process.exit(0);
    }
  }
}

main().catch(err => {
    logger.error("Unhandled error in main execution:", err);
    process.exit(1);
});