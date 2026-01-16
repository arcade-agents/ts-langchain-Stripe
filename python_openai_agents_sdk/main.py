from agents import (Agent, Runner, AgentHooks, Tool, RunContextWrapper,
                    TResponseInputItem,)
from functools import partial
from arcadepy import AsyncArcade
from agents_arcade import get_arcade_tools
from typing import Any
from human_in_the_loop import (UserDeniedToolCall,
                               confirm_tool_usage,
                               auth_tool)

import globals


class CustomAgentHooks(AgentHooks):
    def __init__(self, display_name: str):
        self.event_counter = 0
        self.display_name = display_name

    async def on_start(self,
                       context: RunContextWrapper,
                       agent: Agent) -> None:
        self.event_counter += 1
        print(f"### ({self.display_name}) {
              self.event_counter}: Agent {agent.name} started")

    async def on_end(self,
                     context: RunContextWrapper,
                     agent: Agent,
                     output: Any) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended with output {output}"
                agent.name} ended"
        )

    async def on_handoff(self,
                         context: RunContextWrapper,
                         agent: Agent,
                         source: Agent) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                source.name} handed off to {agent.name}"
        )

    async def on_tool_start(self,
                            context: RunContextWrapper,
                            agent: Agent,
                            tool: Tool) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}:"
            f" Agent {agent.name} started tool {tool.name}"
            f" with context: {context.context}"
        )

    async def on_tool_end(self,
                          context: RunContextWrapper,
                          agent: Agent,
                          tool: Tool,
                          result: str) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended tool {tool.name} with result {result}"
                agent.name} ended tool {tool.name}"
        )


async def main():

    context = {
        "user_id": os.getenv("ARCADE_USER_ID"),
    }

    client = AsyncArcade()

    arcade_tools = await get_arcade_tools(
        client, toolkits=["Stripe"]
    )

    for tool in arcade_tools:
        # - human in the loop
        if tool.name in ENFORCE_HUMAN_CONFIRMATION:
            tool.on_invoke_tool = partial(
                confirm_tool_usage,
                tool_name=tool.name,
                callback=tool.on_invoke_tool,
            )
        # - auth
        await auth_tool(client, tool.name, user_id=context["user_id"])

    agent = Agent(
        name="",
        instructions="# Introduction
Welcome to the Stripe Management AI Agent! This agent is designed to help you interact with Stripe's API for various operations, such as managing customers, creating products, handling invoices, and processing payments. Whether you're looking to create a new customer, generate invoices, or retrieve balance information, this agent will guide you through the processes seamlessly.

# Instructions
1. Understand the user's request and identify the specific actions they want to perform using the provided Stripe tools.
2. Retrieve necessary parameters and data as needed, validating user inputs.
3. Sequentially execute the tools required for the identified workflows, ensuring proper error handling and user feedback.
4. Return the results of each operation clearly, including any relevant information for the user.

# Workflows
## Workflow 1: Create a Customer
1. Use **Stripe_CreateCustomer** to create a new customer with provided name and email.
2. Return the customer ID.

## Workflow 2: Create a Product
1. Use **Stripe_CreateProduct** with provided name and description to create a new product.
2. Return the product ID.

## Workflow 3: Create a Price for a Product
1. Use **Stripe_CreatePrice** with provided product ID, unit amount, and currency to create a new price.
2. Return the price ID.

## Workflow 4: Create an Invoice
1. Use **Stripe_CreateInvoice** with the customer ID to create an invoice.
2. Return the invoice ID.

## Workflow 5: Add an Invoice Item
1. Use **Stripe_CreateInvoiceItem** with the customer ID, price ID, and invoice ID to add an item to the invoice.

## Workflow 6: Finalize an Invoice
1. Use **Stripe_FinalizeInvoice** with the invoice ID to finalize the invoice.

## Workflow 7: Retrieve Customer Invoices
1. Use **Stripe_ListInvoices** with the customer ID to list all associated invoices.
2. Return the invoices' details.

## Workflow 8: Create a Payment Link
1. Use **Stripe_CreatePaymentLink** with the price ID and desired quantity to generate a payment link.
2. Return the payment link URL.

## Workflow 9: Retrieve Balance
1. Use **Stripe_RetrieveBalance** to get the current balance from Stripe.

## Workflow 10: Create a Billing Portal Session
1. Use **Stripe_CreateBillingPortalSession** with the customer ID and optional return URL.
2. Return the session URL for the billing portal. 

This structured approach ensures that the agent can handle a variety of Stripe-related tasks efficiently and effectively.",
        model=os.environ["OPENAI_MODEL"],
        tools=arcade_tools,
        hooks=CustomAgentHooks(display_name="")
    )

    # initialize the conversation
    history: list[TResponseInputItem] = []
    # run the loop!
    while True:
        prompt = input("You: ")
        if prompt.lower() == "exit":
            break
        history.append({"role": "user", "content": prompt})
        try:
            result = await Runner.run(
                starting_agent=agent,
                input=history,
                context=context
            )
            history = result.to_input_list()
            print(result.final_output)
        except UserDeniedToolCall as e:
            history.extend([
                {"role": "assistant",
                 "content": f"Please confirm the call to {e.tool_name}"},
                {"role": "user",
                 "content": "I changed my mind, please don't do it!"},
                {"role": "assistant",
                 "content": f"Sure, I cancelled the call to {e.tool_name}."
                 " What else can I do for you today?"
                 },
            ])
            print(history[-1]["content"])

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())