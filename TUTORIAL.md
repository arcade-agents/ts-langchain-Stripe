---
title: "Build a Stripe agent with LangChain (TypeScript) and Arcade"
slug: "ts-langchain-Stripe"
framework: "langchain-ts"
language: "typescript"
toolkits: ["Stripe"]
tools: []
difficulty: "beginner"
generated_at: "2026-03-12T01:33:57Z"
source_template: "ts_langchain"
agent_repo: ""
tags:
  - "langchain"
  - "typescript"
  - "stripe"
---

# Build a Stripe agent with LangChain (TypeScript) and Arcade

In this tutorial you'll build an AI agent using [LangChain](https://js.langchain.com/) with [LangGraph](https://langchain-ai.github.io/langgraphjs/) in TypeScript and [Arcade](https://arcade.dev) that can interact with Stripe tools — with built-in authorization and human-in-the-loop support.

## Prerequisites

- The [Bun](https://bun.com) runtime
- An [Arcade](https://arcade.dev) account and API key
- An OpenAI API key

## Project Setup

First, create a directory for this project, and install all the required dependencies:

````bash
mkdir stripe-agent && cd stripe-agent
bun install @arcadeai/arcadejs @langchain/langgraph @langchain/core langchain chalk
````

## Start the agent script

Create a `main.ts` script, and import all the packages and libraries. Imports from 
the `"./tools"` package may give errors in your IDE now, but don't worry about those
for now, you will write that helper package later.

````typescript
"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";
````

## Configuration

In `main.ts`, configure your agent's toolkits, system prompt, and model. Notice
how the system prompt tells the agent how to navigate different scenarios and
how to combine tool usage in specific ways. This prompt engineering is important
to build effective agents. In fact, the more agentic your application, the more
relevant the system prompt to truly make the agent useful and effective at
using the tools at its disposal.

````typescript
// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['Stripe'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = "# Stripe ReAct Agent \u2014 Prompt\n\n## Introduction\nYou are a ReAct-style AI agent that interacts with a Stripe-connected backend via a fixed set of tools. Your purpose is to perform common billing tasks (create customers, products, prices, payment links, invoices, refunds, billing-portal sessions, list objects, and check balance) by choosing the correct tools and parameters, and by reasoning step-by-step in the ReAct format (Thought \u2192 Action \u2192 Observation \u2192 Thought \u2192 ...). Always act as an assistant performing Stripe operations on behalf of an authorized user, and ask clarifying questions if user intent or required parameters are missing.\n\n## Instructions\n- Use the ReAct pattern for every interaction:\n  - Thought: your reasoning about what to do next.\n  - Action: call a tool with exact parameter names and values.\n  - Observation: the tool result (provided by the runtime).\n  - Continue until you have a final Answer for the user.\n- Always validate inputs before calling a tool:\n  - Currency/amount: unit_amount is in cents (e.g., $10.00 \u2192 1000).\n  - Quantities and limits must be integers.\n  - Emails must be valid format; if not provided, ask the user.\n  - IDs returned from one tool should be used for subsequent tools.\n- If the user asks for an operation that could be destructive or irreversible (refunds, large refunds, deleting data), confirm explicitly with the user before proceeding.\n- If a tool returns an error or unexpected output, surface the error to the user, explain likely causes, and suggest next steps (retry, check parameters, or escalate).\n- Prefer not to create duplicate resources. If the user identifies an existing product, price, or customer, use listing tools to find and reuse them before creating new ones.\n- When creating a product/price for a payment link, ensure product exists; create it if it does not.\n- Always convert amounts to the correct units and make the user aware of units when presenting values (dollars vs cents).\n- When necessary, ask follow-up clarification questions before taking actions (e.g., which customer, product name, amount, currency, return_url).\n- Keep responses actionable and concise; show the final result and any next recommended steps.\n\n## ReAct Message Format (required)\nWhen you act, follow this exact message format so the orchestrator and logs are clear:\n\n```\nThought: \u003cbrief reasoning about what to do next\u003e\nAction: \u003cToolName\u003e\nAction Input: { \u003cparam1\u003e: \"\u003cvalue1\u003e\", \u003cparam2\u003e: \"\u003cvalue2\u003e\", ... }\n\nObservation: \u003cresult returned by the tool\u003e\n\nThought: \u003cwhat the observation means and next step\u003e\n... (repeat until done)\n\nFinal Answer: \u003cuser-facing summary of what you did and outcome, or a question if you need clarification\u003e\n```\n\nExample (creating a customer):\n```\nThought: User wants a new customer; create it.\nAction: Stripe_CreateCustomer\nAction Input: { \"name\": \"Acme Corp\", \"email\": \"alice@acme.com\" }\n\nObservation: { \"id\": \"cus_123\", ... }\n\nThought: Customer created; report back details.\nFinal Answer: Created customer Acme Corp (id: cus_123).\n```\n\n## Workflows\nBelow are canonical workflows and the specific sequence of tools to use for each. Follow the sequence, validating inputs and reusing existing resources when appropriate.\n\n1) Create a new customer\n- Sequence:\n  1. Stripe_ListCustomers (optional) \u2014 check for existing email to avoid duplicates\n  2. Stripe_CreateCustomer\n- Notes: Provide name (required) and email (recommended).\n\n2) Create a product, price, and payment link (one-off payment)\n- Sequence (if product exists, skip creation):\n  1. Stripe_ListProducts (search by name or list and inspect)\n  2. Stripe_CreateProduct (if product not found)\n  3. Stripe_CreatePrice (requires product id, unit_amount in cents, currency)\n  4. Stripe_CreatePaymentLink (requires price id, quantity)\n- Notes:\n  - If user supplies an amount like \"$12.50\", convert to 1250.\n  - If the user wants multiple quantities, pass quantity as integer.\n  - Return the payment link URL to the user (Observation from Stripe_CreatePaymentLink).\n\n3) Create an invoice with one or more invoice items\n- Sequence:\n  1. Stripe_ListCustomers (optional) \u2014 find customer by email or id\n  2. Stripe_CreateInvoice (if customer has no open invoice or user requests new invoice) \u2014 returns invoice id\n  3. Stripe_CreateInvoiceItem \u2014 one call per line item; requires customer, price id, invoice id\n  4. Stripe_FinalizeInvoice \u2014 finalize invoice for sending/payment\n- Notes:\n  - To create invoice items you may need price ids; if missing, create a product+price first.\n  - days_until_due on CreateInvoice is optional; confirm with user if they want payment terms.\n  - After finalize, return invoice hosted URL or invoice id from the observation.\n\n4) Create a billing portal session for a customer\n- Sequence:\n  1. Stripe_ListCustomers (optional) \u2014 confirm customer id/email\n  2. Stripe_CreateBillingPortalSession \u2014 pass customer id and optional return_url\n- Notes: Ask user for return_url if they have a specific location to return to.\n\n5) Create a refund for a payment intent\n- Sequence:\n  1. Stripe_ListPaymentIntents (optional) \u2014 find the payment intent by customer or recent payments\n  2. Stripe_CreateRefund \u2014 requires payment_intent and optional amount (in cents)\n- Safety: Confirm intent with the user before issuing refunds. If partial, confirm amount and units.\n\n6) List invoices, customers, payments, or prices\n- Sequence:\n  - Stripe_ListInvoices (filter by customer optional)\n  - Stripe_ListCustomers (filter by email optional)\n  - Stripe_ListPaymentIntents (filter by customer optional)\n  - Stripe_ListPrices (filter by product optional)\n  - Stripe_ListProducts (limit optional)\n- Notes: Ask for filters (email, customer id, product id) and limit. Present a concise summary and IDs for follow-up actions.\n\n7) Create a standalone invoice item (if user just wants to add an item on an existing invoice)\n- Sequence:\n  1. Confirm invoice id (ask or list invoices)\n  2. Ensure a price id exists (list/create product+price)\n  3. Stripe_CreateInvoiceItem with customer, price, invoice\n\n8) Retrieve Stripe balance\n- Sequence:\n  1. Stripe_RetrieveBalance\n- Notes: Return balances per currency and any relevant pending vs available breakdown from Observation.\n\n## Additional guidance + edge cases\n- Parameter formatting:\n  - unit_amount: integer in cents.\n  - amount for refunds: integer in cents.\n  - days_until_due and quantity: integers.\n  - return_url: full URL string.\n- If you must create a Price but user only gives a currency and amount, ask for a product name/description (or explicitly create a generic product with a name the user approves).\n- If user is ambiguous about which resource to act on (e.g., \u201crefund the last charge\u201d), ask for clarifying target (payment intent id, charge id, or permission to look up recent payment intents).\n- When reusing resources, confirm with the user before proceeding if there is any chance of performing an unwanted operation.\n- If a listing tool returns many results, ask the user which one to use or present the top N (limit) and let them choose.\n- For every final Answer, include the key IDs and human-readable summaries (e.g., customer id, product id, price id, invoice id, payment link URL) and the next recommended action.\n\n## Example workflows in ReAct format\n\n- Create product + price + payment link:\n```\nThought: Need to create a product \"Pro Plan\" $20.00 USD and a payment link for 1 quantity.\nAction: Stripe_CreateProduct\nAction Input: { \"name\": \"Pro Plan\", \"description\": \"One-time Pro Plan purchase\" }\n\nObservation: { \"id\": \"prod_ABC\", ... }\n\nThought: Create price for prod_ABC at $20.00 USD (2000 cents).\nAction: Stripe_CreatePrice\nAction Input: { \"product\": \"prod_ABC\", \"unit_amount\": 2000, \"currency\": \"usd\" }\n\nObservation: { \"id\": \"price_DEF\", ... }\n\nThought: Create a payment link for this price with quantity 1.\nAction: Stripe_CreatePaymentLink\nAction Input: { \"price\": \"price_DEF\", \"quantity\": 1 }\n\nObservation: { \"url\": \"https://checkout.stripe...\", \"id\": \"plink_123\", ... }\n\nFinal Answer: Created product prod_ABC, price price_DEF and payment link plink_123. Payment URL: https://checkout.stripe...\n```\n\n- Create invoice with items and finalize:\n```\nThought: Create invoice for customer cus_123 with two items.\nAction: Stripe_CreateInvoice\nAction Input: { \"customer\": \"cus_123\", \"days_until_due\": 14 }\n\nObservation: { \"id\": \"in_456\", ... }\n\nThought: Add item (price: price_X) to invoice in_456.\nAction: Stripe_CreateInvoiceItem\nAction Input: { \"customer\": \"cus_123\", \"price\": \"price_X\", \"invoice\": \"in_456\" }\n\nObservation: { ... }\n\nThought: Add second item (price: price_Y) to invoice in_456.\nAction: Stripe_CreateInvoiceItem\nAction Input: { \"customer\": \"cus_123\", \"price\": \"price_Y\", \"invoice\": \"in_456\" }\n\nObservation: { ... }\n\nThought: Finalize the invoice.\nAction: Stripe_FinalizeInvoice\nAction Input: { \"invoice\": \"in_456\" }\n\nObservation: { \"id\": \"in_456\", \"hosted_invoice_url\": \"...\", ... }\n\nFinal Answer: Finalized invoice in_456 for customer cus_123. Hosted invoice URL: ...\n```\n\nUse this prompt as the agent\u2019s operating instructions and ensure every interaction follows the ReAct pattern and the tool sequences outlined above. If you need clarification at any step, ask the user before calling tools that modify state.";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";
````

Set the following environment variables in a `.env` file:

````bash
ARCADE_API_KEY=your-arcade-api-key
ARCADE_USER_ID=your-arcade-user-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
````

## Implementing the `tools.ts` module

The `tools.ts` module fetches Arcade tool definitions and converts them to LangChain-compatible tools using Arcade's Zod schema conversion:

### Create the file and import the dependencies

Create a `tools.ts` file, and add import the following. These will allow you to build the helper functions needed to convert Arcade tool definitions into a format that LangChain can execute. Here, you also define which tools will require human-in-the-loop confirmation. This is very useful for tools that may have dangerous or undesired side-effects if the LLM hallucinates the values in the parameters. You will implement the helper functions to require human approval in this module.

````typescript
import { Arcade } from "@arcadeai/arcadejs";
import {
  type ToolExecuteFunctionFactoryInput,
  type ZodTool,
  executeZodTool,
  isAuthorizationRequiredError,
  toZod,
} from "@arcadeai/arcadejs/lib/index";
import { type ToolExecuteFunction } from "@arcadeai/arcadejs/lib/zod/types";
import { tool } from "langchain";
import {
  interrupt,
} from "@langchain/langgraph";
import readline from "node:readline/promises";

// This determines which tools require human in the loop approval to run
const TOOLS_WITH_APPROVAL = ['Stripe_CreateBillingPortalSession', 'Stripe_CreateCustomer', 'Stripe_CreateInvoice', 'Stripe_CreateInvoiceItem', 'Stripe_CreatePaymentLink', 'Stripe_CreatePrice', 'Stripe_CreateProduct', 'Stripe_CreateRefund', 'Stripe_FinalizeInvoice'];
````

### Create a confirmation helper for human in the loop

The first helper that you will write is the `confirm` function, which asks a yes or no question to the user, and returns `true` if theuser replied with `"yes"` and `false` otherwise.

````typescript
// Prompt user for yes/no confirmation
export async function confirm(question: string, rl?: readline.Interface): Promise<boolean> {
  let shouldClose = false;
  let interface_ = rl;

  if (!interface_) {
      interface_ = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
      });
      shouldClose = true;
  }

  const answer = await interface_.question(`${question} (y/n): `);

  if (shouldClose) {
      interface_.close();
  }

  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
````

Tools that require authorization trigger a LangGraph interrupt, which pauses execution until the user completes authorization in their browser.

### Create the execution helper

This is a wrapper around the `executeZodTool` function. Before you execute the tool, however, there are two logical checks to be made:

1. First, if the tool the agent wants to invoke is included in the `TOOLS_WITH_APPROVAL` variable, human-in-the-loop is enforced by calling `interrupt` and passing the necessary data to call the `confirm` helper. LangChain will surface that `interrupt` to the agentic loop, and you will be required to "resolve" the interrupt later on. For now, you can assume that the reponse of the `interrupt` will have enough information to decide whether to execute the tool or not, depending on the human's reponse.
2. Second, if the tool was approved by the human, but it doesn't have the authorization of the integration to run, then you need to present an URL to the user so they can authorize the OAuth flow for this operation. For this, an execution is attempted, that may fail to run if the user is not authorized. When it fails, you interrupt the flow and send the authorization request for the harness to handle. If the user authorizes the tool, the harness will reply with an `{authorized: true}` object, and the system will retry the tool call without interrupting the flow.

````typescript
export function executeOrInterruptTool({
  zodToolSchema,
  toolDefinition,
  client,
  userId,
}: ToolExecuteFunctionFactoryInput): ToolExecuteFunction<any> {
  const { name: toolName } = zodToolSchema;

  return async (input: unknown) => {
    try {

      // If the tool is on the list that enforces human in the loop, we interrupt the flow and ask the user to authorize the tool

      if (TOOLS_WITH_APPROVAL.includes(toolName)) {
        const hitl_response = interrupt({
          authorization_required: false,
          hitl_required: true,
          tool_name: toolName,
          input: input,
        });

        if (!hitl_response.authorized) {
          // If the user didn't approve the tool call, we throw an error, which will be handled by LangChain
          throw new Error(
            `Human in the loop required for tool call ${toolName}, but user didn't approve.`
          );
        }
      }

      // Try to execute the tool
      const result = await executeZodTool({
        zodToolSchema,
        toolDefinition,
        client,
        userId,
      })(input);
      return result;
    } catch (error) {
      // If the tool requires authorization, we interrupt the flow and ask the user to authorize the tool
      if (error instanceof Error && isAuthorizationRequiredError(error)) {
        const response = await client.tools.authorize({
          tool_name: toolName,
          user_id: userId,
        });

        // We interrupt the flow here, and pass everything the handler needs to get the user's authorization
        const interrupt_response = interrupt({
          authorization_required: true,
          authorization_response: response,
          tool_name: toolName,
          url: response.url ?? "",
        });

        // If the user authorized the tool, we retry the tool call without interrupting the flow
        if (interrupt_response.authorized) {
          const result = await executeZodTool({
            zodToolSchema,
            toolDefinition,
            client,
            userId,
          })(input);
          return result;
        } else {
          // If the user didn't authorize the tool, we throw an error, which will be handled by LangChain
          throw new Error(
            `Authorization required for tool call ${toolName}, but user didn't authorize.`
          );
        }
      }
      throw error;
    }
  };
}
````

### Create the tool retrieval helper

The last helper function of this module is the `getTools` helper. This function will take the configurations you defined in the `main.ts` file, and retrieve all of the configured tool definitions from Arcade. Those definitions will then be converted to LangGraph `Function` tools, and will be returned in a format that LangChain can present to the LLM so it can use the tools and pass the arguments correctly. You will pass the `executeOrInterruptTool` helper you wrote in the previous section so all the bindings to the human-in-the-loop and auth handling are programmed when LancChain invokes a tool.


````typescript
// Initialize the Arcade client
export const arcade = new Arcade();

export type GetToolsProps = {
  arcade: Arcade;
  toolkits?: string[];
  tools?: string[];
  userId: string;
  limit?: number;
}


export async function getTools({
  arcade,
  toolkits = [],
  tools = [],
  userId,
  limit = 100,
}: GetToolsProps) {

  if (toolkits.length === 0 && tools.length === 0) {
      throw new Error("At least one tool or toolkit must be provided");
  }

  // Todo(Mateo): Add pagination support
  const from_toolkits = await Promise.all(toolkits.map(async (tkitName) => {
      const definitions = await arcade.tools.list({
          toolkit: tkitName,
          limit: limit
      });
      return definitions.items;
  }));

  const from_tools = await Promise.all(tools.map(async (toolName) => {
      return await arcade.tools.get(toolName);
  }));

  const all_tools = [...from_toolkits.flat(), ...from_tools];
  const unique_tools = Array.from(
      new Map(all_tools.map(tool => [tool.qualified_name, tool])).values()
  );

  const arcadeTools = toZod({
    tools: unique_tools,
    client: arcade,
    executeFactory: executeOrInterruptTool,
    userId: userId,
  });

  // Convert Arcade tools to LangGraph tools
  const langchainTools = arcadeTools.map(({ name, description, execute, parameters }) =>
    (tool as Function)(execute, {
      name,
      description,
      schema: parameters,
    })
  );

  return langchainTools;
}
````

## Building the Agent

Back on the `main.ts` file, you can now call the helper functions you wrote to build the agent.

### Retrieve the configured tools

Use the `getTools` helper you wrote to retrieve the tools from Arcade in LangChain format:

````typescript
const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});
````

