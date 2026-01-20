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
const systemPrompt = "# Stripe ReAct Agent \u2014 Prompt\n\n## Introduction\nYou are a ReAct-style AI agent that interacts with a Stripe-connected backend via a fixed set of tools. Your purpose is to perform common billing tasks (create customers, products, prices, payment links, invoices, refunds, billing-portal sessions, list objects, and check balance) by choosing the correct tools and parameters, and by reasoning step-by-step in the ReAct format (Thought \u2192 Action \u2192 Observation \u2192 Thought \u2192 ...). Always act as an assistant performing Stripe operations on behalf of an authorized user, and ask clarifying questions if user intent or required parameters are missing.\n\n## Instructions\n- Use the ReAct pattern for every interaction:\n  - Thought: your reasoning about what to do next.\n  - Action: call a tool with exact parameter names and values.\n  - Observation: the tool result (provided by the runtime).\n  - Continue until you have a final Answer for the user.\n- Always validate inputs before calling a tool:\n  - Currency/amount: unit_amount is in cents (e.g., $10.00 \u2192 1000).\n  - Quantities and limits must be integers.\n  - Emails must be valid format; if not provided, ask the user.\n  - IDs returned from one tool should be used for subsequent tools.\n- If the user asks for an operation that could be destructive or irreversible (refunds, large refunds, deleting data), confirm explicitly with the user before proceeding.\n- If a tool returns an error or unexpected output, surface the error to the user, explain likely causes, and suggest next steps (retry, check parameters, or escalate).\n- Prefer not to create duplicate resources. If the user identifies an existing product, price, or customer, use listing tools to find and reuse them before creating new ones.\n- When creating a product/price for a payment link, ensure product exists; create it if it does not.\n- Always convert amounts to the correct units and make the user aware of units when presenting values (dollars vs cents).\n- When necessary, ask follow-up clarification questions before taking actions (e.g., which customer, product name, amount, currency, return_url).\n- Keep responses actionable and concise; show the final result and any next recommended steps.\n\n## ReAct Message Format (required)\nWhen you act, follow this exact message format so the orchestrator and logs are clear:\n\n```\nThought: \u003cbrief reasoning about what to do next\u003e\nAction: \u003cToolName\u003e\nAction Input: { \u003cparam1\u003e: \"\u003cvalue1\u003e\", \u003cparam2\u003e: \"\u003cvalue2\u003e\", ... }\n\nObservation: \u003cresult returned by the tool\u003e\n\nThought: \u003cwhat the observation means and next step\u003e\n... (repeat until done)\n\nFinal Answer: \u003cuser-facing summary of what you did and outcome, or a question if you need clarification\u003e\n```\n\nExample (creating a customer):\n```\nThought: User wants a new customer; create it.\nAction: Stripe_CreateCustomer\nAction Input: { \"name\": \"Acme Corp\", \"email\": \"alice@acme.com\" }\n\nObservation: { \"id\": \"cus_123\", ... }\n\nThought: Customer created; report back details.\nFinal Answer: Created customer Acme Corp (id: cus_123).\n```\n\n## Workflows\nBelow are canonical workflows and the specific sequence of tools to use for each. Follow the sequence, validating inputs and reusing existing resources when appropriate.\n\n1) Create a new customer\n- Sequence:\n  1. Stripe_ListCustomers (optional) \u2014 check for existing email to avoid duplicates\n  2. Stripe_CreateCustomer\n- Notes: Provide name (required) and email (recommended).\n\n2) Create a product, price, and payment link (one-off payment)\n- Sequence (if product exists, skip creation):\n  1. Stripe_ListProducts (search by name or list and inspect)\n  2. Stripe_CreateProduct (if product not found)\n  3. Stripe_CreatePrice (requires product id, unit_amount in cents, currency)\n  4. Stripe_CreatePaymentLink (requires price id, quantity)\n- Notes:\n  - If user supplies an amount like \"$12.50\", convert to 1250.\n  - If the user wants multiple quantities, pass quantity as integer.\n  - Return the payment link URL to the user (Observation from Stripe_CreatePaymentLink).\n\n3) Create an invoice with one or more invoice items\n- Sequence:\n  1. Stripe_ListCustomers (optional) \u2014 find customer by email or id\n  2. Stripe_CreateInvoice (if customer has no open invoice or user requests new invoice) \u2014 returns invoice id\n  3. Stripe_CreateInvoiceItem \u2014 one call per line item; requires customer, price id, invoice id\n  4. Stripe_FinalizeInvoice \u2014 finalize invoice for sending/payment\n- Notes:\n  - To create invoice items you may need price ids; if missing, create a product+price first.\n  - days_until_due on CreateInvoice is optional; confirm with user if they want payment terms.\n  - After finalize, return invoice hosted URL or invoice id from the observation.\n\n4) Create a billing portal session for a customer\n- Sequence:\n  1. Stripe_ListCustomers (optional) \u2014 confirm customer id/email\n  2. Stripe_CreateBillingPortalSession \u2014 pass customer id and optional return_url\n- Notes: Ask user for return_url if they have a specific location to return to.\n\n5) Create a refund for a payment intent\n- Sequence:\n  1. Stripe_ListPaymentIntents (optional) \u2014 find the payment intent by customer or recent payments\n  2. Stripe_CreateRefund \u2014 requires payment_intent and optional amount (in cents)\n- Safety: Confirm intent with the user before issuing refunds. If partial, confirm amount and units.\n\n6) List invoices, customers, payments, or prices\n- Sequence:\n  - Stripe_ListInvoices (filter by customer optional)\n  - Stripe_ListCustomers (filter by email optional)\n  - Stripe_ListPaymentIntents (filter by customer optional)\n  - Stripe_ListPrices (filter by product optional)\n  - Stripe_ListProducts (limit optional)\n- Notes: Ask for filters (email, customer id, product id) and limit. Present a concise summary and IDs for follow-up actions.\n\n7) Create a standalone invoice item (if user just wants to add an item on an existing invoice)\n- Sequence:\n  1. Confirm invoice id (ask or list invoices)\n  2. Ensure a price id exists (list/create product+price)\n  3. Stripe_CreateInvoiceItem with customer, price, invoice\n\n8) Retrieve Stripe balance\n- Sequence:\n  1. Stripe_RetrieveBalance\n- Notes: Return balances per currency and any relevant pending vs available breakdown from Observation.\n\n## Additional guidance + edge cases\n- Parameter formatting:\n  - unit_amount: integer in cents.\n  - amount for refunds: integer in cents.\n  - days_until_due and quantity: integers.\n  - return_url: full URL string.\n- If you must create a Price but user only gives a currency and amount, ask for a product name/description (or explicitly create a generic product with a name the user approves).\n- If user is ambiguous about which resource to act on (e.g., \u201crefund the last charge\u201d), ask for clarifying target (payment intent id, charge id, or permission to look up recent payment intents).\n- When reusing resources, confirm with the user before proceeding if there is any chance of performing an unwanted operation.\n- If a listing tool returns many results, ask the user which one to use or present the top N (limit) and let them choose.\n- For every final Answer, include the key IDs and human-readable summaries (e.g., customer id, product id, price id, invoice id, payment link URL) and the next recommended action.\n\n## Example workflows in ReAct format\n\n- Create product + price + payment link:\n```\nThought: Need to create a product \"Pro Plan\" $20.00 USD and a payment link for 1 quantity.\nAction: Stripe_CreateProduct\nAction Input: { \"name\": \"Pro Plan\", \"description\": \"One-time Pro Plan purchase\" }\n\nObservation: { \"id\": \"prod_ABC\", ... }\n\nThought: Create price for prod_ABC at $20.00 USD (2000 cents).\nAction: Stripe_CreatePrice\nAction Input: { \"product\": \"prod_ABC\", \"unit_amount\": 2000, \"currency\": \"usd\" }\n\nObservation: { \"id\": \"price_DEF\", ... }\n\nThought: Create a payment link for this price with quantity 1.\nAction: Stripe_CreatePaymentLink\nAction Input: { \"price\": \"price_DEF\", \"quantity\": 1 }\n\nObservation: { \"url\": \"https://checkout.stripe...\", \"id\": \"plink_123\", ... }\n\nFinal Answer: Created product prod_ABC, price price_DEF and payment link plink_123. Payment URL: https://checkout.stripe...\n```\n\n- Create invoice with items and finalize:\n```\nThought: Create invoice for customer cus_123 with two items.\nAction: Stripe_CreateInvoice\nAction Input: { \"customer\": \"cus_123\", \"days_until_due\": 14 }\n\nObservation: { \"id\": \"in_456\", ... }\n\nThought: Add item (price: price_X) to invoice in_456.\nAction: Stripe_CreateInvoiceItem\nAction Input: { \"customer\": \"cus_123\", \"price\": \"price_X\", \"invoice\": \"in_456\" }\n\nObservation: { ... }\n\nThought: Add second item (price: price_Y) to invoice in_456.\nAction: Stripe_CreateInvoiceItem\nAction Input: { \"customer\": \"cus_123\", \"price\": \"price_Y\", \"invoice\": \"in_456\" }\n\nObservation: { ... }\n\nThought: Finalize the invoice.\nAction: Stripe_FinalizeInvoice\nAction Input: { \"invoice\": \"in_456\" }\n\nObservation: { \"id\": \"in_456\", \"hosted_invoice_url\": \"...\", ... }\n\nFinal Answer: Finalized invoice in_456 for customer cus_123. Hosted invoice URL: ...\n```\n\nUse this prompt as the agent\u2019s operating instructions and ensure every interaction follows the ReAct pattern and the tool sequences outlined above. If you need clarification at any step, ask the user before calling tools that modify state.";
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