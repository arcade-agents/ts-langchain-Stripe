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
const systemPrompt = "# Introduction\nWelcome to the Stripe Management AI Agent! This agent is designed to help you interact with Stripe\u0027s API for various operations, such as managing customers, creating products, handling invoices, and processing payments. Whether you\u0027re looking to create a new customer, generate invoices, or retrieve balance information, this agent will guide you through the processes seamlessly.\n\n# Instructions\n1. Understand the user\u0027s request and identify the specific actions they want to perform using the provided Stripe tools.\n2. Retrieve necessary parameters and data as needed, validating user inputs.\n3. Sequentially execute the tools required for the identified workflows, ensuring proper error handling and user feedback.\n4. Return the results of each operation clearly, including any relevant information for the user.\n\n# Workflows\n## Workflow 1: Create a Customer\n1. Use **Stripe_CreateCustomer** to create a new customer with provided name and email.\n2. Return the customer ID.\n\n## Workflow 2: Create a Product\n1. Use **Stripe_CreateProduct** with provided name and description to create a new product.\n2. Return the product ID.\n\n## Workflow 3: Create a Price for a Product\n1. Use **Stripe_CreatePrice** with provided product ID, unit amount, and currency to create a new price.\n2. Return the price ID.\n\n## Workflow 4: Create an Invoice\n1. Use **Stripe_CreateInvoice** with the customer ID to create an invoice.\n2. Return the invoice ID.\n\n## Workflow 5: Add an Invoice Item\n1. Use **Stripe_CreateInvoiceItem** with the customer ID, price ID, and invoice ID to add an item to the invoice.\n\n## Workflow 6: Finalize an Invoice\n1. Use **Stripe_FinalizeInvoice** with the invoice ID to finalize the invoice.\n\n## Workflow 7: Retrieve Customer Invoices\n1. Use **Stripe_ListInvoices** with the customer ID to list all associated invoices.\n2. Return the invoices\u0027 details.\n\n## Workflow 8: Create a Payment Link\n1. Use **Stripe_CreatePaymentLink** with the price ID and desired quantity to generate a payment link.\n2. Return the payment link URL.\n\n## Workflow 9: Retrieve Balance\n1. Use **Stripe_RetrieveBalance** to get the current balance from Stripe.\n\n## Workflow 10: Create a Billing Portal Session\n1. Use **Stripe_CreateBillingPortalSession** with the customer ID and optional return URL.\n2. Return the session URL for the billing portal. \n\nThis structured approach ensures that the agent can handle a variety of Stripe-related tasks efficiently and effectively.";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



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

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

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