### Write an interrupt handler

When LangChain is interrupted, it will emit an event in the stream that you will need to handle and resolve based on the user's behavior. For a human-in-the-loop interrupt, you will call the `confirm` helper you wrote earlier, and indicate to the harness whether the human approved the specific tool call or not. For an auth interrupt, you will present the OAuth URL to the user, and wait for them to finishe the OAuth dance before resolving the interrupt with `{authorized: true}` or `{authorized: false}` if an error occurred:

````typescript
async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}
````

### Create an Agent instance

Here you create the agent using the `createAgent` function. You pass the system prompt, the model, the tools, and the checkpointer. When the agent runs, it will automatically use the helper function you wrote earlier to handle tool calls and authorization requests.

````typescript
const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});
````

### Write the invoke helper

This last helper function handles the streaming of the agent’s response, and captures the interrupts. When the system detects an interrupt, it adds the interrupt to the `interrupts` array, and the flow interrupts. If there are no interrupts, it will just stream the agent’s to your console.

````typescript
async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}
````

### Write the main function

Finally, write the main function that will call the agent and handle the user input.

Here the `config` object configures the `thread_id`, which tells the agent to store the state of the conversation into that specific thread. Like any typical agent loop, you:

1. Capture the user input
2. Stream the agent's response
3. Handle any authorization interrupts
4. Resume the agent after authorization
5. Handle any errors
6. Exit the loop if the user wants to quit

````typescript
async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));
````

## Running the Agent

### Run the agent

```bash
bun run main.ts
```

You should see the agent responding to your prompts like any model, as well as handling any tool calls and authorization requests.

## Next Steps

- Clone the [repository](https://github.com/arcade-agents/ts-langchain-Stripe) and run it
- Add more toolkits to the `toolkits` array to expand capabilities
- Customize the `systemPrompt` to specialize the agent's behavior
- Explore the [Arcade documentation](https://docs.arcade.dev) for available toolkits

